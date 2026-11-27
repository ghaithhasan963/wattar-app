-- ============================================================
-- diagnostics/23_m9_games_test.sql
-- اختبار وظيفي لترحيل #83 (M9.4 — الألعاب: احتمالات معلنة،
--   إدارة كاملة، تقييد جغرافي، وضع محاكاة، منع التلاعب السري)
-- داخل BEGIN … ROLLBACK: لا يترك أثراً.
-- ============================================================
BEGIN;

CREATE TEMP TABLE _results (step text, expected text, actual text, ok boolean) ON COMMIT DROP;

DO $do$
DECLARE
  v_user uuid;
  v_admin uuid := '2488de9e-97d9-4fa6-aa0a-856de7189287';
  v_config_id uuid;
  v_gate jsonb;
  v_public jsonb;
  v_odds jsonb;
  v_rtp numeric;
  v_expect numeric;
  v_count integer;
  v_count2 integer;
  v_balance bigint;
  v_balance2 bigint;
  v_bet1 text;
  v_bet2 text;
  v_stats_before jsonb;
  v_stats_after jsonb;
  v_audit integer;
  v_ok boolean;
  v_actual text;
  v_key text := 'diag23-' || replace(gen_random_uuid()::text, '-', '');
  v_country text;
  v_adult timestamptz;
