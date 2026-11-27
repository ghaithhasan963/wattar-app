-- ============================================================
-- diagnostics/17_m8_level_xp_test.sql
-- اختبار وظيفي لترحيل #77 (M8.7 — LV/XP) داخل BEGIN … ROLLBACK.
-- يغطي: المنحنى التصاعدي والسقف القابل للتعديل، خبرة الإنفاق
-- المؤهل فقط (هدايا/ألعاب/شراء) بلا خبرة على الشحن أو الفوز،
-- منع الازدواج بفرد (source, reference)، مسار المهمات القديم على
-- المنحنى الجديد، منح مكافآت الترقية (لقب/كوين) وإشعارها، أن LV
-- لا يمنح حماية من الطرد/الحظر، بوابات الإدارة والتدقيق، ومفتاح
-- التعطيل.
-- متطلب سابق: #77p (enum level_reward) و#74 (إشعار level_up).
-- ============================================================
BEGIN;

CREATE TEMP TABLE _results (step text, expected text, actual text, ok boolean) ON COMMIT DROP;

DO $do$
DECLARE
  v_admin uuid := '2488de9e-97d9-4fa6-aa0a-856de7189287';
  v_user uuid;
  v_other uuid;
  v_tx uuid;
  v_ok boolean;
  v_actual text;
  v_result jsonb;
  v_row jsonb;
  v_cnt integer;
  v_num bigint;
  v_xp_before bigint;
  v_xp_amt bigint;
  v_level_before integer;
  v_result_xp_unused bigint;
  v_r1 bigint;
  v_r2 bigint;
  v_r3 bigint;
  v_kick_reason text;
  v_ban_reason text;
