-- ============================================================
-- diagnostics/18_m8_loyalty_streak_test.sql
-- اختبار وظيفي لترحيل #78 (M8.9 — نقاط الولاء) داخل BEGIN … ROLLBACK.
-- يغطي: الإعدادات الافتراضية، أول مطالبة، منع التكرار في اليوم نفسه،
-- الاستمرار من الأمس، إعادة البدء عند الفجوة، عتبات الشارات وثباتها
-- بعد الانقطاع، سقف الزيادة اليومية، أن النقاط لا تمس المحفظة ولا
-- تُحوَّل إلى رصيد، مفتاح التعطيل، منع الكتابة من العميل، وطلب
-- بلا مصادقة، وشكل get_my_loyalty.
-- متطلب سابق: #78 (والنوع loyalty_streak من #74).
-- ============================================================
BEGIN;

CREATE TEMP TABLE _results (step text, expected text, actual text, ok boolean) ON COMMIT DROP;

DO $do$
DECLARE
  v_admin uuid := '2488de9e-97d9-4fa6-aa0a-856de7189287';
  v_user uuid;
  v_cfg jsonb;
  v_row public.loyalty_streaks%ROWTYPE;
  v_res jsonb;
  v_ok boolean;
  v_actual text;
  v_today date;
  v_cnt integer;
  v_num bigint;
  v_balance_before bigint;
  v_tx_before bigint;
  v_claims integer;