BEGIN
  PERFORM set_config('request.jwt.claims', jsonb_build_object('role', 'service_role')::text, true);

  SELECT u.id INTO v_user FROM public.users u
  WHERE u.status = 'active' AND u.role = 'user' AND u.adult_confirmed_at IS NOT NULL
  ORDER BY u.created_at LIMIT 1;
  IF v_user IS NULL THEN
    INSERT INTO _results VALUES ('T00', 'وجود مستخدم اختبار بالغ', 'لا يوجد', false);
    RETURN;
  END IF;

  -- ---------------------------------------------------------
  -- 1) الاحتمالات المعلنة (RTP محسوب من الإعدادات لا من رقم مخزّن)
  -- ---------------------------------------------------------
  -- T01: العجلة = متوسط عائد الخانات (كل خانة رهان مستقل)
  SELECT round(avg(((s ->> 'probability')::numeric * (s ->> 'value')::numeric)) * 100, 2)
    INTO v_expect
  FROM public.game_configs c, jsonb_array_elements(c.settings -> 'segments') s
  WHERE c.game_type = 'wheel';
  v_rtp := public.game_declared_rtp('wheel');
  v_ok := abs(v_rtp - v_expect) < 0.01;
  INSERT INTO _results VALUES ('T01', 'RTP العجلة = متوسط عائد الخانات',
    'declared=' || v_rtp || ' expect=' || v_expect, v_ok);

  -- T02: النرد = default_rtp المعلن
  v_rtp := public.game_declared_rtp('dice');
  v_expect := (SELECT default_rtp FROM public.game_configs WHERE game_type = 'dice');
  v_ok := abs(v_rtp - v_expect) < 0.01;
  INSERT INTO _results VALUES ('T02', 'RTP النرد = المعلن',
    'declared=' || v_rtp || ' expect=' || v_expect, v_ok);

  -- T03: الطيارة = default_rtp (P(crash>x)=r/x)
  v_rtp := public.game_declared_rtp('aviator');
  v_expect := (SELECT default_rtp FROM public.game_configs WHERE game_type = 'aviator');
  v_ok := abs(v_rtp - v_expect) < 0.01;
  INSERT INTO _results VALUES ('T03', 'RTP الطيارة = المعلن',
    'declared=' || v_rtp || ' expect=' || v_expect, v_ok);

  -- T04: بلانغو = Σ C(12,k)/2^12 × المضاعف (توزيع ثنائي دقيق)
  SELECT round(sum(public.game_binomial_prob(12, k)
      * ((c.settings -> 'multipliers' -> 'medium') ->> k)::numeric) * 100, 2)
    INTO v_expect
  FROM public.game_configs c, generate_series(0, 12) AS k
  WHERE c.game_type = 'plinko';
  v_rtp := public.game_declared_rtp('plinko');
  v_ok := abs(v_rtp - v_expect) < 0.01;
  INSERT INTO _results VALUES ('T04', 'RTP بلانغو = Σ توزيع ثنائي × المضاعف',
    'declared=' || v_rtp || ' expect=' || v_expect, v_ok);

  -- T05: مجموع احتمالات بلانغو = 1، وC(12,6)=924
  SELECT sum(public.game_binomial_prob(12, k)) INTO v_expect FROM generate_series(0, 12) AS k;
  v_ok := abs(v_expect - 1) < 0.000001
    AND public.game_binomial_prob(12, 6) = round(924::numeric / 4096, 12);
  INSERT INTO _results VALUES ('T05', 'توزيع بلانغو سليم (Σ=1، C(12,6)=924)',
    'sum=' || v_expect || ' p6=' || public.game_binomial_prob(12, 6), v_ok);

  -- T06: Slots = Σ احتمال × مضاعف
  SELECT round(sum((t ->> 'probability')::numeric * (t ->> 'multiplier')::numeric) * 100, 2)
    INTO v_expect
  FROM public.game_configs c, jsonb_array_elements(c.settings -> 'tiers') t
  WHERE c.game_type = 'slots';
  v_rtp := public.game_declared_rtp('slots');
  v_ok := abs(v_rtp - v_expect) < 0.01;
  INSERT INTO _results VALUES ('T06', 'RTP Slots = Σ احتمال × مضاعف',
    'declared=' || v_rtp || ' expect=' || v_expect, v_ok);

  -- T07: RTP المعلن لكل لعبة ضمن نطاق معقول (1..100)
  SELECT count(*) INTO v_count FROM public.game_configs
  WHERE public.game_declared_rtp(game_type) BETWEEN 1 AND 100;
  v_ok := v_count = (SELECT count(*) FROM public.game_configs);
  INSERT INTO _results VALUES ('T07', 'كل الألعاب لها RTP معلن صالح', 'games=' || v_count, v_ok);

  -- T08: حمولة الاحتمالات المعلنة مكتملة لكل نوع
  v_odds := public.game_settings_odds('wheel',
    (SELECT settings FROM public.game_configs WHERE game_type = 'wheel'),
    (SELECT default_rtp FROM public.game_configs WHERE game_type = 'wheel'));
  v_ok := jsonb_array_length(v_odds -> 'segments') = 6
    AND (v_odds -> 'segments' -> 0 ? 'segment_rtp')
    AND (v_odds ->> 'rtp')::numeric = public.game_declared_rtp('wheel');
  INSERT INTO _results VALUES ('T08', 'حمولة احتمالات العجلة مكتملة',
    'segments=' || jsonb_array_length(v_odds -> 'segments'), v_ok);

  v_odds := public.game_settings_odds('plinko',
    (SELECT settings FROM public.game_configs WHERE game_type = 'plinko'),
    (SELECT default_rtp FROM public.game_configs WHERE game_type = 'plinko'));
  v_ok := (v_odds -> 'risks' -> 'low' ? 'slots')
    AND jsonb_array_length(v_odds -> 'risks' -> 'low' -> 'slots') = 13
    AND jsonb_array_length(v_odds -> 'risks' -> 'high' -> 'slots') = 13;
  INSERT INTO _results VALUES ('T09', 'حمولة احتمالات بلانغو 3 مستويات × 13 خانة',
    'low=' || jsonb_array_length(v_odds -> 'risks' -> 'low' -> 'slots'), v_ok);

  -- ---------------------------------------------------------
  -- 2) بوابة اللعب + الظهور العام
  -- ---------------------------------------------------------
  v_gate := public.game_play_gate(v_user, 'wheel');
  v_ok := (v_gate ->> 'allowed')::boolean
    AND (v_gate ->> 'test_mode_enabled')::boolean = false;
  INSERT INTO _results VALUES ('T10', 'البوابة تسمح لمستخدم نشط بالغ', v_gate::text, v_ok);

  UPDATE public.game_configs SET is_enabled = false WHERE game_type = 'dice';
  v_gate := public.game_play_gate(v_user, 'dice');
  v_ok := (v_gate ->> 'allowed')::boolean = false AND v_gate ->> 'reason' = 'disabled';
  UPDATE public.game_configs SET is_enabled = true WHERE game_type = 'dice';
  INSERT INTO _results VALUES ('T11', 'البوابة تمنع لعبة موقوفة', v_gate::text, v_ok);

  SELECT adult_confirmed_at, country_code INTO v_adult, v_country
  FROM public.users WHERE id = v_user;
  UPDATE public.users SET adult_confirmed_at = NULL WHERE id = v_user;
  v_gate := public.game_play_gate(v_user, 'wheel');
  v_ok := (v_gate ->> 'allowed')::boolean = false AND v_gate ->> 'reason' = 'age';
  UPDATE public.users SET adult_confirmed_at = v_adult WHERE id = v_user;
  INSERT INTO _results VALUES ('T12', 'البوابة تمنع من لم يؤكد العمر', v_gate::text, v_ok);

  UPDATE public.admin_settings SET value = 'true'::jsonb WHERE key = 'games_geoblocking_enabled';
  UPDATE public.admin_settings SET value = '["SY"]'::jsonb WHERE key = 'blocked_game_countries';
  UPDATE public.users SET country_code = 'SY' WHERE id = v_user;
  v_gate := public.game_play_gate(v_user, 'wheel');
  v_ok := (v_gate ->> 'allowed')::boolean = false AND v_gate ->> 'reason' = 'region';
  INSERT INTO _results VALUES ('T13', 'البوابة تمنع دولة محظورة', v_gate::text, v_ok);

  UPDATE public.admin_settings SET value = 'false'::jsonb WHERE key = 'games_geoblocking_enabled';
  UPDATE public.admin_settings SET value = '[]'::jsonb WHERE key = 'blocked_game_countries';
  UPDATE public.users SET country_code = v_country WHERE id = v_user;

  v_public := public.get_public_games();
  v_ok := jsonb_array_length(v_public) = 5
    AND NOT EXISTS (
      SELECT 1 FROM jsonb_array_elements(v_public) g
      WHERE g ->> 'declared_rtp' IS NULL OR g -> 'declared_odds' IS NULL
    );
  INSERT INTO _results VALUES ('T14', 'الألعاب العامة 5 مع RTP واحتمالات معلنة',
    'games=' || jsonb_array_length(v_public), v_ok);

  UPDATE public.game_configs SET archived_at = now() WHERE game_type = 'slots';
  v_public := public.get_public_games();
  v_ok := jsonb_array_length(v_public) = 4
    AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v_public) g WHERE g ->> 'game_type' = 'slots');
  UPDATE public.game_configs SET archived_at = NULL WHERE game_type = 'slots';
  INSERT INTO _results VALUES ('T15', 'الألعاب المؤرشفة تختفي من القائمة',
    'games=' || jsonb_array_length(v_public), v_ok);

  -- ---------------------------------------------------------
  -- 3) وضع المحاكاة — لا أرصدة حقيقية ولا ازدواج
  -- ---------------------------------------------------------
  UPDATE public.admin_settings SET value = 'true'::jsonb WHERE key = 'games_test_mode_enabled';
  UPDATE public.game_configs SET test_mode_enabled = true WHERE game_type = 'wheel';
  UPDATE public.users SET country_code = 'SY' WHERE id = v_user;

  SELECT balance_gold INTO v_balance FROM public.users WHERE id = v_user;
  PERFORM set_config('request.jwt.claims',
    jsonb_build_object('sub', v_user, 'role', 'authenticated')::text, true);
  v_stats_before := public.get_my_game_stats();

  PERFORM set_config('request.jwt.claims', jsonb_build_object('role', 'service_role')::text, true);
  v_bet1 := public.play_game_simulation(
    v_user, 'wheel', v_key, '{"segment_choice":1}'::jsonb, 100,
    '{"segment_choice":1}'::jsonb,
    '{"winning_segment":1,"winning_value":1.2}'::jsonb, 120, 1.2, true, NULL, 29.95,
    repeat('a', 64)
  ) ->> 'bet_id';

  v_bet2 := public.play_game_simulation(
    v_user, 'wheel', v_key, '{"segment_choice":1}'::jsonb, 100,
    '{"segment_choice":1}'::jsonb,
    '{"winning_segment":1,"winning_value":1.2}'::jsonb, 120, 1.2, true, NULL, 29.95,
    repeat('a', 64)
  ) ->> 'bet_id';

  SELECT balance_gold INTO v_balance2 FROM public.users WHERE id = v_user;
  SELECT count(*) INTO v_count FROM public.game_bets WHERE user_id = v_user AND idempotency_key = v_key;
  v_ok := v_bet1 = v_bet2 AND v_count = 1 AND v_balance = v_balance2;
  INSERT INTO _results VALUES ('T16', 'المحاكاة idempotent وبلا حركة رصيد',
    'bet=' || coalesce(v_bet1, 'NULL') || ' rows=' || v_count
      || ' balance_delta=' || (v_balance2 - v_balance), v_ok);

  SELECT count(*) INTO v_count FROM public.game_bets
  WHERE user_id = v_user AND idempotency_key = v_key AND is_test;
  INSERT INTO _results VALUES ('T17', 'جولة المحاكاة مسجّلة is_test=true', 'rows=' || v_count, v_count = 1);

  PERFORM set_config('request.jwt.claims',
    jsonb_build_object('sub', v_user, 'role', 'authenticated')::text, true);
  v_stats_after := public.get_my_game_stats();
  v_ok := (v_stats_after -> 'overall' ->> 'rounds') = (v_stats_before -> 'overall' ->> 'rounds');
  INSERT INTO _results VALUES ('T18', 'الإحصاءات تستثني جولات المحاكاة',
    'before=' || (v_stats_before -> 'overall' ->> 'rounds')
      || ' after=' || (v_stats_after -> 'overall' ->> 'rounds'), v_ok);

  -- T19: منع فرض الخسارة (قسم 19)
  PERFORM set_config('request.jwt.claims', jsonb_build_object('role', 'service_role')::text, true);
  v_ok := false;
  v_actual := '';
  BEGIN
    PERFORM public.play_game_simulation(
      v_user, 'wheel', v_key || 'x', '{"segment_choice":1}'::jsonb, 100,
      '{}'::jsonb, '{}'::jsonb, 0, 0, false, 'lose', 29.95, repeat('b', 64)
    );
    v_actual := 'لم يرفض';
  EXCEPTION WHEN OTHERS THEN
    v_ok := SQLERRM LIKE '%بيانات الجولة غير صالحة%';
    v_actual := SQLERRM;
  END;
  INSERT INTO _results VALUES ('T19', 'فرض خسارة مضمونة مرفوض', v_actual, v_ok);

  -- T20: المحاكاة مرفوضة عندما تكون معطّلة لهذه اللعبة
  UPDATE public.game_configs SET test_mode_enabled = false WHERE game_type = 'wheel';
  v_ok := false;
  v_actual := '';
  BEGIN
    PERFORM public.play_game_simulation(
      v_user, 'wheel', v_key || 'y', '{}'::jsonb, 100, '{}'::jsonb, '{}'::jsonb,
      0, 0, false, NULL, 29.95, repeat('c', 64)
    );
    v_actual := 'لم يرفض';
  EXCEPTION WHEN OTHERS THEN
    v_ok := SQLERRM LIKE '%وضع المحاكاة غير مفعّل%';
    v_actual := SQLERRM;
  END;
  UPDATE public.game_configs SET test_mode_enabled = false WHERE game_type = 'wheel';
  UPDATE public.admin_settings SET value = 'false'::jsonb WHERE key = 'games_test_mode_enabled';
  UPDATE public.users SET country_code = v_country WHERE id = v_user;
  INSERT INTO _results VALUES ('T20', 'المحاكاة معطّلة عندما تكون اللعبة غير مفعّلة', v_actual, v_ok);

  -- ---------------------------------------------------------
  -- 4) الإدارة — سبب إلزامي + تدقيق + صلاحيات
  -- ---------------------------------------------------------
  -- T21: سبب قصير مرفوض
  v_ok := false;
  v_actual := '';
  BEGIN
    PERFORM public.admin_upsert_game_config(v_admin, 'wheel', '{"sort_order": 11}'::jsonb, 'قصير');
    v_actual := 'لم يرفض';
  EXCEPTION WHEN OTHERS THEN
    v_ok := SQLERRM LIKE '%سبباً بين 10 و500%';
    v_actual := SQLERRM;
  END;
  INSERT INTO _results VALUES ('T21', 'سبب التعديل القصير مرفوض', v_actual, v_ok);

  -- T22: تعديل صحيح يُطبّق ويُدوَّن قبل/بعد مع RTP
  SELECT id INTO v_config_id FROM public.game_configs WHERE game_type = 'wheel';
  PERFORM public.admin_upsert_game_config(
    v_admin, 'wheel', '{"sort_order": 11, "max_bet_gold": 500000}'::jsonb,
    'اختبار تشخيصي لتعديل إعدادات العجلة'
  );
  SELECT count(*) INTO v_audit FROM public.admin_audit_log
  WHERE target_type = 'game_config' AND target_id = v_config_id
    AND admin_id = v_admin AND reason = 'اختبار تشخيصي لتعديل إعدادات العجلة'
    AND (metadata ? 'declared_rtp_before') AND (metadata ? 'declared_rtp_after');
  v_ok := v_audit >= 1
    AND (SELECT max_bet_gold FROM public.game_configs WHERE game_type = 'wheel') = 500000
    AND (SELECT sort_order FROM public.game_configs WHERE game_type = 'wheel') = 11;
  INSERT INTO _results VALUES ('T22', 'التعديل الإداري يُطبّق ويُدوَّن قبل/بعد', 'audit=' || v_audit, v_ok);

  -- T23: مستخدم عادي لا يستطيع إدارة الألعاب
  PERFORM set_config('request.jwt.claims',
    jsonb_build_object('sub', v_user, 'role', 'authenticated')::text, true);
  v_ok := false;
  v_actual := '';
  BEGIN
    PERFORM public.admin_upsert_game_config(v_user, 'wheel', '{"sort_order": 12}'::jsonb,
      'محاولة غير مصرح بها لتعديل العجلة');
    v_actual := 'لم يرفض';
  EXCEPTION WHEN OTHERS THEN
    v_ok := SQLERRM LIKE '%غير مصرح%';
    v_actual := SQLERRM;
  END;
  INSERT INTO _results VALUES ('T23', 'المستخدم العادي لا يدير الألعاب', v_actual, v_ok);

  -- T24: المشرف يقرأ سجل جولات المستخدم ويُحصي
  PERFORM set_config('request.jwt.claims',
    jsonb_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  v_ok := jsonb_typeof(public.admin_list_game_configs()) = 'array'
    AND jsonb_array_length(public.admin_list_game_configs()) = 5
    AND jsonb_typeof(public.admin_game_stats(30)) = 'array'
    AND jsonb_typeof(public.admin_list_game_rounds(NULL, NULL, 5, 0)) = 'array';
  INSERT INTO _results VALUES ('T24', 'لوحة الإدارة تقرأ الإعدادات والإحصاءات والجولات',
    'configs=' || jsonb_array_length(public.admin_list_game_configs()), v_ok);

  -- T25: إعدادات غير صالحة مرفوضة (مجموع احتمالات العجلة ≠ 1)
  PERFORM set_config('request.jwt.claims', jsonb_build_object('role', 'service_role')::text, true);
  v_ok := false;
  v_actual := '';
  BEGIN
    PERFORM public.game_validate_settings('wheel',
      '{"segments":[{"value":2,"probability":0.4,"color":"#10B981","label":"x2"},
                    {"value":5,"probability":0.4,"color":"#3B82F6","label":"x5"}]}'::jsonb,
      50);
    v_actual := 'لم يرفض';
  EXCEPTION WHEN OTHERS THEN
    v_ok := SQLERRM LIKE '%مجموع احتمالات العجلة%';
    v_actual := SQLERRM;
  END;
  INSERT INTO _results VALUES ('T25', 'مجموع احتمالات عجلة غير صالح مرفوض', v_actual, v_ok);

  -- T26: صلاحيات الدوال (المحاكاة والتسوية service_role فقط)
  v_ok := has_function_privilege('service_role',
              'public.play_game_simulation(uuid, public.game_type, text, jsonb, bigint, jsonb, jsonb, bigint, numeric, boolean, text, numeric, text)', 'EXECUTE')
    AND NOT has_function_privilege('authenticated',
              'public.play_game_simulation(uuid, public.game_type, text, jsonb, bigint, jsonb, jsonb, bigint, numeric, boolean, text, numeric, text)', 'EXECUTE')
    AND NOT has_function_privilege('anon',
              'public.play_game_simulation(uuid, public.game_type, text, jsonb, bigint, jsonb, jsonb, bigint, numeric, boolean, text, numeric, text)', 'EXECUTE')
    AND has_function_privilege('authenticated', 'public.get_public_games()', 'EXECUTE')
    AND has_function_privilege('authenticated', 'public.get_my_game_rounds(public.game_type, integer, timestamptz, uuid)', 'EXECUTE')
    AND NOT has_function_privilege('anon', 'public.admin_list_game_configs()', 'EXECUTE')
    AND NOT has_function_privilege('authenticated', 'public.game_play_gate(uuid, public.game_type)', 'EXECUTE');
  v_actual := 'sim_anon=' || has_function_privilege('anon',
                'public.play_game_simulation(uuid, public.game_type, text, jsonb, bigint, jsonb, jsonb, bigint, numeric, boolean, text, numeric, text)', 'EXECUTE')
    || ' public_authed=' || has_function_privilege('authenticated', 'public.get_public_games()', 'EXECUTE');
  INSERT INTO _results VALUES ('T26', 'صلاحيات دوال الألعاب مضبوطة', v_actual, v_ok);

  -- T27: لا يوجد مستخدم بخسارة مضمونة مفروضة
  SELECT count(*) INTO v_count FROM public.users WHERE is_force_lose;
  INSERT INTO _results VALUES ('T27', 'لا خسارة مضمونة مفروضة على أي مستخدم', 'rows=' || v_count, v_count = 0);

  -- T28: set_my_country يعمل للمستخدم ويأبى رمزاً غير صالح
  PERFORM set_config('request.jwt.claims',
    jsonb_build_object('sub', v_user, 'role', 'authenticated')::text, true);
  v_ok := (public.set_my_country('eg') ->> 'country_code') = 'EG';
  v_ok := v_ok AND (SELECT country_code FROM public.users WHERE id = v_user) = 'EG';
  v_actual := '';
  BEGIN
    PERFORM public.set_my_country('EGY');
    v_actual := 'لم يرفض';
  EXCEPTION WHEN OTHERS THEN
    v_actual := SQLERRM;
  END;
  v_ok := v_ok AND v_actual LIKE '%حرفين%';
  UPDATE public.users SET country_code = v_country WHERE id = v_user;
  INSERT INTO _results VALUES ('T28', 'تحديد الدولة يعمل ويرفض الرمز غير الصالح', v_actual, v_ok);

  -- T29: سجل جولات المستخدم يعمل ولا يكشف جولات غيره
  v_count := jsonb_array_length(public.get_my_game_rounds(NULL, 20));
  v_count2 := jsonb_array_length(public.get_my_game_rounds('wheel', 20));
  v_ok := v_count >= 0 AND v_count2 >= 0
    AND NOT EXISTS (
      SELECT 1 FROM jsonb_array_elements(public.get_my_game_rounds(NULL, 50)) r
      WHERE (r ->> 'bet_id')::uuid NOT IN (
        SELECT id FROM public.game_bets WHERE user_id = v_user
      )
    );
  INSERT INTO _results VALUES ('T29', 'سجل الجولات لمستخدمه فقط',
    'all=' || v_count || ' wheel=' || v_count2, v_ok);

  -- T30: قيد صيغة رمز الدولة على الجدول
  v_ok := false;
  v_actual := '';
  BEGIN
    UPDATE public.users SET country_code = 'eg' WHERE id = v_user;
    v_actual := 'لم يرفض';
  EXCEPTION WHEN OTHERS THEN
    v_ok := SQLERRM LIKE '%country_code_check%';
    v_actual := SQLERRM;
  END;
  INSERT INTO _results VALUES ('T30', 'قيد صيغة الدولة ISO-2 مفعّل', v_actual, v_ok);

  PERFORM set_config('request.jwt.claims', '', true);
END $do$;

SELECT * FROM _results ORDER BY step;

ROLLBACK;