BEGIN
  PERFORM set_config('request.jwt.claims', jsonb_build_object('role', 'service_role')::text, true);

  SELECT u.id INTO v_user FROM public.users u
  WHERE u.role = 'user' AND u.status = 'active'
  ORDER BY u.created_at LIMIT 1;
  SELECT u.id INTO v_other FROM public.users u
  WHERE u.role = 'user' AND u.status = 'active' AND u.id <> v_user
  ORDER BY u.created_at LIMIT 1;
  IF v_user IS NULL OR v_other IS NULL THEN
    INSERT INTO _results VALUES ('T00', 'وجود مستخدمين اختبار', 'لا يوجد', false);
    RETURN;
  END IF;

  -- T01: الإعدادات مزروعة والمنحنى تصاعدي (لا زيادة ثابتة)
  v_r1 := public.lv_xp_required_for_level(1);
  v_r2 := public.lv_xp_required_for_level(2);
  v_r3 := public.lv_xp_required_for_level(3);
  v_ok := v_r1 >= 1 AND v_r2 > v_r1 AND v_r3 > v_r2 AND v_r3 > v_r2 + (v_r2 - v_r1) / 2;
  v_actual := 'r1=' || v_r1 || ' r2=' || v_r2 || ' r3=' || v_r3;
  INSERT INTO _results VALUES ('T01', 'منحنى XP تصاعدي قابل للتعديل', v_actual, v_ok);

  -- T02: المستوى من الخبرة — البداية والوصول للسقف
  SELECT public.lv_level_from_xp(0), public.lv_level_from_xp(v_r1 + v_r2 + v_r3 + 1),
         public.lv_level_from_xp(999999999999)
    INTO v_num, v_cnt, v_level_before;
  v_ok := v_num = 1 AND v_cnt = 4 AND v_level_before = (public.lv_settings() ->> 'max_level')::int;
  v_actual := 'at0=' || v_num || ' at3levels=' || v_cnt || ' atHuge=' || v_level_before;
  INSERT INTO _results VALUES ('T02', 'المستوى من الخبرة وسقف الحد الأقصى', v_actual, v_ok);

  -- T03: إنفاق مؤهل (هدايا) — خبرة بنسبة الإدارة
  UPDATE public.users SET balance_gold = 50000, experience_points = 0, level = 1 WHERE id = v_user;
  v_tx := public.record_wallet_transaction(v_user, 'gift_sent', -1000, 'gold',
    NULL, NULL, 'test', NULL, '{}'::jsonb, 'm8lv-test', 'اختبار خبرة هدايا');
  SELECT experience_points, level INTO v_num, v_cnt FROM public.users WHERE id = v_user;
  SELECT count(*) INTO v_cnt FROM public.lv_xp_events
    WHERE user_id = v_user AND source_type = 'wallet_spend' AND reference_id = v_tx;
  SELECT xp_amount INTO v_xp_amt FROM public.lv_xp_events
    WHERE user_id = v_user AND source_type = 'wallet_spend' AND reference_id = v_tx;
  -- 1000 كوين × 10/100 = 100 خبرة
  v_ok := v_cnt = 1 AND v_num = 100 AND v_xp_amt = 100;
  v_actual := 'events=' || v_cnt || ' xp=' || v_num || ' amt=' || v_xp_amt;
  INSERT INTO _results VALUES ('T03', 'خبرة الإنفاق على الهدايا', v_actual, v_ok);

  -- T04: منع احتساب العملية نفسها مرتين
  v_xp_before := v_num;
  INSERT INTO public.lv_xp_events (user_id, source_type, reference_id, coins_spent, xp_amount)
  VALUES (v_user, 'wallet_spend', v_tx, 1000, 5)
  ON CONFLICT (source_type, reference_id) DO NOTHING;
  SELECT count(*), (SELECT experience_points FROM public.users WHERE id = v_user)
    INTO v_cnt, v_num FROM public.lv_xp_events
    WHERE user_id = v_user AND source_type = 'wallet_spend' AND reference_id = v_tx;
  v_ok := v_cnt = 1 AND v_num = v_xp_before;
  v_actual := 'rows=' || v_cnt || ' xp=' || v_num || ' (ثابتة)';
  INSERT INTO _results VALUES ('T04', 'الازدواج ممنوع على القيد نفسه', v_actual, v_ok);

  -- T05: الشحن (موجب) بلا خبرة — المتطلب الصريح
  v_tx := public.record_wallet_transaction(v_user, 'deposit', 1000, 'gold',
    NULL, NULL, 'test', NULL, '{}'::jsonb, 'm8lv-test', 'اختبار شحن');
  SELECT count(*) INTO v_cnt FROM public.lv_xp_events
    WHERE user_id = v_user AND source_type = 'wallet_spend' AND reference_id = v_tx;
  SELECT experience_points INTO v_num FROM public.users WHERE id = v_user;
  v_ok := v_cnt = 0 AND v_num = 100;
  v_actual := 'events=' || v_cnt || ' xp=' || v_num;
  INSERT INTO _results VALUES ('T05', 'لا خبرة على شحن Coin', v_actual, v_ok);

  -- T06: الفوز (موجب) بلا خبرة، والألعاب (خصم) خبرة بنسبتها
  v_tx := public.record_wallet_transaction(v_user, 'win', 500, 'gold',
    NULL, NULL, 'test', NULL, '{}'::jsonb, 'm8lv-test', 'اختبار فوز');
  SELECT count(*) INTO v_cnt FROM public.lv_xp_events
    WHERE reference_id = v_tx;
  v_ok := v_cnt = 0;
  v_actual := 'win_events=' || v_cnt;
  INSERT INTO _results VALUES ('T06a', 'لا خبرة على الفوز', v_actual, v_ok);
  v_tx := public.record_wallet_transaction(v_user, 'bet', -200, 'gold',
    NULL, NULL, 'test', NULL, '{}'::jsonb, 'm8lv-test', 'اختبار رهان');
  SELECT count(*), (SELECT xp_amount FROM public.lv_xp_events WHERE reference_id = v_tx)
    INTO v_cnt, v_num FROM public.lv_xp_events WHERE reference_id = v_tx;
  -- 200 كوين × 5/100 = 10
  v_ok := v_cnt = 1 AND v_num = 10;
  v_actual := 'bet_events=' || v_cnt || ' xp=' || v_num;
  INSERT INTO _results VALUES ('T06b', 'خبرة الإنفاق على الألعاب بنسبتها', v_actual, v_ok);

  -- T07: خبرة الشراء (VIP) — نوع مؤهل
  UPDATE public.users SET balance_gold = 50000 WHERE id = v_user;
  v_tx := public.record_wallet_transaction(v_user, 'vip_purchase', -3000, 'gold',
    NULL, NULL, 'test', NULL, '{}'::jsonb, 'm8lv-test', 'اختبار خبرة شراء');
  SELECT xp_amount INTO v_num FROM public.lv_xp_events WHERE reference_id = v_tx;
  v_ok := v_num = 300; -- 3000 × 10/100
  v_actual := 'xp=' || coalesce(v_num::text, 'NULL');
  INSERT INTO _results VALUES ('T07', 'خبرة الشراء (VIP)', v_actual, v_ok);

  -- T08: مسار المهمات/المشاركة القديم يعمل على المنحنى الجديد
  SELECT experience_points, level INTO v_xp_before, v_level_before FROM public.users WHERE id = v_user;
  v_num := public.award_user_xp_internal(v_user, 'm8lv-test-part-01', 'room_participation', 50);
  SELECT experience_points, level INTO v_result_xp_unused, v_cnt FROM public.users WHERE id = v_user;
  v_ok := v_result_xp_unused = v_xp_before + 50 AND v_cnt = v_level_before
    AND v_num = v_cnt;
  v_actual := 'xp=' || v_result_xp_unused || ' level=' || v_cnt || ' ret=' || v_num;
  INSERT INTO _results VALUES ('T08', 'مسار المهمات القديم على المنحنى الجديد', v_actual, v_ok);

  -- T09: ترقية تمنح المكافآت — لقب وكوين وإشعار level_up
  UPDATE public.admin_settings SET value = '100'::jsonb WHERE key = 'lv_xp_base';
  UPDATE public.admin_settings SET value = '1.01'::jsonb WHERE key = 'lv_xp_growth';
  UPDATE public.admin_settings SET value = '{"gift_sent":100}'::jsonb WHERE key = 'lv_xp_spend_rates';
  UPDATE public.admin_settings SET value = '["gift_sent"]'::jsonb WHERE key = 'lv_xp_qualifying_types';
  PERFORM public.admin_upsert_level_reward(v_admin, 2,
    jsonb_build_object('title','نجم المبتدئين','coin_reward',50,'is_active',true),
    'اختبار مكافأة مستوى 2');
  UPDATE public.users SET balance_gold = 5000, experience_points = 0, level = 1 WHERE id = v_other;
  v_tx := public.record_wallet_transaction(v_other, 'gift_sent', -1000, 'gold',
    NULL, NULL, 'test', NULL, '{}'::jsonb, 'm8lv-test', 'اختبار ترقية');
  SELECT count(*) INTO v_cnt FROM public.user_level_rewards
    WHERE user_id = v_other AND level = 2;
  SELECT count(*) INTO v_num FROM public.wallet_transactions
    WHERE user_id = v_other AND type = 'level_reward' AND amount = 50;
  SELECT count(*) INTO v_xp_amt FROM public.user_notifications
    WHERE user_id = v_other AND event_type = 'level_up';
  SELECT level INTO v_level_before FROM public.users WHERE id = v_other;
  v_ok := v_cnt = 1 AND v_num >= 1 AND v_xp_amt >= 1 AND v_level_before >= 2;
  v_actual := 'rewards=' || v_cnt || ' coin_tx=' || v_num || ' notifs=' || v_xp_amt || ' level=' || v_level_before;
  INSERT INTO _results VALUES ('T09', 'الترقية تمنح لقب وكوين وإشعاراً', v_actual, v_ok);

  -- T10: LV لا يمنح حماية من الطرد/الحظر
  PERFORM set_config('request.jwt.claims', jsonb_build_object('role', 'service_role')::text, true);
  SELECT public.room_protection_block_reason(v_other, 'kick_user') INTO v_kick_reason;
  SELECT public.room_protection_block_reason(v_other, 'ban_user') INTO v_ban_reason;
  v_ok := v_kick_reason IS NULL AND v_ban_reason IS NULL;
  v_actual := 'kick=' || coalesce(v_kick_reason, 'NULL') || ' ban=' || coalesce(v_ban_reason, 'NULL');
  INSERT INTO _results VALUES ('T10', 'مستوى عالٍ بلا حماية طرد/حظر', v_actual, v_ok);

  -- T11: بوابة الإدارة والتدقيق وسبب إلزامي
  PERFORM set_config('request.jwt.claims',
    jsonb_build_object('sub', v_user::text, 'role', 'authenticated')::text, true);
  BEGIN
    PERFORM public.admin_upsert_level_reward(v_user, 3,
      jsonb_build_object('title','لقب ممنوع','coin_reward',0), 'محاولة غير مصرحة');
    v_ok := false; v_actual := 'قُبل من مستخدم — خطأ';
  EXCEPTION WHEN OTHERS THEN
    v_ok := position('المسؤول' in SQLERRM) > 0 OR position('العليا' in SQLERRM) > 0;
    v_actual := SQLERRM;
  END;
  PERFORM set_config('request.jwt.claims', jsonb_build_object('role', 'service_role')::text, true);
  BEGIN
    PERFORM public.admin_upsert_level_reward(v_admin, 3,
      jsonb_build_object('title','خبير','coin_reward',0), NULL);
    v_ok := v_ok AND false; v_actual := v_actual || ' | بلا سبب قُبل — خطأ';
  EXCEPTION WHEN OTHERS THEN
    v_ok := v_ok AND position('سبب' in SQLERRM) > 0;
    v_actual := v_actual || ' | ' || SQLERRM;
  END;
  SELECT count(*) INTO v_cnt FROM public.admin_audit_log
    WHERE target_type = 'level_reward' AND action = 'update' AND (metadata ->> 'level')::int = 2;
  v_ok := v_ok AND v_cnt >= 1;
  v_actual := v_actual || ' | audits=' || v_cnt;
  INSERT INTO _results VALUES ('T11', 'بوابة الإدارة والسبب والتدقيق', v_actual, v_ok);

  -- T12: get_my_level شكل صحيح
  PERFORM set_config('request.jwt.claims',
    jsonb_build_object('sub', v_user::text, 'role', 'authenticated')::text, true);
  v_result := public.get_my_level();
  v_ok := v_result ? 'level' AND v_result ? 'xp' AND v_result ? 'xp_to_next'
    AND v_result ? 'max_level' AND v_result ? 'rewards_earned';
  v_actual := 'level=' || (v_result ->> 'level') || ' xp=' || (v_result ->> 'xp')
    || ' toNext=' || coalesce(v_result ->> 'xp_to_next', 'NULL');
  INSERT INTO _results VALUES ('T12', 'get_my_level للمستخدم', v_actual, v_ok);
  PERFORM set_config('request.jwt.claims', jsonb_build_object('role', 'service_role')::text, true);

  -- T13: مفتاح التعطيل
  UPDATE public.admin_settings SET value = 'false'::jsonb WHERE key = 'lv_enabled';
  UPDATE public.users SET balance_gold = 5000 WHERE id = v_user;
  v_tx := public.record_wallet_transaction(v_user, 'gift_sent', -500, 'gold',
    NULL, NULL, 'test', NULL, '{}'::jsonb, 'm8lv-test', 'اختبار تعطيل');
  SELECT count(*) INTO v_cnt FROM public.lv_xp_events WHERE reference_id = v_tx;
  v_ok := v_cnt = 0;
  v_actual := 'disabled_events=' || v_cnt;
  INSERT INTO _results VALUES ('T13', 'مفتاح تعطيل نظام الخبرة', v_actual, v_ok);
  UPDATE public.admin_settings SET value = 'true'::jsonb WHERE key = 'lv_enabled';
END $do$;

SELECT * FROM _results ORDER BY step;

ROLLBACK;
