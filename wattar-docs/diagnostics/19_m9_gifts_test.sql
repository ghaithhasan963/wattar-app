-- ============================================================
-- diagnostics/19_m9_gifts_test.sql
-- اختبار وظيفي لترحيل #79 (M9.1 — الهدايا) داخل BEGIN … ROLLBACK.
-- يغطي: الأنواع والندرة والأعمدة الجديدة، إزالة التكرار من العرض،
-- الحملات والخصم الفعلي، الجدولة (قبل/بعد النافذة)، الحد اليومي،
-- المخزون، الأرشفة مع إبقاء السجلات، سياسة العرض العام، Leaderboard
-- حقيقي، بوابات الإدارة والسبب والتدقيق، وإعادة الإرسال بنفس مفتاح
-- الازدواجية بلا خصم مزدوج.
-- ============================================================
BEGIN;

CREATE TEMP TABLE _results (step text, expected text, actual text, ok boolean) ON COMMIT DROP;

DO $do$
DECLARE
  v_admin uuid := '2488de9e-97d9-4fa6-aa0a-856de7189287';
  v_sender uuid;
  v_receiver uuid;
  v_campaign uuid;
  v_gift uuid;
  v_gift2 uuid;
  v_gift3 uuid;
  v_gift4 uuid;
  v_res jsonb;
  v_store jsonb;
  v_ok boolean;
  v_actual text;
  v_num bigint;
  v_cnt integer;
  v_tx public.wallet_transactions%ROWTYPE;
  v_row public.gifts%ROWTYPE;
  v_key text;
  v_err text;
