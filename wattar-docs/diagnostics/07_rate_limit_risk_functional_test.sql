-- ============================================================
-- diagnostics/07_rate_limit_risk_functional_test.sql
-- اختبار وظيفي حقيقي لـ M2.4 (حد الطلبات + تقييم المخاطر) على قاعدة الإنتاج.
-- لا يغيّر شيئاً في النهاية: كل شيء داخل BEGIN … ROLLBACK.
-- التشغيل: npx supabase db query --remote=vczyjbqixqzositlkfkn -f <هذا الملف> --yes
-- ============================================================
BEGIN;

CREATE TEMP TABLE _results (step text, expected text, actual text, ok boolean) ON COMMIT DROP;

DO $do$
DECLARE
  v_a uuid := '55942a3d-602c-4da1-99a1-05dbd1de82e9';
  v_b uuid := '2488de9e-97d9-4fa6-aa0a-856de7189287';
  v_action text := 'test07_rl_' || substr(gen_random_uuid()::text, 1, 8);
  v_device text := 'm24-test-' || substr(gen_random_uuid()::text, 1, 8);
  v_ip inet := '198.51.100.77';
  v_key text;
  v_json jsonb;
  v_msg text;
  v_ok boolean;
  v_cnt integer;
  v_score integer;
  v_reco text;
  i integer;
