-- ============================================================
-- diagnostics/05_age_consent_functional_test.sql
-- اختبار وظيفي حقيقي لـ M1.4 (سجل موافقة 18+) على قاعدة الإنتاج.
-- لا يغيّر شيئاً: كل شيء داخل BEGIN … ROLLBACK.
-- التشغيل: npx supabase db query --remote=vczyjbqixqzositlkfkn -f <هذا الملف> --yes
-- ============================================================
BEGIN;

CREATE TEMP TABLE _results (step text, expected text, actual text, ok boolean) ON COMMIT DROP;

DO $do$
DECLARE
  v_a uuid := '55942a3d-602c-4da1-99a1-05dbd1de82e9';     -- subject of the consent
  v_b uuid := '2488de9e-97d9-4fa6-aa0a-856de7189287';     -- other user (must NOT see A's consent)
  v_version text := 'adult-attestation-2026-11';
  v_cnt integer;
  v_confirmed timestamptz;
  v_accepted timestamptz;
  v_same boolean;
  v_meta jsonb;
  v_msg text;
  v_denied boolean;
BEGIN
  -- clean state inside the transaction only
  DELETE FROM public.user_consents WHERE user_id IN (v_a, v_b);
  UPDATE public.users SET adult_confirmed_at = NULL WHERE id IN (v_a, v_b);

  -- ---------------- C1: first confirmation writes one consent row ----------------
  UPDATE public.users SET adult_confirmed_at = now() WHERE id = v_a;
  SELECT count(*) INTO v_cnt FROM public.user_consents
   WHERE user_id = v_a AND consent_type = 'adult_18_plus' AND document_version = v_version;
  INSERT INTO _results VALUES ('C1', 'one consent row on first confirmation', 'rows=' || v_cnt, v_cnt = 1);

  -- ---------------- C2: accepted_at mirrors adult_confirmed_at ----------------
  SELECT u.adult_confirmed_at, c.accepted_at INTO v_confirmed, v_accepted
  FROM public.users u
  JOIN public.user_consents c ON c.user_id = u.id AND c.consent_type = 'adult_18_plus'
  WHERE u.id = v_a;
  v_same := v_confirmed IS NOT NULL AND v_accepted IS NOT NULL AND v_confirmed = v_accepted;
  INSERT INTO _results VALUES ('C2', 'accepted_at equals adult_confirmed_at', 'same=' || v_same, v_same);

  -- ---------------- C3: later updates do not duplicate the record ----------------
  UPDATE public.users SET adult_confirmed_at = now() + interval '1 hour' WHERE id = v_a;
  SELECT count(*) INTO v_cnt FROM public.user_consents
   WHERE user_id = v_a AND consent_type = 'adult_18_plus' AND document_version = v_version;
  INSERT INTO _results VALUES ('C3', 'no duplicate row on later update', 'rows=' || v_cnt, v_cnt = 1);

  -- ---------------- C4: a user cannot insert a consent directly (RLS) ----------------
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', v_a::text, 'role', 'authenticated')::text, true);
  BEGIN
    EXECUTE 'SET LOCAL ROLE authenticated';
    BEGIN
      INSERT INTO public.user_consents (user_id, consent_type, document_version)
      VALUES (v_a, 'adult_18_plus', 'forged-by-user');
      v_denied := false;
      v_msg := 'inserted';
    EXCEPTION WHEN others THEN
      v_denied := true;
      GET STACKED DIAGNOSTICS v_msg = MESSAGE_TEXT;
    END;
    EXECUTE 'RESET ROLE';
    INSERT INTO _results VALUES ('C4', 'direct insert denied by RLS', 'denied=' || v_denied || ' ' || left(v_msg, 40), v_denied);
  EXCEPTION WHEN others THEN
    GET STACKED DIAGNOSTICS v_msg = MESSAGE_TEXT;
    BEGIN EXECUTE 'RESET ROLE'; EXCEPTION WHEN others THEN NULL; END;
    INSERT INTO _results VALUES ('C4', 'direct insert denied by RLS', 'harness: ' || left(v_msg, 40), false);
  END;

  -- ---------------- C5: a user cannot tamper with the record (RLS) ----------------
  BEGIN
    EXECUTE 'SET LOCAL ROLE authenticated';
    UPDATE public.user_consents SET metadata = jsonb_build_object('tampered', true) WHERE user_id = v_a;
    SELECT metadata INTO v_meta FROM public.user_consents WHERE user_id = v_a LIMIT 1;
    BEGIN
      EXECUTE 'RESET ROLE';
    EXCEPTION WHEN others THEN NULL;
    END;
    -- as owner (bypassrls) we can now confirm the row is untouched
    SELECT metadata INTO v_meta FROM public.user_consents WHERE user_id = v_a LIMIT 1;
    INSERT INTO _results VALUES ('C5', 'record is append-only for users', 'tampered=' || (v_meta ? 'tampered'), NOT (v_meta ? 'tampered'));
  EXCEPTION WHEN others THEN
    GET STACKED DIAGNOSTICS v_msg = MESSAGE_TEXT;
    BEGIN
      EXECUTE 'RESET ROLE';
    EXCEPTION WHEN others THEN NULL;
    END;
    SELECT metadata INTO v_meta FROM public.user_consents WHERE user_id = v_a LIMIT 1;
    INSERT INTO _results VALUES ('C5', 'record is append-only for users', 'raised: ' || left(v_msg, 50), NOT (v_meta ? 'tampered'));
  END;

  -- ---------------- C6: own rows only ----------------
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', v_b::text, 'role', 'authenticated')::text, true);
  BEGIN
    EXECUTE 'SET LOCAL ROLE authenticated';
    SELECT count(*) INTO v_cnt FROM public.user_consents WHERE user_id = v_a;
    EXECUTE 'RESET ROLE';
    INSERT INTO _results VALUES ('C6', 'other users see zero consent rows', 'rows=' || v_cnt, v_cnt = 0);
  EXCEPTION WHEN others THEN
    GET STACKED DIAGNOSTICS v_msg = MESSAGE_TEXT;
    BEGIN
      EXECUTE 'RESET ROLE';
    EXCEPTION WHEN others THEN NULL;
    END;
    INSERT INTO _results VALUES ('C6', 'other users see zero consent rows', 'raised: ' || left(v_msg, 50), false);
  END;

  -- ---------------- C7: anon has no access at all ----------------
  PERFORM set_config('request.jwt.claims', jsonb_build_object('role', 'anon')::text, true);
  BEGIN
    EXECUTE 'SET LOCAL ROLE anon';
    BEGIN
      PERFORM count(*) FROM public.user_consents;
      v_denied := false;
      v_msg := 'allowed';
    EXCEPTION WHEN others THEN
      v_denied := true;
      GET STACKED DIAGNOSTICS v_msg = MESSAGE_TEXT;
    END;
    EXECUTE 'RESET ROLE';
    INSERT INTO _results VALUES ('C7', 'anon select denied', 'denied=' || v_denied || ' ' || left(v_msg, 40), v_denied);
  EXCEPTION WHEN others THEN
    GET STACKED DIAGNOSTICS v_msg = MESSAGE_TEXT;
    BEGIN EXECUTE 'RESET ROLE'; EXCEPTION WHEN others THEN NULL; END;
    INSERT INTO _results VALUES ('C7', 'anon select denied', 'harness: ' || left(v_msg, 40), false);
  END;

  -- always return to the owner role before the final SELECT
  BEGIN
    EXECUTE 'RESET ROLE';
  EXCEPTION WHEN others THEN NULL;
  END;
END;
$do$;

SELECT step, expected, actual, ok FROM _results ORDER BY step;

ROLLBACK;