BEGIN
  PERFORM set_config('request.jwt.claims', jsonb_build_object('role', 'service_role')::text, true);

  SELECT u.id INTO v_sender FROM public.users u
  WHERE u.role = 'user' AND u.status = 'active' ORDER BY u.created_at LIMIT 1;
  SELECT u.id INTO v_receiver FROM public.users u
  WHERE u.role = 'user' AND u.status = 'active' AND u.id <> v_sender ORDER BY u.created_at LIMIT 1;
  IF v_sender IS NULL OR v_receiver IS NULL THEN
    INSERT INTO _results VALUES ('T00', 'وجود مستخدمين اختبار', 'لا يوجد', false);
    RETURN;
  END IF;
  PERFORM public.record_wallet_transaction(v_sender, 'deposit'::public.wallet_tx_type, 200000,
    'gold', NULL, NULL, 'test', NULL, '{}'::jsonb, 'm9gift-test', 'تمويل اختبار الهدايا');

  -- T01: البنية — الأنواع والأعمدة والحملات
  SELECT count(*) INTO v_cnt FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
  WHERE t.typname = 'gift_type';
  SELECT count(*) INTO v_num FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
  WHERE t.typname = 'gift_rarity';
  v_ok := v_cnt = 8 AND v_num = 5
    AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='gifts' AND column_name='gift_type')
    AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='gifts' AND column_name='sound_url')
    AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='gifts' AND column_name='stock_sold')
    AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='gifts' AND column_name='campaign_id')
    AND EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='gift_campaigns');
  v_actual := 'types=' || v_cnt || ' rarities=' || v_num;
  INSERT INTO _results VALUES ('T01', 'أنواع وندرة وأعمدة الحملات', v_actual, v_ok);

  -- T02: لا تكرار في العرض بعد الترحيل
  SELECT count(*) INTO v_cnt FROM (
    SELECT 1 FROM public.gifts WHERE is_active
    GROUP BY name, price_gold, recipient_diamond_ratio, coalesce(category,'')
    HAVING count(*) > 1
  ) d;
  v_ok := v_cnt = 0;
  v_actual := 'duplicate_active_groups=' || v_cnt;
  INSERT INTO _results VALUES ('T02', 'صفوف الهدايا المكررة أُخفيت من العرض', v_actual, v_ok);

  -- T03: حملة إدارية بخصم 50% + تدقيق
  v_res := public.admin_upsert_gift_campaign(v_admin, NULL, jsonb_build_object(
    'key', 'm9test_ramadan',
    'name', 'M9 Test Campaign',
    'name_ar', 'حملة اختبار',
    'starts_at', (now() - interval '1 hour')::text,
    'ends_at', (now() + interval '1 day')::text,
    'discount_percent', 50,
    'is_active', true
  ), 'إنشاء حملة اختبار M9.1');
  v_campaign := (v_res ->> 'id')::uuid;
  SELECT count(*) INTO v_cnt FROM public.admin_audit_log
  WHERE target_type = 'gift_campaign' AND target_id = v_campaign AND action = 'create';
  v_ok := v_campaign IS NOT NULL AND (v_res ->> 'discount_percent')::numeric = 50 AND v_cnt = 1;
  v_actual := 'campaign=' || coalesce(v_campaign::text, 'NULL') || ' discount=' || (v_res ->> 'discount_percent') || ' audits=' || v_cnt;
  INSERT INTO _results VALUES ('T03', 'إنشاء حملة بخصم وتدقيق', v_actual, v_ok);

  -- T04: هدية جديدة مرتبطة بالحملة — تظهر في المتجر بسعر الخصم
  v_res := public.admin_upsert_gift(v_admin, NULL, jsonb_build_object(
    'name', 'M9 Campaign Gift',
    'name_ar', 'هدية حملة اختبار',
    'icon_url', '/gifts/test.png',
    'icon_emoji', '🌟',
    'price_gold', 1000,
    'recipient_diamond_ratio', 50,
    'category', 'rare',
    'gift_type', 'animated',
    'rarity', 'rare',
    'sound_url', 'https://example.com/gift.mp3',
    'effect_key', 'sparkle_gold',
    'display_duration_ms', 5000,
    'campaign_id', v_campaign,
    'sort_order', 5,
    'is_active', true
  ), 'إنشاء هدية اختبار M9.1');
  v_gift := (v_res ->> 'id')::uuid;
  v_store := public.get_public_gift_store();
  SELECT count(*) INTO v_cnt FROM jsonb_array_elements(v_store) e WHERE (e ->> 'id')::uuid = v_gift;
  v_ok := v_gift IS NOT NULL AND v_cnt = 1
    AND (SELECT (e ->> 'price')::bigint FROM jsonb_array_elements(v_store) e WHERE (e ->> 'id')::uuid = v_gift) = 500
    AND (SELECT (e ->> 'base_price')::bigint FROM jsonb_array_elements(v_store) e WHERE (e ->> 'id')::uuid = v_gift) = 1000
    AND (SELECT (e ->> 'discount_percent')::numeric FROM jsonb_array_elements(v_store) e WHERE (e ->> 'id')::uuid = v_gift) = 50
    AND (SELECT e ->> 'gift_type' FROM jsonb_array_elements(v_store) e WHERE (e ->> 'id')::uuid = v_gift) = 'animated'
    AND (SELECT e ->> 'effect_key' FROM jsonb_array_elements(v_store) e WHERE (e ->> 'id')::uuid = v_gift) = 'sparkle_gold'
    AND (SELECT (e ->> 'available')::boolean FROM jsonb_array_elements(v_store) e WHERE (e ->> 'id')::uuid = v_gift);
  v_actual := 'store_rows=' || v_cnt || ' price=' || coalesce((SELECT e ->> 'price' FROM jsonb_array_elements(v_store) e WHERE (e ->> 'id')::uuid = v_gift), 'NULL');
  INSERT INTO _results VALUES ('T04', 'هدية جديدة تظهر بلا كود وبسعر الحملة', v_actual, v_ok);

  -- T05: الإرسال يخصم سعر الحملة فعلياً (لا السعر الأساسي)
  v_key := 'm9-gift-campaign-' || substr(gen_random_uuid()::text, 1, 12);
  v_res := public.settle_gift_send(v_sender, v_receiver, v_gift, 1, NULL, NULL, v_key, 'gold');
  SELECT * INTO v_tx FROM public.wallet_transactions
  WHERE user_id = v_sender AND idempotency_key = v_key || ':out';
  v_ok := (v_res ->> 'sent_coins')::bigint = 500
    AND v_tx.amount = -500
    AND (v_res ->> 'unit_price_gold')::bigint = 500
    AND (v_res -> 'gift_transaction' ->> 'total_gold')::bigint = 500;
  v_actual := 'sent=' || (v_res ->> 'sent_coins') || ' wallet=' || coalesce(v_tx.amount::text, 'NULL')
    || ' unit=' || (v_res ->> 'unit_price_gold');
  INSERT INTO _results VALUES ('T05', 'خصم سعر الحملة على المحفظة', v_actual, v_ok);

  -- T06: إعادة الإرسال بنفس المفتاح لا تخصم مرتين
  SELECT u.balance_gold INTO v_num FROM public.users u WHERE u.id = v_sender;
  v_res := public.settle_gift_send(v_sender, v_receiver, v_gift, 1, NULL, NULL, v_key, 'gold');
  v_ok := coalesce((v_res ->> 'already_processed')::boolean, false)
    AND (SELECT u.balance_gold FROM public.users u WHERE u.id = v_sender) = v_num
    AND (SELECT count(*) FROM public.gift_transactions t WHERE t.idempotency_key = v_key) = 1;
  v_actual := 'already=' || coalesce(v_res ->> 'already_processed', 'NULL') || ' balance=' || v_num;
  INSERT INTO _results VALUES ('T06', 'مفتاح الازدواجية يمنع خصماً مزدوجاً', v_actual, v_ok);

  -- T07: جدولة — هدية مستقبلية مرفوضة من الخادم وغير متاحة في المتجر
  v_res := public.admin_upsert_gift(v_admin, NULL, jsonb_build_object(
    'name', 'M9 Seasonal Future',
    'name_ar', 'هدية موسمية قادمة',
    'icon_url', '/gifts/season.png',
    'icon_emoji', '❄️',
    'price_gold', 100,
    'recipient_diamond_ratio', 50,
    'category', 'seasonal',
    'gift_type', 'seasonal',
    'rarity', 'uncommon',
    'available_from', (now() + interval '2 days')::text,
    'available_to', (now() + interval '9 days')::text,
    'is_active', true
  ), 'جدولة هدية موسمية');
  v_gift2 := (v_res ->> 'id')::uuid;
  v_store := public.get_public_gift_store();
  v_ok := public.gift_availability_reason(v_gift2) LIKE '%لم يبدأ%'
    AND (SELECT NOT (e ->> 'available')::boolean FROM jsonb_array_elements(v_store) e WHERE (e ->> 'id')::uuid = v_gift2);
  BEGIN
    PERFORM public.settle_gift_send(v_sender, v_receiver, v_gift2, 1, NULL, NULL,
      'm9-gift-future-' || substr(gen_random_uuid()::text, 1, 10), 'gold');
    v_err := 'قُبلت — خطأ';
    v_ok := false;
  EXCEPTION WHEN OTHERS THEN
    v_err := SQLERRM;
    v_ok := v_ok AND position('لم يبدأ' in SQLERRM) > 0;
  END;
  v_actual := 'reason=' || coalesce(public.gift_availability_reason(v_gift2), 'NULL') || ' send=' || v_err;
  INSERT INTO _results VALUES ('T07', 'الجدولة تمنع البيع قبل موعدها', v_actual, v_ok);

  -- T08: حد يومي لكل مستخدم
  v_res := public.admin_upsert_gift(v_admin, NULL, jsonb_build_object(
    'name', 'M9 Daily Limited',
    'name_ar', 'هدية بحد يومي',
    'icon_url', '/gifts/daily.png',
    'icon_emoji', '🎯',
    'price_gold', 100,
    'recipient_diamond_ratio', 50,
    'category', 'common',
    'daily_limit_per_user', 2,
    'is_active', true
  ), 'هدية بحد يومي للاختبار');
  v_gift3 := (v_res ->> 'id')::uuid;
  PERFORM public.settle_gift_send(v_sender, v_receiver, v_gift3, 2, NULL, NULL,
    'm9-gift-daily-a-' || substr(gen_random_uuid()::text, 1, 10), 'gold');
  BEGIN
    PERFORM public.settle_gift_send(v_sender, v_receiver, v_gift3, 1, NULL, NULL,
      'm9-gift-daily-b-' || substr(gen_random_uuid()::text, 1, 10), 'gold');
    v_ok := false; v_actual := 'قُبل فوق الحد — خطأ';
  EXCEPTION WHEN OTHERS THEN
    v_ok := position('الحد اليومي' in SQLERRM) > 0;
    v_actual := SQLERRM;
  END;
  INSERT INTO _results VALUES ('T08', 'الحد اليومي يُفرض خادمياً', v_actual, v_ok);

  -- T09: المخزون — ينفد ويُرفض البيع بعده
  v_res := public.admin_upsert_gift(v_admin, NULL, jsonb_build_object(
    'name', 'M9 Stock One',
    'name_ar', 'هدية بمخزون واحد',
    'icon_url', '/gifts/stock.png',
    'icon_emoji', '💎',
    'price_gold', 100,
    'recipient_diamond_ratio', 50,
    'category', 'rare',
    'stock_total', 1,
    'is_active', true
  ), 'هدية بمخزون محدود للاختبار');
  v_gift4 := (v_res ->> 'id')::uuid;
  PERFORM public.settle_gift_send(v_sender, v_receiver, v_gift4, 1, NULL, NULL,
    'm9-gift-stock-a-' || substr(gen_random_uuid()::text, 1, 10), 'gold');
  SELECT * INTO v_row FROM public.gifts WHERE id = v_gift4;
  BEGIN
    PERFORM public.settle_gift_send(v_sender, v_receiver, v_gift4, 1, NULL, NULL,
      'm9-gift-stock-b-' || substr(gen_random_uuid()::text, 1, 10), 'gold');
    v_ok := false; v_actual := 'قُبل بعد النفاد — خطأ';
  EXCEPTION WHEN OTHERS THEN
    v_ok := v_row.stock_sold = 1 AND position('نفدت' in SQLERRM) > 0;
    v_actual := 'sold=' || v_row.stock_sold || ' | ' || SQLERRM;
  END;
  INSERT INTO _results VALUES ('T09', 'المخزون يُخصم ويُرفض بعد النفاد', v_actual, v_ok);

  -- T10: الأرشفة تُخفي الهدية وتُبقي كل السجلات
  SELECT count(*) INTO v_num FROM public.gift_transactions WHERE gift_id = v_gift;
  v_res := public.admin_archive_gift(v_admin, v_gift, 'أرشفة هدية اختبار');
  v_store := public.get_public_gift_store();
  v_ok := coalesce((v_res ->> 'archived')::boolean, false)
    AND (v_res ->> 'gift_transactions_kept')::bigint = v_num
    AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v_store) e WHERE (e ->> 'id')::uuid = v_gift)
    AND (SELECT count(*) FROM public.gift_transactions WHERE gift_id = v_gift) = v_num;
  v_actual := 'kept=' || (v_res ->> 'gift_transactions_kept') || ' before=' || v_num;
  INSERT INTO _results VALUES ('T10', 'الأرشفة تُخفي العرض وتُبقي السجلات', v_actual, v_ok);

  -- T11: سياسة العرض العام تحجب المؤرشفة عن المستخدم العادي
  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO v_cnt FROM public.gifts WHERE id = v_gift;
  RESET ROLE;
  v_ok := v_cnt = 0;
  v_actual := 'visible_to_authenticated=' || v_cnt;
  INSERT INTO _results VALUES ('T11', 'المستخدم لا يرى الهدية المؤرشفة', v_actual, v_ok);

  -- T12: الإرسال لهدية مؤرشفة مرفوض
  BEGIN
    PERFORM public.settle_gift_send(v_sender, v_receiver, v_gift, 1, NULL, NULL,
      'm9-gift-arch-' || substr(gen_random_uuid()::text, 1, 11), 'gold');
    v_ok := false; v_actual := 'قُبلت مؤرشفة — خطأ';
  EXCEPTION WHEN OTHERS THEN
    v_ok := position('غير متاحة' in SQLERRM) > 0;
    v_actual := SQLERRM;
  END;
  INSERT INTO _results VALUES ('T12', 'المؤرشفة لا تُباع', v_actual, v_ok);

  -- T13: Leaderboard حقيقي من الحركات
  v_res := public.get_gift_leaderboard('day', 10);
  v_ok := (v_res ->> 'period') = 'day'
    AND EXISTS (
      SELECT 1 FROM jsonb_array_elements(v_res -> 'senders') s
      WHERE (s ->> 'user_id')::uuid = v_sender AND (s ->> 'coins_spent')::bigint >= 800
    )
    AND EXISTS (
      SELECT 1 FROM jsonb_array_elements(v_res -> 'receivers') r
      WHERE (r ->> 'user_id')::uuid = v_receiver
    );
  v_actual := 'senders=' || jsonb_array_length(v_res -> 'senders')
    || ' receivers=' || jsonb_array_length(v_res -> 'receivers')
    || ' top_spent=' || coalesce(v_res -> 'senders' -> 0 ->> 'coins_spent', 'NULL');
  INSERT INTO _results VALUES ('T13', 'Leaderboard من حركات حقيقية', v_actual, v_ok);

  -- T14: بوابة الإدارة والسبب والتدقيق قبل/بعد
  PERFORM set_config('request.jwt.claims',
    jsonb_build_object('sub', v_sender::text, 'role', 'authenticated')::text, true);
  BEGIN
    PERFORM public.admin_upsert_gift(v_sender, v_gift3, jsonb_build_object(
      'name', 'Hacked', 'icon_url', '/gifts/x.png', 'price_gold', 1
    ), 'محاولة غير مصرحة');
    v_ok := false; v_actual := 'قُبل من مستخدم — خطأ';
  EXCEPTION WHEN OTHERS THEN
    v_ok := position('غير مصرح' in SQLERRM) > 0;
    v_actual := SQLERRM;
  END;
  PERFORM set_config('request.jwt.claims', jsonb_build_object('role', 'service_role')::text, true);
  BEGIN
    PERFORM public.admin_upsert_gift(v_admin, v_gift3, jsonb_build_object(
      'name', 'M9 Daily Limited', 'icon_url', '/gifts/daily.png', 'price_gold', 100
    ), NULL);
    v_ok := v_ok AND false; v_actual := v_actual || ' | بلا سبب قُبل — خطأ';
  EXCEPTION WHEN OTHERS THEN
    v_ok := v_ok AND position('سبب' in SQLERRM) > 0;
    v_actual := v_actual || ' | ' || SQLERRM;
  END;
  v_res := public.admin_upsert_gift(v_admin, v_gift3, jsonb_build_object(
    'name', 'M9 Daily Limited',
    'name_ar', 'هدية بحد يومي',
    'icon_url', '/gifts/daily.png',
    'icon_emoji', '🎯',
    'price_gold', 150,
    'recipient_diamond_ratio', 50,
    'category', 'common',
    'daily_limit_per_user', 2,
    'is_active', true
  ), 'تعديل سعر هدية الاختبار');
  SELECT count(*) INTO v_cnt FROM public.admin_audit_log
  WHERE target_type = 'gift' AND target_id = v_gift3 AND action = 'update'
    AND (metadata ->> 'price_before')::bigint = 100
    AND (metadata ->> 'price_after')::bigint = 150;
  v_ok := v_ok AND v_cnt = 1 AND (v_res ->> 'price_gold')::bigint = 150;
  v_actual := v_actual || ' | audits=' || v_cnt || ' price=' || (v_res ->> 'price_gold');
  INSERT INTO _results VALUES ('T14', 'بوابة الإدارة والسبب والتدقيق', v_actual, v_ok);

  -- T15: القوائم الإدارية تعمل وتُرجع الحملة والسجلات
  v_res := public.admin_list_gifts(v_admin);
  v_ok := jsonb_array_length(v_res) >= 4
    AND EXISTS (SELECT 1 FROM jsonb_array_elements(v_res) e WHERE (e ->> 'id')::uuid = v_gift4
                AND (e ->> 'stock_sold')::int = 1)
    AND EXISTS (SELECT 1 FROM jsonb_array_elements(v_res) e WHERE (e ->> 'id')::uuid = v_gift
                AND (e ->> 'campaign_id')::uuid = v_campaign);
  v_actual := 'gifts=' || jsonb_array_length(v_res);
  INSERT INTO _results VALUES ('T15', 'قائمة الإدارة تعرض الحملة والمخزون', v_actual, v_ok);

  v_res := public.admin_list_gift_campaigns(v_admin);
  v_ok := EXISTS (SELECT 1 FROM jsonb_array_elements(v_res) e WHERE (e ->> 'id')::uuid = v_campaign
                  AND (e ->> 'running')::boolean);
  v_actual := 'campaigns=' || jsonb_array_length(v_res);
  INSERT INTO _results VALUES ('T16', 'قائمة الحملات وتمييز الجارية', v_actual, v_ok);
END $do$;

SELECT * FROM _results ORDER BY step;

ROLLBACK;