BEGIN
  -- ---------------- T1: أول طلب مسموح وعدّاد = 1 ----------------
  SELECT public.check_rate_limit(v_action, 'user', v_a::text, 60, 3) INTO v_json;
  v_ok := (v_json->>'allowed')::boolean AND (v_json->>'count')::int = 1 AND (v_json->>'retry_after_ms')::int = 0;
  INSERT INTO _results VALUES ('T1', 'first call allowed count=1', v_json::text, v_ok);

  -- ---------------- T2: الثاني والثالث مسموحان حتى الحد ----------------
  PERFORM public.check_rate_limit(v_action, 'user', v_a::text, 60, 3);
  SELECT public.check_rate_limit(v_action, 'user', v_a::text, 60, 3) INTO v_json;
  v_ok := (v_json->>'allowed')::boolean AND (v_json->>'count')::int = 3;
  INSERT INTO _results VALUES ('T2', 'third call allowed count=3', v_json::text, v_ok);

  -- ---------------- T3: الطلب الرابع مرفوض مع مهلة إعادة ----------------
  SELECT public.check_rate_limit(v_action, 'user', v_a::text, 60, 3) INTO v_json;
  v_ok := NOT (v_json->>'allowed')::boolean
          AND (v_json->>'count')::int = 4
          AND (v_json->>'retry_after_ms')::int > 0
          AND (v_json->>'retry_after_ms')::int <= 60000;
  INSERT INTO _results VALUES ('T3', 'fourth call denied retry>0', v_json::text, v_ok);

  -- ---------------- T4: تسجيل حدث خطر rate_limit_exceeded ----------------
  SELECT count(*) INTO v_cnt FROM public.risk_events
   WHERE event_type = 'rate_limit_exceeded' AND user_id = v_a AND severity = 'medium';
  v_ok := v_cnt >= 1;
  INSERT INTO _results VALUES ('T4', 'risk event recorded', 'events=' || v_cnt, v_ok);

  -- ---------------- T5: صف العدّاد مخزن بالمفتاح الصحيح ----------------
  v_key := v_action || ':user:' || v_a::text;
  SELECT request_count INTO v_cnt FROM public.rate_limit_buckets WHERE bucket_key = v_key;
  v_ok := v_cnt = 4;
  INSERT INTO _results VALUES ('T5', 'bucket row count=4', 'count=' || v_cnt || ' key=' || v_key, v_ok);

  -- ---------------- T6: انتهاء النافذة يعيد التصفير ----------------
  UPDATE public.rate_limit_buckets
     SET window_started_at = window_started_at - interval '61 seconds'
   WHERE bucket_key = v_key;
  SELECT public.check_rate_limit(v_action, 'user', v_a::text, 60, 3) INTO v_json;
  v_ok := (v_json->>'allowed')::boolean AND (v_json->>'count')::int = 1;
  INSERT INTO _results VALUES ('T6', 'expired window resets to 1', v_json::text, v_ok);

  -- ---------------- T7: المستخدم المصادق يستدعي check_room_rate_limit ----------------
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', v_a::text, 'role', 'authenticated')::text, true);
  BEGIN
    EXECUTE 'SET LOCAL ROLE authenticated';
    SELECT public.check_room_rate_limit('message', v_a) INTO v_json;
    EXECUTE 'RESET ROLE';
    v_ok := (v_json->>'allowed')::boolean;
    INSERT INTO _results VALUES ('T7', 'authenticated can call room limit', v_json::text, v_ok);
  EXCEPTION WHEN others THEN
    GET STACKED DIAGNOSTICS v_msg = MESSAGE_TEXT;
    BEGIN EXECUTE 'RESET ROLE'; EXCEPTION WHEN others THEN NULL; END;
    INSERT INTO _results VALUES ('T7', 'authenticated can call room limit', 'raised: ' || left(v_msg, 60), false);
  END;

  -- ---------------- T8: لا قراءة مباشرة لجدول العدادات من العميل ----------------
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', v_a::text, 'role', 'authenticated')::text, true);
  BEGIN
    EXECUTE 'SET LOCAL ROLE authenticated';
    BEGIN
      SELECT count(*) INTO v_cnt FROM public.rate_limit_buckets;
      v_ok := false; v_msg := 'select allowed';
    EXCEPTION WHEN others THEN
      v_ok := true; GET STACKED DIAGNOSTICS v_msg = MESSAGE_TEXT;
    END;
    EXECUTE 'RESET ROLE';
    INSERT INTO _results VALUES ('T8', 'direct bucket SELECT denied', 'denied=' || v_ok || ' ' || left(v_msg, 40), v_ok);
  EXCEPTION WHEN others THEN
    GET STACKED DIAGNOSTICS v_msg = MESSAGE_TEXT;
    BEGIN EXECUTE 'RESET ROLE'; EXCEPTION WHEN others THEN NULL; END;
    INSERT INTO _results VALUES ('T8', 'direct bucket SELECT denied', 'harness: ' || left(v_msg, 60), false);
  END;

  -- ---------------- T9: anon لا يستدعي دوال الحد ----------------
  PERFORM set_config('request.jwt.claims', jsonb_build_object('role', 'anon')::text, true);
  BEGIN
    EXECUTE 'SET LOCAL ROLE anon';
    BEGIN
      PERFORM public.check_room_rate_limit('message', v_a);
      v_ok := false; v_msg := 'allowed';
    EXCEPTION WHEN others THEN
      v_ok := true; GET STACKED DIAGNOSTICS v_msg = MESSAGE_TEXT;
    END;
    EXECUTE 'RESET ROLE';
    INSERT INTO _results VALUES ('T9', 'anon rate limit RPC denied', 'denied=' || v_ok || ' ' || left(v_msg, 40), v_ok);
  EXCEPTION WHEN others THEN
    GET STACKED DIAGNOSTICS v_msg = MESSAGE_TEXT;
    BEGIN EXECUTE 'RESET ROLE'; EXCEPTION WHEN others THEN NULL; END;
    INSERT INTO _results VALUES ('T9', 'anon rate limit RPC denied', 'harness: ' || left(v_msg, 60), false);
  END;

  -- ---------------- T10: المستخدم المصادق لا يسجل أحداث خطر بنفسه ----------------
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', v_a::text, 'role', 'authenticated')::text, true);
  BEGIN
    EXECUTE 'SET LOCAL ROLE authenticated';
    BEGIN
      PERFORM public.record_risk_event('forged_event', v_a);
      v_ok := false; v_msg := 'allowed';
    EXCEPTION WHEN others THEN
      v_ok := true; GET STACKED DIAGNOSTICS v_msg = MESSAGE_TEXT;
    END;
    EXECUTE 'RESET ROLE';
    INSERT INTO _results VALUES ('T10', 'authenticated record_risk_event denied', 'denied=' || v_ok || ' ' || left(v_msg, 40), v_ok);
  EXCEPTION WHEN others THEN
    GET STACKED DIAGNOSTICS v_msg = MESSAGE_TEXT;
    BEGIN EXECUTE 'RESET ROLE'; EXCEPTION WHEN others THEN NULL; END;
    INSERT INTO _results VALUES ('T10', 'authenticated record_risk_event denied', 'harness: ' || left(v_msg, 60), false);
  END;

  -- ---------------- T11: تسجيل بصمة جهاز أول مستخدم ----------------
  SELECT public.register_device_fingerprint(v_device, v_a, NULL, '{}') INTO v_json;
  v_ok := (v_json->>'user_count')::int = 1 AND (v_json->>'risk_score')::int = 0 AND (v_json->>'risk_level') = 'low';
  INSERT INTO _results VALUES ('T11', 'device registered user_count=1', v_json::text, v_ok);

  -- ---------------- T12: نفس الجهاز مستخدم ثانٍ بدون حدث ----------------
  SELECT public.register_device_fingerprint(v_device, v_b, NULL, '{}') INTO v_json;
  SELECT count(*) INTO v_cnt FROM public.risk_events
   WHERE event_type = 'multiple_accounts' AND device_id = v_device;
  v_ok := (v_json->>'user_count')::int = 2 AND v_cnt = 0;
  INSERT INTO _results VALUES ('T12', 'second user no flag yet', 'uc=' || (v_json->>'user_count') || ' events=' || v_cnt, v_ok);

  -- ---------------- T13: 6 مستخدمين => multiple_accounts ----------------
  FOR i IN 1..4 LOOP
    PERFORM public.register_device_fingerprint(v_device, gen_random_uuid(), NULL, '{}');
  END LOOP;
  SELECT count(*) INTO v_cnt FROM public.risk_events
   WHERE event_type = 'multiple_accounts' AND device_id = v_device;
  SELECT user_count INTO i FROM public.device_fingerprints WHERE device_id = v_device;
  v_ok := (i = 6) AND (v_cnt = 1);
  INSERT INTO _results VALUES ('T13', '6 users flag multiple_accounts', 'uc=' || i || ' events=' || v_cnt, v_ok);

  -- ---------------- T14: حدث medium يرفع درجة الجهاز وIP ويُنشئ صف IP ----------------
  PERFORM public.record_risk_event('suspicious_pattern', v_a, v_device, v_ip, 'medium', 'T14 test', '{}');
  DECLARE
    v_ip_score integer;
    v_dev_score integer;
  BEGIN
    SELECT risk_score INTO v_dev_score FROM public.device_fingerprints WHERE device_id = v_device;
    SELECT risk_score INTO v_ip_score FROM public.ip_reputation WHERE ip = v_ip;
    v_ok := v_dev_score = 6 AND v_ip_score = 3;  -- 1 (multiple_accounts low) + 5 (medium) | IP: 3
    INSERT INTO _results VALUES ('T14', 'device=6 ip=3 after medium',
      'dev=' || v_dev_score || ' ip=' || v_ip_score, v_ok);
  END;

  -- ---------------- T15: درجة الخطر المركبة الأساسية ----------------
  SELECT public.get_risk_score(v_a, v_device, v_ip) INTO v_json;
  v_score := (v_json->>'score')::int;
  v_reco  := v_json->>'recommendation';
  -- جهاز 6×0.5=3 + IP 3×0.3=0 + أحداث medium للمستخدم في 24س (rate_limit_exceeded×1 + suspicious×1 = 2)×10×0.2=4 => 7
  v_ok := v_score = 7 AND v_reco = 'allow';
  INSERT INTO _results VALUES ('T15', 'composite score=7 allow', v_json::text, v_ok);

  -- ---------------- T16: رفع الخطر يصل إلى tier monitor ----------------
  PERFORM public.record_risk_event('suspicious_pattern', NULL, v_device, NULL, 'critical', 'T16 bump', '{}');
  PERFORM public.record_risk_event('suspicious_pattern', NULL, v_device, NULL, 'critical', 'T16 bump', '{}');
  SELECT public.get_risk_score(v_a, v_device, v_ip) INTO v_json;
  v_score := (v_json->>'score')::int;
  v_reco  := v_json->>'recommendation';
  -- جهاز 6+80=86×0.5=43 + IP 3×0.3=0 + أحداث 2×10×0.2=4 => 47
  v_ok := v_score = 47 AND v_reco = 'monitor';
  INSERT INTO _results VALUES ('T16', 'score=47 monitor', v_json::text, v_ok);

  -- ---------------- T17: حظر الجهاز => block ----------------
  UPDATE public.device_fingerprints SET is_blocked = true, blocked_at = now()
   WHERE device_id = v_device;
  SELECT public.get_risk_score(v_a, v_device, v_ip) INTO v_json;
  v_score := (v_json->>'score')::int;
  v_reco  := v_json->>'recommendation';
  v_ok := v_score = 100 AND v_reco = 'block';
  INSERT INTO _results VALUES ('T17', 'blocked device => block/100', v_json::text, v_ok);

  -- ---------------- T18: معاملات غير صالحة مرفوضة ----------------
  BEGIN
    PERFORM public.check_rate_limit(v_action, 'hash', 'x', 60, 3);
    v_ok := false; v_msg := 'allowed';
  EXCEPTION WHEN others THEN
    v_ok := true; GET STACKED DIAGNOSTICS v_msg = MESSAGE_TEXT;
  END;
  INSERT INTO _results VALUES ('T18', 'invalid identifier_type rejected', 'denied=' || v_ok || ' ' || left(v_msg, 40), v_ok);

  BEGIN
    EXECUTE 'RESET ROLE';
  EXCEPTION WHEN others THEN NULL;
  END;
END;
$do$;

SELECT step, expected, actual, ok FROM _results ORDER BY step;

ROLLBACK;
