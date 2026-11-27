-- ============================================================
-- diagnostics/16_m8_room_protection_test.sql
-- اختبار وظيفي لترحيل #76 (M8.5 + M8.6) داخل BEGIN … ROLLBACK.
-- يغطي: كتالوج المنتجات، إدارة المنتج وتدقيقها، شراء اشتراك، ازدواجية،
-- تكديس الباقات، الشراء الدائم، بوابات الصلاحية، وتعليق الحماية في
-- room_manage_action: VIP يمنع الطرد/الحظر من المالك والمشرف، مانع
-- الطرد يمنع الطرد لا الحظر، مانع الحظر يمنع الحظر لا الطرد، الإدارة
-- والوكالة تتجاوزان، والمفتاح يوقف الشراء.
-- متطلب سابق: #74 (صلاحيات protection.* وأنواع الإشعارات) و#75.
-- ============================================================
BEGIN;

CREATE TEMP TABLE _results (step text, expected text, actual text, ok boolean) ON COMMIT DROP;

DO $do$
DECLARE
  v_admin uuid := '2488de9e-97d9-4fa6-aa0a-856de7189287';
  v_owner uuid;
  v_target uuid;
  v_agent uuid;
  v_room uuid;
  v_sub uuid;
  v_perm uuid;
  v_bundle uuid;
  v_product_sub uuid;
  v_product_perm uuid;
  v_product_bundle uuid;
  v_kick_reason text;
  v_ban_reason text;
  v_ok boolean;
  v_actual text;
  v_result jsonb;
  v_row jsonb;
  v_cnt integer;
  v_num integer;
  v_price bigint;
  v_balance bigint;
  v_agency_id uuid;
  v_agent_id uuid;
  v_agent_row record;
