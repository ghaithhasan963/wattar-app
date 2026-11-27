-- ============================================================
-- diagnostics/15_m8_vip_test.sql
-- اختبار وظيفي لترحيل #75 (M8.4 — نظام VIP ١–١٠) داخل BEGIN … ROLLBACK.
-- يغطي: الكتالوج العام، إدارة الدرجة، الشراء الأول، ازدواجية المفتاح،
-- التجديد المُسلسل، الترقية بفرق عادل، رفض التنزيل، مفتاح التعطيل،
-- درجة غير مفعلة، بوابات الصلاحية، والعروض الترويجية.
-- متطلب سابق: تطبيق patch_m8_enum_prep.sql و patch_m8_hosts_contracts_targets.sql
-- (لصلاحيات vip.* وتوسيع أنواع الإشعارات) ثم patch_m8_vip.sql.
-- ============================================================
BEGIN;

CREATE TEMP TABLE _results (step text, expected text, actual text, ok boolean) ON COMMIT DROP;

DO $do$
DECLARE
  v_admin uuid := '2488de9e-97d9-4fa6-aa0a-856de7189287';
  v_user uuid;
  v_user2 uuid;
  v_ok boolean;
  v_actual text;
  v_result jsonb;
  v_catalog jsonb;
  v_balance bigint;
  v_sub1 uuid;
  v_sub2 uuid;
  v_credit bigint;
  v_num bigint;
  v_cnt integer;
  v_tx uuid;
  v_rev integer;
  v_row jsonb;
