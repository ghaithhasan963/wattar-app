-- ============================================================
-- diagnostics/11_m7_user_details_test.sql
-- اختبار وظيفي حقيقي لـ M7.3 (تفاصيل المستخدم — ترحيل #72).
-- كل شيء داخل BEGIN … ROLLBACK فلا يغيّر شيئًا في النهاية.
-- ============================================================
BEGIN;

CREATE TEMP TABLE _results (step text, expected text, actual text, ok boolean) ON COMMIT DROP;

DO $do$
DECLARE
  v_super uuid := '2488de9e-97d9-4fa6-aa0a-856de7189287';
  v_user  uuid := 'd62640a7-07c2-4786-984c-be7a52751ab2';
  v_detail jsonb;
  v_before_gold bigint;
  v_adjust_result jsonb;
  v_adjust_tx uuid;
  v_reverse_result jsonb;
  v_ok boolean;
  v_actual text;
BEGIN
  PERFORM set_config('request.jwt.claims', jsonb_build_object('role', 'service_role')::text, true);

  -- T01: قراءة تفاصيل المستخدم
  BEGIN
    SELECT public.admin_get_user_detail(v_super, v_user) INTO v_detail;
    v_ok := v_detail IS NOT NULL;
    v_actual := 'result_type=' || pg_typeof(v_detail) || ' isnull=' || (v_detail IS NULL)::text;
  EXCEPTION WHEN OTHERS THEN
    v_ok := false; v_actual := 'error: ' || SQLERRM;
  END;
  INSERT INTO _results VALUES ('T01', 'تفاصيل المستخدم تُعاد بصيغة JSON', v_actual, v_ok);

  -- حفظ الرصيد قبل التعديل
  SELECT (v_detail->'wallet'->>'balance_gold')::bigint INTO v_before_gold;

  -- T02: تعديل رصيد المستخدم (+100 Coin) بسبب إلزامي
  BEGIN
    SELECT public.admin_adjust_user_balance(
      p_admin_id => v_super, p_user_id => v_user,
      p_currency => 'gold', p_amount => 100,
      p_reason => 'اختبار تعديل رصيد مستخدم عبر لوحة الإدارة — إضافة 100 Coin للتجربة',
      p_idempotency_key => 'm73-test-adjust-' || gen_random_uuid()::text
    ) INTO v_adjust_result;
    v_ok := v_adjust_result IS NOT NULL AND (v_adjust_result->>'transaction_id') IS NOT NULL;
    v_adjust_tx := (v_adjust_result->>'transaction_id')::uuid;
    v_actual := 'tx=' || v_adjust_tx::text || ' balance_before=' || (v_adjust_result->>'balance_before') || ' balance_after=' || (v_adjust_result->>'balance_after');
  EXCEPTION WHEN OTHERS THEN
    v_ok := false; v_actual := 'error: ' || SQLERRM;
  END;
  INSERT INTO _results VALUES ('T02', 'تعديل الرصيد ينجح (+100 Coin)', v_actual, v_ok);

  -- T03: التحقق من تحديث الرصيد
  BEGIN
    SELECT public.admin_get_user_detail(v_super, v_user) INTO v_detail;
    v_ok := (v_detail->'wallet'->>'balance_gold')::bigint = v_before_gold + 100;
    v_actual := 'قبل=' || v_before_gold || ' بعد=' || (v_detail->'wallet'->>'balance_gold');
  EXCEPTION WHEN OTHERS THEN
    v_ok := false; v_actual := 'error: ' || SQLERRM;
  END;
  INSERT INTO _results VALUES ('T03', 'الرصيد زاد بمقدار 100', v_actual, v_ok);

  -- T04: عكس الحركة بسبب إلزامي
  BEGIN
    SELECT public.admin_reverse_user_transaction(
      p_admin_id => v_super, p_transaction_id => v_adjust_tx,
      p_reason => 'اختبار عكس قيد تعديل رصيد مستخدم — إعادة الحالة للسابقة'
    ) INTO v_reverse_result;
    v_ok := v_reverse_result IS NOT NULL AND (v_reverse_result->>'success')::boolean = true;
    v_actual := 'reversed=' || (v_reverse_result->>'reversal_transaction_id')::text;
  EXCEPTION WHEN OTHERS THEN
    v_ok := false; v_actual := 'error: ' || SQLERRM;
  END;
  INSERT INTO _results VALUES ('T04', 'عكس القيد ينجح', v_actual, v_ok);

  -- T05: الرصيد عاد للسابقة بعد العكس
  BEGIN
    SELECT public.admin_get_user_detail(v_super, v_user) INTO v_detail;
    v_ok := (v_detail->'wallet'->>'balance_gold')::bigint = v_before_gold;
    v_actual := 'بعد العكس=' || (v_detail->'wallet'->>'balance_gold');
  EXCEPTION WHEN OTHERS THEN
    v_ok := false; v_actual := 'error: ' || SQLERRM;
  END;
  INSERT INTO _results VALUES ('T05', 'الرصيد عاد للسابقة بعد العكس', v_actual, v_ok);

  -- T06: رفض سبب قصير (< 10 أحرف)
  BEGIN
    SELECT public.admin_adjust_user_balance(
      p_admin_id => v_super, p_user_id => v_user,
      p_currency => 'gold', p_amount => 10, p_reason => 'اختبار'
    ) INTO v_adjust_result;
    v_ok := false; v_actual := 'تم قبول السبب القصير — خطأ';
  EXCEPTION WHEN OTHERS THEN
    v_ok := true; v_actual := 'مرفوض كما هو متوقع';
  END;
  INSERT INTO _results VALUES ('T06', 'رفض سبب قصير (< 10 أحرف)', v_actual, v_ok);

  -- T07: رفض عكس قيد عكسي
  BEGIN
    SELECT public.admin_reverse_user_transaction(
      p_admin_id => v_super,
      p_transaction_id => (v_reverse_result->>'reversal_transaction_id')::uuid,
      p_reason => 'محاولة عكس قيد عكسي — يجب الرفض'
    ) INTO v_adjust_result;
    v_ok := false; v_actual := 'تم قبول عكس العكس — خطأ';
  EXCEPTION WHEN OTHERS THEN
    v_ok := true; v_actual := 'مرفوض كما هو متوقع';
  END;
  INSERT INTO _results VALUES ('T07', 'رفض عكس قيد عكسي', v_actual, v_ok);

  SELECT bool_and(ok) INTO v_ok FROM _results;
  RAISE NOTICE '=== نتيجة اختبار م7.3: % ===', v_ok;
END $do$;

SELECT * FROM _results ORDER BY step;

ROLLBACK;