BEGIN
  PERFORM set_config('request.jwt.claims', jsonb_build_object('role', 'service_role')::text, true);

  -- مستخدمون اختبارات نشطون
  SELECT u.id INTO v_owner FROM public.users u
  WHERE u.role = 'user' AND u.status = 'active'
  ORDER BY u.created_at LIMIT 1;
  SELECT u.id INTO v_target FROM public.users u
  WHERE u.role = 'user' AND u.status = 'active' AND u.id <> v_owner
  ORDER BY u.created_at LIMIT 1;
  SELECT a.user_id INTO v_agent FROM public.agents a
  JOIN public.agencies g ON g.id = a.agency_id
  WHERE a.status = 'active' AND g.status = 'active'
    AND a.user_id <> v_owner AND a.user_id <> v_target
  ORDER BY a.created_at LIMIT 1;
  -- T11 أعاد اختيار وكيل مستقل؛ هذا الانتقاء الأولي للتحقق من وجود مستخدمين
  IF v_owner IS NULL OR v_target IS NULL THEN
    INSERT INTO _results VALUES ('T00', 'وجود مستخدمين اختبار', 'لا يوجد', false);
    RETURN;
  END IF;

  -- تأهيل المالك والهدف بشرطي M7.4 لأي مسار حاجة لاحقة
  UPDATE public.users
    SET adult_confirmed_at = coalesce(adult_confirmed_at, now()),
        onboarding_completed_at = coalesce(onboarding_completed_at, now())
    WHERE id IN (v_owner, v_target);

  -- T01: الكتالوج العام — ٤ منتجات نشطة
  SELECT jsonb_build_object('count', jsonb_array_length(public.get_public_protection_products())) INTO v_row;
  v_ok := (v_row->>'count')::int >= 4;
  v_actual := 'count=' || (v_row->>'count');
  INSERT INTO _results VALUES ('T01', 'كتالوج منتجات الحماية العام', v_actual, v_ok);

  -- T02: إدارة منتج (تحديث سعر) + سجل تدقيق
  SELECT id INTO v_product_sub FROM public.protection_products
  WHERE kind = 'anti_kick' AND mode = 'subscription' LIMIT 1;
  SELECT id INTO v_product_perm FROM public.protection_products
  WHERE kind = 'anti_kick' AND mode = 'permanent' LIMIT 1;
  SELECT id INTO v_product_bundle FROM public.protection_products
  WHERE kind = 'anti_ban' AND mode = 'bundle' LIMIT 1;
  IF v_product_bundle IS NULL THEN
    INSERT INTO public.protection_products (kind, mode, name_ar, price_coins, duration_days)
    VALUES ('anti_ban', 'bundle', 'باقة حماية حظر — ٩٠ يوم', 12000, 90)
    RETURNING id INTO v_product_bundle;
  END IF;
  PERFORM public.admin_upsert_protection_product(v_admin, v_product_sub,
    jsonb_build_object('kind','anti_kick','mode','subscription',
      'name_ar','مانع طرد — اشتراك شهري','price_coins',4321,
      'duration_days',30,'is_active',true),
    'اختبار تحديث سعر مانع الطرد');
  SELECT count(*) INTO v_cnt FROM public.admin_audit_log
    WHERE target_type = 'protection_product' AND target_id = v_product_sub AND action = 'update';
  SELECT jsonb_build_object('price', price_coins) INTO v_row
    FROM public.protection_products WHERE id = v_product_sub;
  v_ok := (v_row->>'price')::bigint = 4321 AND v_cnt >= 1;
  v_actual := 'price=' || (v_row->>'price') || ' audits=' || v_cnt;
  INSERT INTO _results VALUES ('T02', 'تحديث المنتج يُسجَّل ويُطبَّق', v_actual, v_ok);

  -- T03: شراء اشتراك مانع طرد — خصم وقيد وإيراد وإشعار ومدة
  UPDATE public.users SET balance_gold = 50000 WHERE id = v_target;
  v_result := public.settle_protection_purchase(v_target, v_product_sub, 'm8prot-test-sub-01');
  SELECT balance_gold INTO v_balance FROM public.users WHERE id = v_target;
  SELECT id INTO v_sub FROM public.user_protections
    WHERE user_id = v_target AND kind = 'anti_kick';
  SELECT count(*) INTO v_cnt FROM public.user_notifications
    WHERE user_id = v_target AND event_type = 'protection_purchase' AND reference_id = v_sub;
  v_ok := v_sub IS NOT NULL
    AND v_balance = 50000 - 4321
    AND (v_result->>'expires_at') IS NOT NULL
    AND v_cnt = 1;
  v_actual := 'balance=' || v_balance || ' expires=' || coalesce(v_result->>'expires_at', 'NULL') || ' notif=' || v_cnt;
  INSERT INTO _results VALUES ('T03', 'شراء اشتراك: خصم وقيد وإيراد وإشعار ومدة', v_actual, v_ok);

  -- T04: إعادة نفس المفتاح — بلا خصم ثانٍ وبنفس الصف
  v_result := public.settle_protection_purchase(v_target, v_product_sub, 'm8prot-test-sub-01');
  SELECT balance_gold INTO v_balance FROM public.users WHERE id = v_target;
  SELECT count(*) INTO v_cnt FROM public.user_protections WHERE user_id = v_target;
  v_ok := v_balance = 50000 - 4321 AND v_cnt = 1 AND (v_result->>'id')::uuid = v_sub;
  v_actual := 'rows=' || v_cnt || ' balance=' || v_balance;
  INSERT INTO _results VALUES ('T04', 'ازدواجية المفتاح بلا خصم ثانٍ', v_actual, v_ok);

  -- T05: باقة مانع حظر ثم تكديسها على مدة متبقية — صف واحد ومدة متراكمة
  SELECT price_coins INTO v_price FROM public.protection_products WHERE id = v_product_bundle;
  v_balance := 60000 - v_price;
  UPDATE public.users SET balance_gold = 60000 WHERE id = v_owner;
  v_result := public.settle_protection_purchase(v_owner, v_product_bundle, 'm8prot-test-ban-01');
  SELECT balance_gold INTO v_cnt FROM public.users WHERE id = v_owner;
  v_ok := v_cnt = v_balance AND (v_result->>'kind') = 'anti_ban';
  v_actual := 'balance=' || v_cnt || ' expected=' || v_balance;
  INSERT INTO _results VALUES ('T05a', 'شراء باقة الحظر يخصم سعرها', v_actual, v_ok);
  v_result := public.settle_protection_purchase(v_owner, v_product_bundle, 'm8prot-test-ban-02');
  SELECT count(*), max(extract(epoch FROM (expires_at - now())) / 86400)::int
    INTO v_cnt, v_num
    FROM public.user_protections WHERE user_id = v_owner AND kind = 'anti_ban';
  -- التكديس: 90 + 90 = 180 يوماً تقريباً من الآن
  v_ok := v_cnt = 1 AND v_num BETWEEN 179 AND 181;
  v_actual := 'rows=' || v_cnt || ' days_left=' || v_num;
  INSERT INTO _results VALUES ('T05b', 'تكديس الباقة على نفس الصف يمدد المدة', v_actual, v_ok);

  -- T06: شراء دائم — expires_at = NULL، ورفض شراء دائم ثانٍ
  UPDATE public.users SET balance_gold = 100000 WHERE id = v_target;
  v_result := public.settle_protection_purchase(v_target, v_product_perm, 'm8prot-test-perm-01');
  v_ok := (v_result->>'expires_at') IS NULL;
  v_actual := 'expires=' || coalesce(v_result->>'expires_at', 'NULL');
  INSERT INTO _results VALUES ('T06', 'شراء دائم يُلغي تاريخ الانتهاء', v_actual, v_ok);

  -- T07: غرفة اختبار والهدف حاضرها
  INSERT INTO public.rooms (name, owner_id, livekit_room_id, is_private, seat_count, status)
  VALUES ('غرفة اختبار الحماية M8', v_owner, 'm8prot-test-room-1', false, 8, 'live')
  RETURNING id INTO v_room;
  INSERT INTO public.room_presence (room_id, user_id, session_id)
  VALUES (v_room, v_target, 'm8prot-test-session-1');

  -- T08: VIP بحماية الغرف يمنع الطرد والحظر من المالك
  UPDATE public.vip_tiers SET room_kick_protection = false WHERE tier <> 5;
  UPDATE public.vip_tiers SET room_kick_protection = true WHERE tier = 5;
  INSERT INTO public.vip_subscriptions (
    user_id, tier, purchase_kind, duration_days, price_coins_paid,
    discount_percent, paid_coins, starts_at, expires_at, idempotency_key
  ) VALUES (
    v_target, 5, 'initial', 30, 15000, 0, 15000, now(), now() + interval '20 days', 'm8prot-vip-seed-01'
  );
  PERFORM set_config('request.jwt.claims',
    jsonb_build_object('sub', v_owner::text, 'role', 'authenticated')::text, true);
  BEGIN
    PERFORM public.room_manage_action(v_room, v_owner, 'kick_user', v_target, NULL, NULL, 'اختبار');
    v_ok := false; v_actual := 'قُبل طرد VIP محمي — خطأ';
  EXCEPTION WHEN OTHERS THEN
    v_ok := position('VIP' in SQLERRM) > 0; v_actual := SQLERRM;
  END;
  INSERT INTO _results VALUES ('T08a', 'VIP يمنع طرد المشرفين للعضو', v_actual, v_ok);
  BEGIN
    PERFORM public.room_manage_action(v_room, v_owner, 'ban_user', v_target, NULL, NULL, 'اختبار');
    v_ok := false; v_actual := 'قُبل حظر VIP محمي — خطأ';
  EXCEPTION WHEN OTHERS THEN
    v_ok := position('VIP' in SQLERRM) > 0; v_actual := SQLERRM;
  END;
  INSERT INTO _results VALUES ('T08b', 'VIP يمنع حظر المشرفين للعضو', v_actual, v_ok);
  PERFORM set_config('request.jwt.claims', jsonb_build_object('role', 'service_role')::text, true);

  -- T09: الحمايات المدفوعة داخل الغرف — VIP أزيل لتطهير التداخل؛
  -- v_target يحمل مانع طرد دائماً (من T06) ومانع حظر مؤقت (بذر هنا)
  DELETE FROM public.vip_subscriptions WHERE idempotency_key = 'm8prot-vip-seed-01';
  UPDATE public.vip_tiers SET room_kick_protection = false WHERE tier = 5;
  INSERT INTO public.user_protections (user_id, kind, product_id, expires_at, idempotency_key)
  VALUES (v_target, 'anti_ban', v_product_bundle, now() + interval '10 days', 'm8prot-ban-seed-01')
  ON CONFLICT (user_id, kind) DO UPDATE SET expires_at = now() + interval '10 days';
  PERFORM set_config('request.jwt.claims',
    jsonb_build_object('sub', v_owner::text, 'role', 'authenticated')::text, true);
  BEGIN
    PERFORM public.room_manage_action(v_room, v_owner, 'kick_user', v_target, NULL, NULL, 'اختبار');
    v_ok := false; v_actual := 'قُبل طرد محمي بمانع طرد — خطأ';
  EXCEPTION WHEN OTHERS THEN
    v_ok := position('مانع الطرد' in SQLERRM) > 0; v_actual := SQLERRM;
  END;
  INSERT INTO _results VALUES ('T09a', 'مانع الطرد المدفوع يمنع الطرد', v_actual, v_ok);
  BEGIN
    PERFORM public.room_manage_action(v_room, v_owner, 'ban_user', v_target, 60, NULL, 'اختبار');
    v_ok := false; v_actual := 'قُبل حظر محمي بمانع حظر — خطأ';
  EXCEPTION WHEN OTHERS THEN
    v_ok := position('مانع الحظر' in SQLERRM) > 0; v_actual := SQLERRM;
  END;
  INSERT INTO _results VALUES ('T09b', 'مانع الحظر المدفوع يمنع الحظر', v_actual, v_ok);
  -- نزع مانع الحظر فقط: الحظر يمر رغم بقاء مانع الطرد الدائم
  UPDATE public.user_protections
    SET expires_at = now() - interval '1 hour'
    WHERE user_id = v_target AND kind = 'anti_ban';
  BEGIN
    PERFORM public.room_manage_action(v_room, v_owner, 'ban_user', v_target, 60, NULL, 'اختبار');
    v_ok := true; v_actual := 'قُبل الحظر (مانع الطرد لا يحمي من الحظر)';
  EXCEPTION WHEN OTHERS THEN
    v_ok := false; v_actual := 'حُجب الحظر خاطئاً: ' || SQLERRM;
  END;
  INSERT INTO _results VALUES ('T09c', 'مانع الطرد لا يحمي من الحظر', v_actual, v_ok);
  PERFORM set_config('request.jwt.claims', jsonb_build_object('role', 'service_role')::text, true);

  -- T10: الإدارة تتدخل بالكامل رغم الحماية
  UPDATE public.room_seats
    SET user_id = v_target, status = 'occupied' WHERE room_id = v_room AND seat_index = 1;
  INSERT INTO public.room_presence (room_id, user_id, session_id)
  VALUES (v_room, v_target, 'm8prot-test-session-1')
  ON CONFLICT DO NOTHING;
  DELETE FROM public.room_bans WHERE room_id = v_room AND user_id = v_target;
  PERFORM set_config('request.jwt.claims',
    jsonb_build_object('sub', v_admin::text, 'role', 'authenticated')::text, true);
  BEGIN
    PERFORM public.room_manage_action(v_room, v_admin, 'kick_user', v_target, NULL, NULL, 'تدخل إداري');
    v_ok := true; v_actual := 'قُبل تدخل الإدارة';
  EXCEPTION WHEN OTHERS THEN
    v_ok := false; v_actual := 'رُفض تدخل الإدارة: ' || SQLERRM;
  END;
  INSERT INTO _results VALUES ('T10', 'الإدارة تتجاوز الحماية', v_actual, v_ok);
  PERFORM set_config('request.jwt.claims', jsonb_build_object('role', 'service_role')::text, true);

  -- T11: الوكالة تتدخل ضمن صلاحياتها رغم الحماية — ننشئ وكالة ووكيلاً
  -- اختبارَين داخل المعاملة بدل الاعتماد على بيانات قائمة
  SELECT u.id INTO v_agent FROM public.users u
  WHERE u.role = 'user' AND u.status = 'active'
    AND u.id <> v_owner AND u.id <> v_target
  ORDER BY u.created_at LIMIT 1;
  IF v_agent IS NOT NULL THEN
    INSERT INTO public.agencies (name, status, owner_user_id, can_approve_hosts)
    VALUES ('وكالة اختبار حماية M8', 'active', v_agent, false)
    RETURNING id INTO v_agency_id;
    INSERT INTO public.agents (user_id, created_by_admin_id, agency_id, status)
    VALUES (v_agent, v_admin, v_agency_id, 'active')
    RETURNING id INTO v_agent_id;
    UPDATE public.users SET referred_by_agent_id = v_agent_id WHERE id = v_owner;
    -- غرفة جديدة يملكها المستخدم المرتبط بالوكيل الاختباري
    INSERT INTO public.rooms (name, owner_id, livekit_room_id, is_private, seat_count, status)
    VALUES ('غرفة وكالة M8', v_owner, 'm8prot-test-agency-room', false, 8, 'live')
    RETURNING id INTO v_room;
    INSERT INTO public.room_presence (room_id, user_id, session_id)
    VALUES (v_room, v_target, 'm8prot-test-session-1');
    PERFORM set_config('request.jwt.claims',
      jsonb_build_object('sub', v_agent::text, 'role', 'authenticated')::text, true);
    BEGIN
      v_result := public.room_manage_action(v_room, v_agent, 'kick_user', v_target, NULL, NULL, 'تدخل وكالة');
      v_ok := (v_result->>'actor_role') IN ('agency_manager', 'agency_agent');
      v_actual := 'قُبل تدخل الوكالة بدور ' || (v_result->>'actor_role');
    EXCEPTION WHEN OTHERS THEN
      v_ok := false; v_actual := 'رُفض تدخل الوكالة: ' || SQLERRM;
    END;
    INSERT INTO _results VALUES ('T11', 'الوكالة تتجاوز الحماية ضمن صلاحياتها', v_actual, v_ok);
    PERFORM set_config('request.jwt.claims', jsonb_build_object('role', 'service_role')::text, true);
  ELSE
    INSERT INTO _results VALUES ('T11', 'تدخل الوكالة', 'لا مستخدم ثالث لإنشاء وكيل — تُخطَّر', true);
  END IF;

  -- T12: مفتاح التعطيل
  UPDATE public.admin_settings SET value = 'false'::jsonb WHERE key = 'protection_purchase_enabled';
  BEGIN
    PERFORM public.settle_protection_purchase(v_target, v_product_sub, 'm8prot-test-dis-01');
    v_ok := false; v_actual := 'قُبل والشراء متوقف — خطأ';
  EXCEPTION WHEN OTHERS THEN
    v_ok := true; v_actual := 'مرفوض: ' || SQLERRM;
  END;
  UPDATE public.admin_settings SET value = 'true'::jsonb WHERE key = 'protection_purchase_enabled';
  INSERT INTO _results VALUES ('T12', 'مفتاح تعطيل الحمايات', v_actual, v_ok);

  -- T13: بوابات الصلاحية — المستخدم لا يستدعي دوال الخدمة/الإدارة
  PERFORM set_config('request.jwt.claims',
    jsonb_build_object('sub', v_target::text, 'role', 'authenticated')::text, true);
  BEGIN
    PERFORM public.settle_protection_purchase(v_target, v_product_sub, 'm8prot-test-gate-01');
    v_ok := false; v_actual := 'قُبل من مستخدم — خطأ';
  EXCEPTION WHEN OTHERS THEN
    v_ok := position('Not authorized' in SQLERRM) > 0;
    v_actual := SQLERRM;
  END;
  BEGIN
    PERFORM public.admin_upsert_protection_product(v_target, v_product_sub,
      jsonb_build_object('kind','anti_kick','mode','subscription','name_ar','x','price_coins',1000,'duration_days',30),
      'محاولة غير مصرحة');
    v_ok := v_ok AND false; v_actual := v_actual || ' | إدارة قُبلت — خطأ';
  EXCEPTION WHEN OTHERS THEN
    v_ok := v_ok AND position('غير مصرح' in SQLERRM) > 0;
    v_actual := v_actual || ' | ' || SQLERRM;
  END;
  INSERT INTO _results VALUES ('T13', 'بوابات service_role و protection.manage', v_actual, v_ok);
  PERFORM set_config('request.jwt.claims', jsonb_build_object('role', 'service_role')::text, true);
END $do$;

SELECT * FROM _results ORDER BY step;

ROLLBACK;