BEGIN
  PERFORM set_config('request.jwt.claims', jsonb_build_object('role', 'service_role')::text, true);

  -- اختيار مستخدمين اختبار نشطين
  SELECT u.id INTO v_user
  FROM public.users u
  WHERE u.role = 'user' AND u.status = 'active'
  ORDER BY u.created_at LIMIT 1;
  SELECT u.id INTO v_user2
  FROM public.users u
  WHERE u.role = 'user' AND u.status = 'active' AND u.id <> v_user
  ORDER BY u.created_at LIMIT 1;
  IF v_user IS NULL OR v_user2 IS NULL THEN
    INSERT INTO _results VALUES ('T00', 'وجود مستخدمين اختبار', 'لا يوجد', false);
    RETURN;
  END IF;

  -- T01: الكتالوج العام — ١٠ درجات نشطة وسعر فعلي سليم
  v_catalog := public.get_public_vip_tiers();
  SELECT (e->>'effective_price_coins')::bigint INTO v_num
  FROM jsonb_array_elements(v_catalog) e WHERE (e->>'tier')::int = 3;
  v_ok := jsonb_array_length(v_catalog) = 10 AND v_num = 9000;
  v_actual := 'tiers=' || jsonb_array_length(v_catalog) || ' tier3=' || coalesce(v_num::text, 'NULL');
  INSERT INTO _results VALUES ('T01', 'كتالوج ١٠ درجات وسعر فعلي', v_actual, v_ok);

  -- T02: إدارة درجة من اللوحة (تحديث سعر) + سجل تدقيق
  PERFORM public.admin_upsert_vip_tier(v_admin, 1,
    jsonb_build_object('name_ar','VIP 1','duration_days',30,'price_coins',1234,
      'is_active',true,'perks','["ميزة اختبار"]'::jsonb),
    'اختبار تحديث سعر');
  SELECT (t->>'price_coins')::bigint INTO v_num
  FROM jsonb_array_elements(public.get_public_vip_tiers()) t WHERE (t->>'tier')::int = 1;
  SELECT count(*) INTO v_cnt FROM public.admin_audit_log
    WHERE target_type = 'vip_tier' AND target_id = 1 AND action = 'update';
  v_ok := v_num = 1234 AND v_cnt >= 1;
  v_actual := 'price=' || coalesce(v_num::text, 'NULL') || ' audits=' || v_cnt;
  INSERT INTO _results VALUES ('T02', 'تحديث الدرجة يُسجَّل ويُطبَّق', v_actual, v_ok);

  -- T03: الشراء الأول للدرجة 2 — خصم + قيد محفظة + إيراد + إشعار + حالة نشطة
  UPDATE public.users SET balance_gold = 100000 WHERE id = v_user;
  v_result := public.settle_vip_purchase(v_user, 2, 'm8vip-test-initial-01');
  v_sub1 := (v_result->>'id')::uuid;
  SELECT balance_gold INTO v_balance FROM public.users WHERE id = v_user;
  SELECT id INTO v_tx FROM public.wallet_transactions
    WHERE user_id = v_user AND idempotency_key = 'm8vip-test-initial-01';
  SELECT count(*) INTO v_rev FROM public.revenue_ledger
    WHERE reference_id = v_tx AND currency = 'usd' AND amount = 2.0;
  SELECT count(*) INTO v_cnt FROM public.user_notifications
    WHERE user_id = v_user AND event_type = 'vip_purchase' AND reference_id = v_sub1;
  v_ok := (v_result->>'purchase_kind') = 'initial'
    AND (v_result->>'paid_coins')::bigint = 6000
    AND v_balance = 94000
    AND v_tx IS NOT NULL
    AND v_rev = 1
    AND v_cnt = 1
    AND public.active_vip_tier(v_user) = 2;
  v_actual := 'kind=' || (v_result->>'purchase_kind') || ' paid=' || (v_result->>'paid_coins')
    || ' balance=' || v_balance || ' rev=' || v_rev || ' notif=' || v_cnt
    || ' tier=' || coalesce(public.active_vip_tier(v_user)::text, 'NULL');
  INSERT INTO _results VALUES ('T03', 'شراء أول: خصم وقيد وإيراد وإشعار', v_actual, v_ok);

  -- T04: إعادة نفس المفتاح — بلا خصم ثانٍ وبنفس الاشتراك
  v_result := public.settle_vip_purchase(v_user, 2, 'm8vip-test-initial-01');
  SELECT balance_gold INTO v_balance FROM public.users WHERE id = v_user;
  SELECT count(*) INTO v_cnt FROM public.vip_subscriptions WHERE user_id = v_user;
  v_ok := v_cnt = 1 AND v_balance = 94000 AND (v_result->>'id')::uuid = v_sub1;
  v_actual := 'rows=' || v_cnt || ' balance=' || v_balance;
  INSERT INTO _results VALUES ('T04', 'ازدواجية المفتاح بلا خصم ثانٍ', v_actual, v_ok);

  -- T05: التجديد المُسلسل — صف جديد يبدأ من نهاية الحالي
  v_result := public.settle_vip_purchase(v_user, 2, 'm8vip-test-renew-01');
  v_sub2 := (v_result->>'id')::uuid;
  SELECT balance_gold INTO v_balance FROM public.users WHERE id = v_user;
  SELECT jsonb_build_object('starts', s2.starts_at::text, 'old_expires', s1.expires_at::text,
    'kind', s2.purchase_kind)
    INTO v_row
  FROM public.vip_subscriptions s1, public.vip_subscriptions s2
  WHERE s1.id = v_sub1 AND s2.id = v_sub2;
  v_ok := (v_row->>'kind') = 'renewal'
    AND (v_row->>'starts') = (v_row->>'old_expires')
    AND v_balance = 88000
    AND public.active_vip_tier(v_user) = 2;
  v_actual := 'starts=' || (v_row->>'starts') || ' old_exp=' || (v_row->>'old_expires')
    || ' balance=' || v_balance || ' tier=' || coalesce(public.active_vip_tier(v_user)::text, 'NULL');
  INSERT INTO _results VALUES ('T05', 'تجديد يبدأ من نهاية الحالي', v_actual, v_ok);

  -- T06: الترقية إلى 5 — رصيد التجديد المؤجل (لم يبدأ) يُخصم كاملاً من السعر
  v_result := public.settle_vip_purchase(v_user, 5, 'm8vip-test-upgrade-01');
  SELECT balance_gold INTO v_balance FROM public.users WHERE id = v_user;
  v_credit := (v_result->>'upgrade_credit_coins')::bigint;
  v_num := (v_result->>'paid_coins')::bigint;
  SELECT count(*) INTO v_cnt FROM public.vip_subscriptions
    WHERE user_id = v_user AND status = 'active';
  SELECT jsonb_build_object('kind', s.purchase_kind, 'prev', s.previous_tier)
    INTO v_row
  FROM public.vip_subscriptions s
  WHERE s.user_id = v_user AND s.status = 'active'
  ORDER BY s.created_at DESC LIMIT 1;
  v_ok := v_cnt = 1
    AND v_credit = 6000
    AND v_num = 9000
    AND v_balance = 79000
    AND (v_row->>'kind') = 'upgrade'
    AND (v_row->>'prev')::int = 2
    AND public.active_vip_tier(v_user) = 5;
  v_actual := 'credit=' || v_credit || ' due=' || v_num || ' balance=' || v_balance
    || ' kind=' || (v_row->>'kind') || ' prev=' || coalesce((v_row->>'prev')::text, 'NULL')
    || ' tier=' || coalesce(public.active_vip_tier(v_user)::text, 'NULL');
  INSERT INTO _results VALUES ('T06', 'ترقية بفرق عادل ورصيد متبقٍ موثق', v_actual, v_ok);

  -- T07: حالة التطبيق ترى الدرجة 5
  PERFORM set_config('request.jwt.claims',
    jsonb_build_object('sub', v_user::text, 'role', 'authenticated')::text, true);
  v_result := public.get_my_vip();
  v_ok := (v_result->>'active')::boolean AND (v_result->>'tier')::int = 5;
  v_actual := 'active=' || (v_result->>'active') || ' tier=' || coalesce(v_result->>'tier'::text, 'NULL');
  INSERT INTO _results VALUES ('T07', 'get_my_vip يعرض الدرجة النشطة', v_actual, v_ok);
  PERFORM set_config('request.jwt.claims', jsonb_build_object('role', 'service_role')::text, true);

  -- T08: رفض شراء درجة أقل أثناء اشتراك أعلى نشط
  BEGIN
    PERFORM public.settle_vip_purchase(v_user, 2, 'm8vip-test-downgrade-01');
    v_ok := false; v_actual := 'قُبل تنزيل — خطأ';
  EXCEPTION WHEN OTHERS THEN
    v_ok := true; v_actual := 'مرفوض: ' || SQLERRM;
  END;
  INSERT INTO _results VALUES ('T08', 'رفض شراء درجة أقل أثناء اشتراك أعلى', v_actual, v_ok);

  -- T09: مفتاح التعطيل vip_purchase_enabled
  UPDATE public.admin_settings SET value = 'false'::jsonb WHERE key = 'vip_purchase_enabled';
  BEGIN
    PERFORM public.settle_vip_purchase(v_user2, 1, 'm8vip-test-disabled-01');
    v_ok := false; v_actual := 'قُبل والشراء متوقف — خطأ';
  EXCEPTION WHEN OTHERS THEN
    v_ok := true; v_actual := 'مرفوض: ' || SQLERRM;
  END;
  UPDATE public.admin_settings SET value = 'true'::jsonb WHERE key = 'vip_purchase_enabled';
  INSERT INTO _results VALUES ('T09', 'مفتاح vip_purchase_enabled يوقف الشراء', v_actual, v_ok);

  -- T10: درجة غير مفعلة تُرفض
  PERFORM public.admin_upsert_vip_tier(v_admin, 7,
    jsonb_build_object('name_ar','VIP 7','duration_days',30,'price_coins',21000,'is_active',false),
    'تعطيل اختباري');
  BEGIN
    PERFORM public.settle_vip_purchase(v_user2, 7, 'm8vip-test-inactive-01');
    v_ok := false; v_actual := 'قُبل لدرجة معطلة — خطأ';
  EXCEPTION WHEN OTHERS THEN
    v_ok := true; v_actual := 'مرفوض: ' || SQLERRM;
  END;
  INSERT INTO _results VALUES ('T10', 'درجة غير مفعلة مرفوضة', v_actual, v_ok);

  -- T11: بوابات الصلاحية — المستخدم لا يستدعي دوال الخدمة/الإدارة
  PERFORM set_config('request.jwt.claims',
    jsonb_build_object('sub', v_user2::text, 'role', 'authenticated')::text, true);
  BEGIN
    PERFORM public.settle_vip_purchase(v_user2, 1, 'm8vip-test-gate-01');
    v_ok := false; v_actual := 'قُبل من مستخدم — خطأ';
  EXCEPTION WHEN OTHERS THEN
    v_ok := position('Not authorized' in SQLERRM) > 0;
    v_actual := SQLERRM;
  END;
  BEGIN
    PERFORM public.admin_upsert_vip_tier(v_user2, 1,
      jsonb_build_object('name_ar','VIP 1','duration_days',30,'price_coins',1000), 'محاولة غير مصرحة');
    v_ok := false; v_actual := v_actual || ' | إدارة قُبلت — خطأ';
  EXCEPTION WHEN OTHERS THEN
    v_ok := v_ok AND position('غير مصرح' in SQLERRM) > 0;
    v_actual := v_actual || ' | ' || SQLERRM;
  END;
  INSERT INTO _results VALUES ('T11', 'بوابات service_role و vip.manage', v_actual, v_ok);
  PERFORM set_config('request.jwt.claims', jsonb_build_object('role', 'service_role')::text, true);

  -- T12a: عرض ترويجي سارٍ — خصم ٥٠٪ على الدرجة 3
  PERFORM public.admin_upsert_vip_tier(v_admin, 3,
    jsonb_build_object('name_ar','VIP 3','duration_days',30,'price_coins',9000,
      'is_active',true,'offer_discount_percent',50,
      'offer_ends_at', (now() + interval '1 day')::text),
    'عرض اختباري');
  UPDATE public.users SET balance_gold = 100000 WHERE id = v_user2;
  SELECT (t->>'effective_price_coins')::bigint, (t->>'offer_active')::boolean
    INTO v_num, v_ok
  FROM jsonb_array_elements(public.get_public_vip_tiers()) t WHERE (t->>'tier')::int = 3;
  v_result := public.settle_vip_purchase(v_user2, 3, 'm8vip-test-offer-01');
  SELECT balance_gold INTO v_balance FROM public.users WHERE id = v_user2;
  v_ok := v_ok AND v_num = 4500
    AND (v_result->>'paid_coins')::bigint = 4500
    AND v_balance = 100000 - 4500;
  v_actual := 'effective=' || v_num || ' paid=' || (v_result->>'paid_coins') || ' balance=' || v_balance;
  INSERT INTO _results VALUES ('T12a', 'عرض ترويجي سارٍ يُطبَّق على السعر', v_actual, v_ok);

  -- T12b: انتهاء العرض يلغي الخصم
  PERFORM public.admin_upsert_vip_tier(v_admin, 3,
    jsonb_build_object('name_ar','VIP 3','duration_days',30,'price_coins',9000,
      'is_active',true,'offer_discount_percent',50,
      'offer_ends_at', (now() - interval '1 day')::text),
    'انتهاء العرض');
  SELECT (t->>'effective_price_coins')::bigint INTO v_num
  FROM jsonb_array_elements(public.get_public_vip_tiers()) t WHERE (t->>'tier')::int = 3;
  v_ok := v_num = 9000;
  v_actual := 'effective=' || coalesce(v_num::text, 'NULL');
  INSERT INTO _results VALUES ('T12b', 'عرض منتهٍ لا يُطبَّق', v_actual, v_ok);

  PERFORM set_config('request.jwt.claims', jsonb_build_object('role', 'service_role')::text, true);
END $do$;

SELECT * FROM _results ORDER BY step;

ROLLBACK;