BEGIN
  PERFORM set_config('request.jwt.claims', jsonb_build_object('role', 'service_role')::text, true);

  SELECT u.id INTO v_user FROM public.users u
  WHERE u.role = 'user' AND u.status = 'active'
  ORDER BY u.created_at LIMIT 1;
  IF v_user IS NULL THEN
    INSERT INTO _results VALUES ('T00', 'وجود مستخدم اختبار', 'لا يوجد', false);
    RETURN;
  END IF;

  -- تهيئة معزولة: إعدادات افتراضية معروفة وحالة نظيفة
  UPDATE public.admin_settings SET value = 'true'::jsonb WHERE key = 'loyalty_enabled';
  UPDATE public.admin_settings SET value = '10'::jsonb WHERE key = 'loyalty_points_base';
  UPDATE public.admin_settings SET value = '5'::jsonb WHERE key = 'loyalty_points_step';
  UPDATE public.admin_settings SET value = '6'::jsonb WHERE key = 'loyalty_points_cap_days';
  UPDATE public.admin_settings SET value =
    '[{"days":3,"key":"loyalty_bronze","label":"وفيّ"},{"days":7,"key":"loyalty_silver","label":"مواظب"},{"days":14,"key":"loyalty_gold","label":"مخلص"},{"days":30,"key":"loyalty_platinum","label":"أسطوري"}]'::jsonb
    WHERE key = 'loyalty_badges';
  DELETE FROM public.loyalty_claims WHERE user_id = v_user;
  DELETE FROM public.loyalty_streaks WHERE user_id = v_user;
  UPDATE public.users SET balance_gold = 12345 WHERE id = v_user;

  v_cfg := public.loyalty_settings();
  v_today := public.loyalty_today(v_cfg ->> 'timezone');

  -- T01: الإعدادات مزروعة والقيم صالحة
  v_ok := coalesce((v_cfg ->> 'enabled')::boolean, false)
    AND (v_cfg ->> 'base')::int = 10
    AND (v_cfg ->> 'step')::int = 5
    AND (v_cfg ->> 'cap_days')::int = 6
    AND jsonb_typeof(v_cfg -> 'badges') = 'array'
    AND jsonb_array_length(v_cfg -> 'badges') = 4
    AND char_length(coalesce(v_cfg ->> 'timezone', '')) >= 3;
  v_actual := 'base=' || (v_cfg ->> 'base') || ' step=' || (v_cfg ->> 'step')
    || ' cap=' || (v_cfg ->> 'cap_days') || ' badges=' || jsonb_array_length(v_cfg -> 'badges')
    || ' tz=' || coalesce(v_cfg ->> 'timezone', 'NULL');
  INSERT INTO _results VALUES ('T01', 'إعدادات الولاء مزروعة وصالحة', v_actual, v_ok);

  -- T02: أول مطالبة — سلسلة 1 ونقاط الأساس بلا أي حركة محفظة
  SELECT u.balance_gold INTO v_balance_before FROM public.users u WHERE u.id = v_user;
  SELECT count(*) INTO v_tx_before FROM public.wallet_transactions WHERE user_id = v_user;
  PERFORM set_config('request.jwt.claims',
    jsonb_build_object('sub', v_user::text, 'role', 'authenticated')::text, true);
  v_res := public.claim_daily_loyalty();
  PERFORM set_config('request.jwt.claims', jsonb_build_object('role', 'service_role')::text, true);
  SELECT * INTO v_row FROM public.loyalty_streaks WHERE user_id = v_user;
  SELECT count(*) INTO v_num FROM public.wallet_transactions WHERE user_id = v_user;
  SELECT count(*) INTO v_claims FROM public.loyalty_claims WHERE user_id = v_user AND claim_date = v_today;
  v_ok := (v_res ->> 'status') = 'claimed'
    AND (v_res ->> 'points_awarded')::int = 10
    AND v_row.streak_days = 1
    AND v_row.best_streak = 1
    AND v_row.total_points = 10
    AND v_row.last_claim_date = v_today
    AND v_claims = 1
    AND v_num = v_tx_before;
  v_actual := 'status=' || (v_res ->> 'status') || ' pts=' || (v_res ->> 'points_awarded')
    || ' streak=' || v_row.streak_days || ' total=' || v_row.total_points
    || ' wallet_tx=' || v_num || ' (قبل=' || v_tx_before || ')';
  INSERT INTO _results VALUES ('T02', 'أول مطالبة: 10 نقاط وسلسلة 1 بلا محفظة', v_actual, v_ok);

  -- T03: المطالبة نفسها في اليوم نفسه مرفوضة (منع التكرار خادمياً)
  PERFORM set_config('request.jwt.claims',
    jsonb_build_object('sub', v_user::text, 'role', 'authenticated')::text, true);
  v_res := public.claim_daily_loyalty();
  PERFORM set_config('request.jwt.claims', jsonb_build_object('role', 'service_role')::text, true);
  SELECT count(*) INTO v_claims FROM public.loyalty_claims WHERE user_id = v_user;
  SELECT * INTO v_row FROM public.loyalty_streaks WHERE user_id = v_user;
  v_ok := (v_res ->> 'status') = 'already_claimed'
    AND (v_res ->> 'points_awarded')::int = 0
    AND v_row.total_points = 10
    AND v_claims = 1;
  v_actual := 'status=' || (v_res ->> 'status') || ' pts=' || (v_res ->> 'points_awarded')
    || ' total=' || v_row.total_points || ' claims=' || v_claims;
  INSERT INTO _results VALUES ('T03', 'منع المطالبة مرتين في اليوم نفسه', v_actual, v_ok);

  -- T04: الاستمرار من الأمس ⇒ +1 ونقاط الأساس + خطوة واحدة
  DELETE FROM public.loyalty_claims WHERE user_id = v_user AND claim_date = v_today;
  UPDATE public.loyalty_streaks
  SET streak_days = 1, best_streak = 1, last_claim_date = v_today - 1, total_points = 10
  WHERE user_id = v_user;
  PERFORM set_config('request.jwt.claims',
    jsonb_build_object('sub', v_user::text, 'role', 'authenticated')::text, true);
  v_res := public.claim_daily_loyalty();
  PERFORM set_config('request.jwt.claims', jsonb_build_object('role', 'service_role')::text, true);
  SELECT * INTO v_row FROM public.loyalty_streaks WHERE user_id = v_user;
  v_ok := (v_res ->> 'status') = 'claimed'
    AND (v_res ->> 'points_awarded')::int = 15
    AND v_row.streak_days = 2
    AND v_row.total_points = 25
    AND v_row.last_claim_date = v_today;
  v_actual := 'pts=' || (v_res ->> 'points_awarded') || ' streak=' || v_row.streak_days
    || ' total=' || v_row.total_points;
  INSERT INTO _results VALUES ('T04', 'الاستمرار من الأمس: +1 و15 نقطة', v_actual, v_ok);

  -- T05: فجوة ⇒ إعادة البدء من 1 مع بقاء أفضل سلسلة
  DELETE FROM public.loyalty_claims WHERE user_id = v_user AND claim_date = v_today;
  UPDATE public.loyalty_streaks
  SET streak_days = 9, best_streak = 9, last_claim_date = v_today - 3, total_points = 100
  WHERE user_id = v_user;
  PERFORM set_config('request.jwt.claims',
    jsonb_build_object('sub', v_user::text, 'role', 'authenticated')::text, true);
  v_res := public.claim_daily_loyalty();
  PERFORM set_config('request.jwt.claims', jsonb_build_object('role', 'service_role')::text, true);
  SELECT * INTO v_row FROM public.loyalty_streaks WHERE user_id = v_user;
  v_ok := v_row.streak_days = 1
    AND v_row.best_streak = 9
    AND (v_res ->> 'points_awarded')::int = 10
    AND v_row.total_points = 110;
  v_actual := 'streak=' || v_row.streak_days || ' best=' || v_row.best_streak
    || ' pts=' || (v_res ->> 'points_awarded') || ' total=' || v_row.total_points;
  INSERT INTO _results VALUES ('T05', 'الفجوة تعيد السلسلة إلى 1', v_actual, v_ok);

  -- T06: بلوغ عتبة 3 أيام يمنح الشارة ويُشعر المستخدم
  DELETE FROM public.loyalty_claims WHERE user_id = v_user AND claim_date = v_today;
  UPDATE public.loyalty_streaks
  SET streak_days = 2, best_streak = 2, last_claim_date = v_today - 1, total_points = 25, badge = NULL
  WHERE user_id = v_user;
  DELETE FROM public.user_notifications WHERE user_id = v_user AND event_type = 'loyalty_streak';
  PERFORM set_config('request.jwt.claims',
    jsonb_build_object('sub', v_user::text, 'role', 'authenticated')::text, true);
  v_res := public.claim_daily_loyalty();
  PERFORM set_config('request.jwt.claims', jsonb_build_object('role', 'service_role')::text, true);
  SELECT * INTO v_row FROM public.loyalty_streaks WHERE user_id = v_user;
  SELECT count(*) INTO v_cnt FROM public.user_notifications
    WHERE user_id = v_user AND event_type = 'loyalty_streak';
  SELECT count(*) INTO v_claims FROM public.loyalty_claims
    WHERE user_id = v_user AND claim_date = v_today AND badge = 'loyalty_bronze';
  v_ok := v_row.streak_days = 3
    AND v_row.badge = 'loyalty_bronze'
    AND coalesce((v_res ->> 'badge_awarded')::boolean, false)
    AND (v_res ->> 'points_awarded')::int = 20
    AND v_cnt >= 1
    AND v_claims = 1;
  v_actual := 'streak=' || v_row.streak_days || ' badge=' || coalesce(v_row.badge, 'NULL')
    || ' awarded=' || coalesce(v_res ->> 'badge_awarded', 'NULL')
    || ' pts=' || (v_res ->> 'points_awarded') || ' notifs=' || v_cnt;
  INSERT INTO _results VALUES ('T06', 'عتبة 3 أيام تمنح شارة وإشعاراً', v_actual, v_ok);

  -- T07: الشارة تبقى بعد انقطاع السلسلة (لا تُسحب)
  DELETE FROM public.loyalty_claims WHERE user_id = v_user AND claim_date = v_today;
  UPDATE public.loyalty_streaks
  SET streak_days = 1, best_streak = 3, last_claim_date = v_today - 2, badge = 'loyalty_bronze'
  WHERE user_id = v_user;
  PERFORM set_config('request.jwt.claims',
    jsonb_build_object('sub', v_user::text, 'role', 'authenticated')::text, true);
  v_res := public.claim_daily_loyalty();
  PERFORM set_config('request.jwt.claims', jsonb_build_object('role', 'service_role')::text, true);
  SELECT * INTO v_row FROM public.loyalty_streaks WHERE user_id = v_user;
  v_ok := v_row.streak_days = 1
    AND v_row.badge = 'loyalty_bronze'
    AND coalesce((v_res ->> 'badge_awarded')::boolean, false) = false;
  v_actual := 'streak=' || v_row.streak_days || ' badge=' || coalesce(v_row.badge, 'NULL')
    || ' awarded=' || coalesce(v_res ->> 'badge_awarded', 'NULL');
  INSERT INTO _results VALUES ('T07', 'الشارة المكتسبة تبقى بعد الانقطاع', v_actual, v_ok);

  -- T08: سقف الزيادة اليومية — السلسلة الطويلة لا ترفع النقاط بلا حد
  DELETE FROM public.loyalty_claims WHERE user_id = v_user AND claim_date = v_today;
  UPDATE public.loyalty_streaks
  SET streak_days = 20, best_streak = 20, last_claim_date = v_today - 1, total_points = 0
  WHERE user_id = v_user;
  PERFORM set_config('request.jwt.claims',
    jsonb_build_object('sub', v_user::text, 'role', 'authenticated')::text, true);
  v_res := public.claim_daily_loyalty();
  PERFORM set_config('request.jwt.claims', jsonb_build_object('role', 'service_role')::text, true);
  -- 10 + 5 × 6 (السقف) = 40 لا أكثر مهما طالت السلسلة
  v_ok := (v_res ->> 'points_awarded')::int = 40 AND (v_res ->> 'streak_days')::int = 21;
  v_actual := 'streak=' || (v_res ->> 'streak_days') || ' pts=' || (v_res ->> 'points_awarded');
  INSERT INTO _results VALUES ('T08', 'سقف الزيادة اليومية يعمل', v_actual, v_ok);

  -- T09: النقاط لا تمس الرصيد ولا دفتر المحفظة إطلاقاً
  SELECT u.balance_gold INTO v_num FROM public.users u WHERE u.id = v_user;
  SELECT count(*) INTO v_tx_before FROM public.wallet_transactions WHERE user_id = v_user;
  SELECT coalesce(sum(total_points), 0) INTO v_balance_before FROM public.loyalty_streaks WHERE user_id = v_user;
  -- الشرط الحقيقي: لا يوجد أي قيد في المحفظة مرتبط بالولاء
  SELECT count(*) INTO v_cnt FROM public.wallet_transactions
    WHERE user_id = v_user AND (reference_type = 'loyalty' OR reason ILIKE '%ولاء%');
  v_ok := v_cnt = 0 AND v_balance_before > 0 AND v_num = 12345;
  v_actual := 'wallet_tx_loyalty=' || v_cnt || ' balance=' || v_num || ' loyalty_points=' || v_balance_before;
  INSERT INTO _results VALUES ('T09', 'نقاط الولاء لا تدخل المحفظة/الرصيد', v_actual, v_ok);

  -- T10: مفتاح التعطيل يوقف المنح بلا خطأ
  UPDATE public.admin_settings SET value = 'false'::jsonb WHERE key = 'loyalty_enabled';
  UPDATE public.loyalty_streaks
  SET last_claim_date = v_today - 1, streak_days = 4, total_points = 60 WHERE user_id = v_user;
  PERFORM set_config('request.jwt.claims',
    jsonb_build_object('sub', v_user::text, 'role', 'authenticated')::text, true);
  v_res := public.claim_daily_loyalty();
  PERFORM set_config('request.jwt.claims', jsonb_build_object('role', 'service_role')::text, true);
  SELECT * INTO v_row FROM public.loyalty_streaks WHERE user_id = v_user;
  v_ok := (v_res ->> 'status') = 'disabled'
    AND (v_res ->> 'points_awarded')::int = 0
    AND v_row.total_points = 60
    AND v_row.last_claim_date = v_today - 1;
  v_actual := 'status=' || (v_res ->> 'status') || ' total=' || v_row.total_points
    || ' last=' || v_row.last_claim_date;
  INSERT INTO _results VALUES ('T10', 'تعطيل الولاء يوقف المنح', v_actual, v_ok);
  UPDATE public.admin_settings SET value = 'true'::jsonb WHERE key = 'loyalty_enabled';

  -- T11: صلاحيات الجداول — قراءة فقط للمستخدم، والتنفيذ للمصادقين فقط
  v_ok := has_table_privilege('authenticated', 'public.loyalty_streaks', 'SELECT')
    AND NOT has_table_privilege('authenticated', 'public.loyalty_streaks', 'INSERT')
    AND NOT has_table_privilege('authenticated', 'public.loyalty_streaks', 'UPDATE')
    AND NOT has_table_privilege('authenticated', 'public.loyalty_claims', 'INSERT')
    AND NOT has_table_privilege('anon', 'public.loyalty_streaks', 'SELECT')
    AND NOT has_function_privilege('anon', 'public.claim_daily_loyalty()', 'EXECUTE')
    AND has_function_privilege('authenticated', 'public.claim_daily_loyalty()', 'EXECUTE');
  v_actual := 'auth_select=' || has_table_privilege('authenticated', 'public.loyalty_streaks', 'SELECT')
    || ' auth_update=' || has_table_privilege('authenticated', 'public.loyalty_streaks', 'UPDATE')
    || ' auth_insert_claims=' || has_table_privilege('authenticated', 'public.loyalty_claims', 'INSERT')
    || ' anon_exec=' || has_function_privilege('anon', 'public.claim_daily_loyalty()', 'EXECUTE');
  INSERT INTO _results VALUES ('T11', 'جداول الولاء قراءة فقط للمستخدم', v_actual, v_ok);

  -- T12: مطالبة بلا مصادقة تُرفض
  PERFORM set_config('request.jwt.claims', jsonb_build_object('role', 'authenticated')::text, true);
  BEGIN
    PERFORM public.claim_daily_loyalty();
    v_ok := false; v_actual := 'قُبلت بلا هوية — خطأ';
  EXCEPTION WHEN OTHERS THEN
    v_ok := position('Authentication required' in SQLERRM) > 0;
    v_actual := SQLERRM;
  END;
  INSERT INTO _results VALUES ('T12', 'المطالبة تتطلب مصادقة', v_actual, v_ok);

  -- T13: get_my_loyalty شكل صحيح ويطابق الحالة بعد التعطيل/الإرجاع
  PERFORM set_config('request.jwt.claims', jsonb_build_object('role', 'service_role')::text, true);
  UPDATE public.loyalty_streaks
  SET streak_days = 4, best_streak = 20, last_claim_date = v_today, total_points = 60 WHERE user_id = v_user;
  PERFORM set_config('request.jwt.claims',
    jsonb_build_object('sub', v_user::text, 'role', 'authenticated')::text, true);
  v_res := public.get_my_loyalty();
  v_ok := v_res ? 'enabled' AND v_res ? 'streak_days' AND v_res ? 'best_streak'
    AND v_res ? 'total_points' AND v_res ? 'badge' AND v_res ? 'claimed_today'
    AND v_res ? 'points_if_claimed_now' AND v_res ? 'badges' AND v_res ? 'note'
    AND coalesce((v_res ->> 'claimed_today')::boolean, false)
    AND (v_res ->> 'points_if_claimed_now')::int = 0
    AND (v_res ->> 'streak_days')::int = 4;
  v_actual := 'streak=' || (v_res ->> 'streak_days') || ' total=' || (v_res ->> 'total_points')
    || ' claimed=' || (v_res ->> 'claimed_today')
    || ' if_now=' || (v_res ->> 'points_if_claimed_now')
    || ' badge=' || coalesce(v_res ->> 'badge', 'NULL');
  INSERT INTO _results VALUES ('T13', 'get_my_loyalty حالة صحيحة للتطبيق', v_actual, v_ok);

  -- T14: كتالوج الشارات يُقرأ من الإعدادات (لا قيم ثابتة في الكود)
  PERFORM set_config('request.jwt.claims', jsonb_build_object('role', 'service_role')::text, true);
  UPDATE public.admin_settings SET value = '[{"days":5,"key":"custom_badge","label":"مخصص"}]'::jsonb
    WHERE key = 'loyalty_badges';
  PERFORM set_config('request.jwt.claims',
    jsonb_build_object('sub', v_user::text, 'role', 'authenticated')::text, true);
  v_res := public.get_my_loyalty();
  v_ok := jsonb_array_length(v_res -> 'badges') = 1
    AND (v_res -> 'badges' -> 0 ->> 'key') = 'custom_badge'
    AND (v_res -> 'next_badge' ->> 'days')::int = 5;
  v_actual := 'badges=' || jsonb_array_length(v_res -> 'badges')
    || ' key=' || (v_res -> 'badges' -> 0 ->> 'key')
    || ' next_days=' || coalesce(v_res -> 'next_badge' ->> 'days', 'NULL');
  INSERT INTO _results VALUES ('T14', 'كتالوج الشارات من الإعدادات', v_actual, v_ok);
END $do$;

SELECT * FROM _results ORDER BY step;

ROLLBACK;
