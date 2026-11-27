-- ============================================================
-- patch_m9_gifts.sql  (Migration #79)
-- M9.1 — نظام الهدايا الاحترافي (القسم 10)
--   * أنواع الهدايا: normal / animated / entry / huge / seasonal /
--     rare / collective / occasion، وندرة: common..legendary.
--   * مؤثرات صوتية وبصرية: sound_url + effect_key + animation_url
--     + display_duration_ms (مدة العرض داخل الغرفة).
--   * متجر منظّم: get_public_gift_store يرتّب حسب التصنيف والسعر
--     والندرة ويعرض السعر الفعلي بعد خصم الحملة وحالة التوفر.
--   * جدولة موسمية: available_from/available_to، والحملات في
--     gift_campaigns (نسبة خصم + نافذة زمنية) بلا مساس بالعمليات
--     التاريخية — كل تغيير يطبق على العمليات المستقبلية فقط.
--   * إدارة كاملة بلا حذف سجلات: admin_upsert_gift (إنشاء/تعديل)،
--     admin_archive_gift (إزالة من العرض مع إبقاء الصف والسجلات)،
--     admin_upsert_gift_campaign، وقوائم إدارية بصلاحية store.*
--     وسبب إلزامي وتدقيق قبل/بعد في admin_audit_log.
--   * تنفيذ الخادم: settle_gift_send يتحقق من التوفر والجدولة والحد
--     اليومي والمخزون ويخصم سعر الحملة الفعلي — لا يعتمد على العميل.
--   * Leaderboard حقيقي من gift_transactions (يوم/أسبوع/شهر/الكل).
--   * إضافة هدية جديدة من اللوحة تظهر في التطبيق بلا أي تعديل كود.
-- يعتمد على: #12/#27 (gifts + gift_transactions + settle_gift_send)،
--             #69 (admin_staff_can)، #74p/#77p (نمط الترحيلات).
-- ============================================================
BEGIN;

-- زناد تدقيق gifts يشترط جلسة مسؤول: ننحّي الجلسة إلى service_role
-- ثم نعيدها قبل COMMIT (نمط #75/#76/#77)
SELECT set_config('request.jwt.claims', '{"role":"service_role"}', true);

-- ============================================================
-- 1) الأنواع
-- ============================================================
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
                 WHERE n.nspname = 'public' AND t.typname = 'gift_type') THEN
    CREATE TYPE public.gift_type AS ENUM
      ('normal', 'animated', 'entry', 'huge', 'seasonal', 'rare', 'collective', 'occasion');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
                 WHERE n.nspname = 'public' AND t.typname = 'gift_rarity') THEN
    CREATE TYPE public.gift_rarity AS ENUM
      ('common', 'uncommon', 'rare', 'epic', 'legendary');
  END IF;
END $$;

-- ============================================================
-- 2) الحملات (خصم + نافذة زمنية) — لا تعدّل أي عملية سابقة
-- ============================================================
CREATE TABLE IF NOT EXISTS public.gift_campaigns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key text NOT NULL UNIQUE CHECK (key ~ '^[a-z0-9_]{3,60}$'),
  name character varying(80) NOT NULL CHECK (char_length(btrim(name)) BETWEEN 2 AND 80),
  name_ar character varying(80) CHECK (name_ar IS NULL OR char_length(btrim(name_ar)) BETWEEN 2 AND 80),
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL,
  discount_percent numeric(5,2) NOT NULL DEFAULT 0 CHECK (discount_percent BETWEEN 0 AND 90),
  is_active boolean NOT NULL DEFAULT true,
  created_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT gift_campaigns_window CHECK (ends_at > starts_at)
);

ALTER TABLE public.gift_campaigns ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.gift_campaigns FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.gift_campaigns TO anon, authenticated, service_role;

DROP POLICY IF EXISTS gift_campaigns_public_select ON public.gift_campaigns;
CREATE POLICY gift_campaigns_public_select ON public.gift_campaigns
  FOR SELECT TO anon, authenticated
  USING (is_active AND now() BETWEEN starts_at AND ends_at);

DROP POLICY IF EXISTS gift_campaigns_admin_select ON public.gift_campaigns;
CREATE POLICY gift_campaigns_admin_select ON public.gift_campaigns
  FOR SELECT TO authenticated
  USING (public.is_admin());

-- ============================================================
-- 3) توسيع جدول الهدايا
-- ============================================================
ALTER TABLE public.gifts
  ADD COLUMN IF NOT EXISTS gift_type public.gift_type NOT NULL DEFAULT 'normal',
  ADD COLUMN IF NOT EXISTS rarity public.gift_rarity NOT NULL DEFAULT 'common',
  ADD COLUMN IF NOT EXISTS sound_url text,
  ADD COLUMN IF NOT EXISTS effect_key text,
  ADD COLUMN IF NOT EXISTS display_duration_ms integer NOT NULL DEFAULT 4000,
  ADD COLUMN IF NOT EXISTS available_from timestamptz,
  ADD COLUMN IF NOT EXISTS available_to timestamptz,
  ADD COLUMN IF NOT EXISTS campaign_id uuid REFERENCES public.gift_campaigns(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS daily_limit_per_user integer,
  ADD COLUMN IF NOT EXISTS stock_total integer,
  ADD COLUMN IF NOT EXISTS stock_sold integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS archived_at timestamptz,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS updated_by uuid REFERENCES public.users(id) ON DELETE SET NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.gifts'::regclass AND conname = 'gifts_effects_check'
  ) THEN
    ALTER TABLE public.gifts ADD CONSTRAINT gifts_effects_check CHECK (
      (sound_url IS NULL OR sound_url = '' OR sound_url LIKE '/gifts/%' OR sound_url ~* '^https://')
      AND (effect_key IS NULL OR char_length(effect_key) BETWEEN 1 AND 60)
      AND display_duration_ms BETWEEN 1000 AND 30000
    );
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.gifts'::regclass AND conname = 'gifts_window_check'
  ) THEN
    ALTER TABLE public.gifts ADD CONSTRAINT gifts_window_check CHECK (
      available_to IS NULL OR available_from IS NULL OR available_to > available_from
    );
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.gifts'::regclass AND conname = 'gifts_stock_check'
  ) THEN
    ALTER TABLE public.gifts ADD CONSTRAINT gifts_stock_check CHECK (
      (daily_limit_per_user IS NULL OR daily_limit_per_user BETWEEN 1 AND 1000)
      AND (stock_total IS NULL OR stock_total BETWEEN 1 AND 1000000)
      AND stock_sold >= 0
      AND (stock_total IS NULL OR stock_sold <= stock_total)
    );
  END IF;
END $$;

-- الندرة من التصنيف الحالي (لا يغيّر أي تصنيف قائم)
UPDATE public.gifts
SET rarity = CASE lower(coalesce(category, ''))
    WHEN 'uncommon' THEN 'uncommon'::public.gift_rarity
    WHEN 'rare' THEN 'rare'::public.gift_rarity
    WHEN 'epic' THEN 'epic'::public.gift_rarity
    WHEN 'legendary' THEN 'legendary'::public.gift_rarity
    ELSE 'common'::public.gift_rarity
  END
WHERE rarity = 'common' AND lower(coalesce(category, '')) IN ('uncommon', 'rare', 'epic', 'legendary');

CREATE INDEX IF NOT EXISTS gifts_store_order
  ON public.gifts (is_active, category, sort_order);
CREATE INDEX IF NOT EXISTS gift_tx_sender_gift_time
  ON public.gift_transactions (from_user_id, gift_id, created_at DESC);
CREATE INDEX IF NOT EXISTS gift_tx_created
  ON public.gift_transactions (created_at DESC);
CREATE INDEX IF NOT EXISTS gift_tx_receiver_time
  ON public.gift_transactions (to_user_id, created_at DESC);

-- إزالة التكرار الحقيقي من العرض: صفوف متطابقة (اسم/سعر/نسبة/تصنيف)
-- أُنشئت في اللحظة نفسها. نُبقي الصف الأكثر استخداماً في السجلات
-- ونُخفي الباقي فقط (لا حذف لأي صف أو أي حركة تاريخية).
WITH ranked AS (
  SELECT g.id,
         row_number() OVER (
           PARTITION BY g.name, g.price_gold, g.recipient_diamond_ratio, coalesce(g.category, '')
           ORDER BY (SELECT count(*) FROM public.gift_transactions t WHERE t.gift_id = g.id) DESC, g.id
         ) AS rn
  FROM public.gifts g
  WHERE g.is_active
)
UPDATE public.gifts g
SET is_active = false, archived_at = now(), updated_at = now()
FROM ranked r
WHERE g.id = r.id AND r.rn > 1;

-- عرض عام يحترم الإيقاف والأرشفة ونافذة الجدولة
DROP POLICY IF EXISTS gifts_public_select ON public.gifts;
CREATE POLICY gifts_public_select ON public.gifts
  FOR SELECT TO anon, authenticated
  USING (
    is_active
    AND archived_at IS NULL
    AND (available_from IS NULL OR available_from <= now())
    AND (available_to IS NULL OR available_to >= now())
  );

-- ============================================================
-- 4) السعر الفعلي والتوفر
-- ============================================================
CREATE OR REPLACE FUNCTION public.gift_effective_price(p_gift_id uuid)
RETURNS bigint
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT greatest(1, floor(
    g.price_gold * (1 - coalesce(c.discount_percent, 0) / 100)
  ))::bigint
  FROM public.gifts g
  LEFT JOIN public.gift_campaigns c
    ON c.id = g.campaign_id
   AND c.is_active
   AND now() BETWEEN c.starts_at AND c.ends_at
  WHERE g.id = p_gift_id;
$$;
REVOKE ALL ON FUNCTION public.gift_effective_price(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.gift_effective_price(uuid) TO authenticated, service_role;

-- سبب عدم التوفر (NULL = متاحة الآن) — تُستخدم في المتجر وفي التسوية
CREATE OR REPLACE FUNCTION public.gift_availability_reason(p_gift_id uuid)
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_gift public.gifts%ROWTYPE;
BEGIN
  SELECT * INTO v_gift FROM public.gifts WHERE id = p_gift_id;
  IF NOT FOUND THEN
    RETURN 'الهدية غير موجودة';
  END IF;
  IF NOT v_gift.is_active OR v_gift.archived_at IS NOT NULL THEN
    RETURN 'الهدية غير متاحة حالياً';
  END IF;
  IF v_gift.available_from IS NOT NULL AND v_gift.available_from > now() THEN
    RETURN 'لم يبدأ عرض هذه الهدية بعد';
  END IF;
  IF v_gift.available_to IS NOT NULL AND v_gift.available_to < now() THEN
    RETURN 'انتهت مدة عرض هذه الهدية';
  END IF;
  IF v_gift.stock_total IS NOT NULL AND v_gift.stock_sold >= v_gift.stock_total THEN
    RETURN 'نفدت كمية هذه الهدية';
  END IF;
  RETURN NULL;
END;
$$;
REVOKE ALL ON FUNCTION public.gift_availability_reason(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.gift_availability_reason(uuid) TO authenticated, service_role;

-- ============================================================
-- 5) متجر الهدايا للتطبيق — كل البيانات من القاعدة
-- ============================================================
CREATE OR REPLACE FUNCTION public.get_public_gift_store()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT coalesce(jsonb_agg(row_to_json(t)::jsonb ORDER BY t.sort_order, t.price, t.name), '[]'::jsonb)
  FROM (
    SELECT
      g.id,
      g.name,
      g.name_ar,
      g.icon_url,
      g.icon_emoji,
      g.animation_url,
      g.sound_url,
      g.effect_key,
      g.display_duration_ms,
      g.gift_type::text AS gift_type,
      g.rarity::text AS rarity,
      g.category,
      g.is_premium,
      g.recipient_diamond_ratio,
      g.price_gold AS base_price,
      public.gift_effective_price(g.id) AS price,
      CASE
        WHEN c.id IS NOT NULL THEN c.discount_percent
        ELSE 0
      END AS discount_percent,
      CASE WHEN c.id IS NOT NULL THEN coalesce(c.name_ar, c.name) ELSE NULL END AS campaign,
      g.available_from,
      g.available_to,
      g.daily_limit_per_user,
      CASE WHEN g.stock_total IS NULL THEN NULL
           ELSE greatest(g.stock_total - g.stock_sold, 0) END AS stock_remaining,
      g.sort_order,
      public.gift_availability_reason(g.id) IS NULL AS available,
      public.gift_availability_reason(g.id) AS unavailable_reason
    FROM public.gifts g
    LEFT JOIN public.gift_campaigns c
      ON c.id = g.campaign_id
     AND c.is_active
     AND now() BETWEEN c.starts_at AND c.ends_at
    WHERE g.is_active AND g.archived_at IS NULL
  ) t;
$$;
REVOKE ALL ON FUNCTION public.get_public_gift_store() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_public_gift_store() TO anon, authenticated, service_role;

-- ============================================================
-- 6) Leaderboard حقيقي (بلا بيانات وهمية)
-- ============================================================
CREATE OR REPLACE FUNCTION public.get_gift_leaderboard(
  p_period text DEFAULT 'week',
  p_limit integer DEFAULT 10
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_period text := lower(coalesce(nullif(btrim(p_period), ''), 'week'));
  v_limit integer := least(greatest(coalesce(p_limit, 10), 1), 50);
  v_from timestamptz;
  v_senders jsonb;
  v_receivers jsonb;
BEGIN
  IF v_period NOT IN ('day', 'week', 'month', 'all') THEN
    RAISE EXCEPTION 'فترة غير صالحة (day/week/month/all)';
  END IF;

  v_from := CASE v_period
    WHEN 'day' THEN date_trunc('day', now())
    WHEN 'week' THEN date_trunc('week', now())
    WHEN 'month' THEN date_trunc('month', now())
    ELSE NULL
  END;

  SELECT coalesce(jsonb_agg(row_to_json(s)::jsonb ORDER BY s.rank), '[]'::jsonb) INTO v_senders
  FROM (
    SELECT row_number() OVER (ORDER BY sum(t.total_gold) DESC, u.id) AS rank,
           u.id AS user_id,
           u.username,
           u.display_name,
           u.avatar_url,
           sum(t.total_gold)::bigint AS coins_spent,
           count(*)::bigint AS gifts_count
    FROM public.gift_transactions t
    JOIN public.users u ON u.id = t.from_user_id
    WHERE v_from IS NULL OR t.created_at >= v_from
    GROUP BY u.id, u.username, u.display_name, u.avatar_url
    ORDER BY coins_spent DESC, u.id
    LIMIT v_limit
  ) s;

  SELECT coalesce(jsonb_agg(row_to_json(r)::jsonb ORDER BY r.rank), '[]'::jsonb) INTO v_receivers
  FROM (
    SELECT row_number() OVER (ORDER BY sum(t.received_diamond) DESC, u.id) AS rank,
           u.id AS user_id,
           u.username,
           u.display_name,
           u.avatar_url,
           sum(t.received_diamond)::bigint AS earnings_total,
           coalesce(sum(t.received_diamond) FILTER (WHERE t.received_diamond_currency = 'diamond'), 0)::bigint AS diamond_earned,
           coalesce(sum(t.received_diamond) FILTER (WHERE t.received_diamond_currency = 'gold'), 0)::bigint AS gold_earned,
           count(*)::bigint AS gifts_count
    FROM public.gift_transactions t
    JOIN public.users u ON u.id = t.to_user_id
    WHERE v_from IS NULL OR t.created_at >= v_from
    GROUP BY u.id, u.username, u.display_name, u.avatar_url
    ORDER BY earnings_total DESC, u.id
    LIMIT v_limit
  ) r;

  RETURN jsonb_build_object(
    'period', v_period,
    'from', v_from,
    'limit', v_limit,
    'senders', v_senders,
    'receivers', v_receivers
  );
END;
$$;
REVOKE ALL ON FUNCTION public.get_gift_leaderboard(text, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_gift_leaderboard(text, integer) TO anon, authenticated, service_role;

-- ============================================================
-- 7) التسوية: توفر + جدولة + حد يومي + مخزون + سعر الحملة
--    (الجسم مطابق لنسخة #27 مع إضافة البوابات فقط)
-- ============================================================
CREATE OR REPLACE FUNCTION public.settle_gift_send(p_from_user_id uuid, p_to_user_id uuid, p_gift_id uuid, p_quantity integer, p_room_id uuid, p_message text, p_idempotency_key text, p_funding_currency character varying)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_existing public.gift_transactions%rowtype;
  v_gift public.gifts%rowtype;
  v_unavailable text;
  v_sent_today bigint;
  v_unit_price bigint;
  v_total_coins bigint;
  v_gross bigint;
  v_received bigint;
  v_earn_currency varchar(10);
  v_is_verified_host boolean;
  v_gift_transaction_id uuid := gen_random_uuid();
  v_gift_transaction public.gift_transactions%rowtype;
  v_rates jsonb;
  v_gold_usdt numeric(24,8);
  v_diamonds_per_usd numeric(24,8);
  v_diamond_usdt numeric(24,8);
  v_platform_pct numeric(5,2);
  v_agent_pct numeric(5,2);
  v_agent_id uuid;
  v_agent_user_id uuid;
  v_platform_cut bigint;
  v_agent_cut bigint;
  v_host_net bigint;
  v_sender_usd numeric(24,8);
  v_credited_usd numeric(24,8);
  v_spread_usd numeric(24,8);
  v_breakdown jsonb;
begin
  if auth.role() <> 'service_role' then raise exception 'Not authorized'; end if;
  if p_from_user_id is null or p_to_user_id is null or p_from_user_id = p_to_user_id
     or p_quantity not between 1 and 100
     or p_funding_currency is distinct from 'gold'
     or length(trim(coalesce(p_idempotency_key, ''))) not between 10 and 90
     or length(coalesce(p_message, '')) > 500 then
    raise exception 'Invalid gift request';
  end if;
  perform pg_advisory_xact_lock(hashtext('gift-send:' || p_idempotency_key));
  select * into v_existing from public.gift_transactions
  where idempotency_key = p_idempotency_key for update;
  if found then
    if v_existing.from_user_id <> p_from_user_id or v_existing.to_user_id <> p_to_user_id
       or v_existing.gift_id <> p_gift_id or v_existing.quantity <> p_quantity
       or v_existing.room_id is distinct from p_room_id
       or v_existing.message is distinct from nullif(trim(p_message), '')
       or v_existing.funding_currency <> p_funding_currency then
      raise exception 'Idempotency key already used with different gift data';
    end if;
    return jsonb_build_object(
      'success', true, 'already_processed', true,
      'gift_transaction', to_jsonb(v_existing),
      'sent_coins', v_existing.total_gold,
      'received_amount', v_existing.received_diamond,
      'received_currency', v_existing.received_diamond_currency
    );
  end if;

  if not exists (select 1 from public.users where id = p_from_user_id and status = 'active')
     or not exists (select 1 from public.users where id = p_to_user_id and status = 'active') then
    raise exception 'Sender or recipient is unavailable';
  end if;
  if exists (
    select 1 from public.user_blocks b
    where (b.blocker_id = p_from_user_id and b.blocked_id = p_to_user_id)
       or (b.blocker_id = p_to_user_id and b.blocked_id = p_from_user_id)
  ) then raise exception 'Cannot send a gift to this user'; end if;
  perform 1 from public.users where id in (p_from_user_id, p_to_user_id)
    order by id for update;

  -- بوابة M9.1: التوفر والجدولة والمخزون (قبل أي خصم مالي)
  v_unavailable := public.gift_availability_reason(p_gift_id);
  if v_unavailable is not null then
    raise exception '%', v_unavailable;
  end if;

  select * into v_gift from public.gifts where id = p_gift_id and is_active for update;
  if not found then raise exception 'Gift is not available'; end if;

  -- الحد اليومي لكل مستخدم لكل هدية (بتوقيت الخادم)
  if v_gift.daily_limit_per_user is not null then
    select coalesce(sum(t.quantity), 0) into v_sent_today
    from public.gift_transactions t
    where t.from_user_id = p_from_user_id
      and t.gift_id = p_gift_id
      and t.created_at >= date_trunc('day', now());
    if v_sent_today + p_quantity > v_gift.daily_limit_per_user then
      raise exception 'تجاوزت الحد اليومي لهذه الهدية';
    end if;
  end if;

  -- المخزون
  if v_gift.stock_total is not null
     and v_gift.stock_sold + p_quantity > v_gift.stock_total then
    raise exception 'نفدت كمية هذه الهدية';
  end if;

  select (s.value #>> '{}')::numeric into v_gold_usdt
  from public.admin_settings s where s.key = 'gold_to_usdt_rate';
  select (s.value #>> '{}')::numeric into v_diamonds_per_usd
  from public.admin_settings s where s.key = 'diamonds_per_usd';
  if coalesce(v_gold_usdt, 0) <= 0 or coalesce(v_diamonds_per_usd, 0) <= 0 then
    raise exception 'Exchange rates are not configured';
  end if;
  v_diamond_usdt := round(1 / v_diamonds_per_usd, 8);

  -- السعر الفعلي (بعد خصم الحملة النشطة) — لا يغيّر أي عملية تاريخية
  v_unit_price := public.gift_effective_price(p_gift_id);
  v_total_coins := v_unit_price * p_quantity;
  v_gross := floor(v_total_coins * v_gift.recipient_diamond_ratio / 100)::bigint;
  if v_total_coins <= 0 or v_gross <= 0 then raise exception 'Gift value is invalid'; end if;

  select exists (
    select 1 from public.verified_hosts vh
    where vh.user_id = p_to_user_id and vh.status = 'active'
  ) into v_is_verified_host;

  v_sender_usd := round(v_total_coins * v_gold_usdt, 8);

  if v_is_verified_host then
    v_earn_currency := 'diamond';

    select coalesce(
             (select vh.platform_commission_percent from public.verified_hosts vh where vh.user_id = p_to_user_id and vh.status = 'active'),
             (select (s.value #>> '{}')::numeric from public.admin_settings s where s.key = 'gift_platform_commission_percent'),
             0
           ),
           coalesce(
             (select vh.agent_commission_percent from public.verified_hosts vh where vh.user_id = p_to_user_id and vh.status = 'active'),
             (select a.gift_commission_rate from public.users u join public.agents a on a.id = u.referred_by_agent_id where u.id = p_to_user_id),
             (select (s.value #>> '{}')::numeric from public.admin_settings s where s.key = 'gift_agent_commission_percent'),
             0
           )
    into v_platform_pct, v_agent_pct;

    select a.id into v_agent_id
    from public.users u join public.agents a on a.id = u.referred_by_agent_id
    where u.id = p_to_user_id;

    select user_id into v_agent_user_id
    from public.agents where id = v_agent_id;

    -- لا وكيل أو لا حساب مستخدم له ⇒ لا عمولة وكيل
    if v_agent_id is null or v_agent_user_id is null then
      v_agent_pct := 0;
    end if;

    if coalesce(v_platform_pct, 0) + coalesce(v_agent_pct, 0) > 100 then
      raise exception 'Commission percentages exceed 100%% for this host';
    end if;

    v_platform_cut := floor(v_gross * v_platform_pct / 100)::bigint;
    v_agent_cut := floor((v_gross - v_platform_cut) * v_agent_pct / 100)::bigint;
    v_host_net := v_gross - v_platform_cut - v_agent_cut;
    v_received := v_host_net;  -- المضيفة تستلم الصافي فقط
    v_credited_usd := round(v_gross * v_diamond_usdt, 8);  -- كل المخرجات بالدولار

    if v_agent_cut > 0 then
      perform public.get_or_create_revenue_account('agent:' || v_agent_id::text, 'agent', v_agent_user_id);
      perform public.credit_revenue('agent:' || v_agent_id::text, 'diamond', v_agent_cut,
        round(v_agent_cut * v_diamond_usdt, 8), 'gift_commission_agent', 'gift', v_gift_transaction_id, v_gift_transaction_id, 'gift-send');
    end if;

    if v_platform_cut > 0 then
      perform public.credit_revenue('platform:main', 'diamond', v_platform_cut,
        round(v_platform_cut * v_diamond_usdt, 8), 'gift_commission_platform', 'gift', v_gift_transaction_id, v_gift_transaction_id, 'gift-send');
    end if;
  else
    v_earn_currency := 'gold';
    v_received := v_gross;
    v_credited_usd := round(v_received * v_gold_usdt, 8);
  end if;

  v_spread_usd := round(v_sender_usd - v_credited_usd, 8);
  if v_spread_usd < 0 then
    raise exception 'Gift accounting does not balance';
  end if;
  if v_spread_usd > 0 then
    perform public.credit_revenue('platform:main', 'usd', v_spread_usd, v_spread_usd,
      'gift_margin', 'gift', v_gift_transaction_id, v_gift_transaction_id, 'gift-send');
  end if;

  v_breakdown := jsonb_build_object(
    'gross_earnings', case when v_is_verified_host then v_gross else v_gross end,
    'platform_commission_percent', coalesce(v_platform_pct, 0),
    'agent_commission_percent', coalesce(v_agent_pct, 0),
    'platform_commission', case when v_is_verified_host then v_platform_cut else 0 end,
    'agent_commission', case when v_is_verified_host then v_agent_cut else 0 end,
    'host_net', case when v_is_verified_host then v_host_net else v_gross end,
    'sender_usd', v_sender_usd,
    'credited_usd', v_credited_usd,
    'margin_usd', v_spread_usd,
    'agent_id', v_agent_id
  );

  v_rates := jsonb_build_object(
    'price_gold', v_gift.price_gold,
    'unit_price_gold', v_unit_price,
    'campaign_id', v_gift.campaign_id,
    'recipient_diamond_ratio', v_gift.recipient_diamond_ratio,
    'recipient_kind', case when v_is_verified_host then 'verified_host' else 'standard_user' end,
    'gold_to_usdt_rate', v_gold_usdt,
    'diamonds_per_usd', v_diamonds_per_usd,
    'commission', v_breakdown
  );

  perform public.record_wallet_transaction(
    p_from_user_id, 'gift_sent'::public.wallet_tx_type, -v_total_coins,
    'gold', null, p_idempotency_key || ':out', 'gift',
    v_gift_transaction_id,
    jsonb_build_object('gift_id', p_gift_id, 'to_user_id', p_to_user_id,
      'quantity', p_quantity, 'funding_currency', 'gold'),
    'gift-send', 'gift_purchase', null, 'system', v_rates, v_gift_transaction_id
  );
  perform public.record_wallet_transaction(
    p_to_user_id, 'gift_received'::public.wallet_tx_type, v_received,
    v_earn_currency, null, p_idempotency_key || ':in', 'gift',
    v_gift_transaction_id,
    jsonb_build_object('gift_id', p_gift_id, 'from_user_id', p_from_user_id,
      'quantity', p_quantity, 'funding_currency', 'gold'),
    'gift-send',
    case when v_is_verified_host then 'gift_earnings_host' else 'gift_earnings_user' end,
    null, 'system', v_rates, v_gift_transaction_id
  );

  insert into public.gift_transactions (
    id, gift_id, from_user_id, to_user_id, room_id, quantity, total_gold,
    received_diamond, message, idempotency_key, funding_currency, received_diamond_currency,
    commission_breakdown
  ) values (
    v_gift_transaction_id, p_gift_id, p_from_user_id, p_to_user_id, p_room_id,
    p_quantity, v_total_coins, v_received, nullif(trim(p_message), ''),
    p_idempotency_key, 'gold', v_earn_currency, v_breakdown
  ) returning * into v_gift_transaction;

  -- خصم المخزون بعد نجاح القيد المحاسبي
  if v_gift.stock_total is not null then
    update public.gifts
    set stock_sold = stock_sold + p_quantity, updated_at = now()
    where id = p_gift_id;
  end if;

  update public.users set total_gifts_sent = total_gifts_sent + v_total_coins where id = p_from_user_id;
  update public.users set total_gifts_received = total_gifts_received + v_received where id = p_to_user_id;
  perform public.award_user_xp(p_to_user_id, 'gift_received:' || v_gift_transaction_id::text, 'gift_received', 5);

  return jsonb_build_object(
    'success', true,
    'gift_transaction', to_jsonb(v_gift_transaction),
    'sent_coins', v_total_coins,
    'received_amount', v_received,
    'received_currency', v_earn_currency,
    'recipient_kind', v_rates ->> 'recipient_kind',
    'commission', v_breakdown,
    'gift_name', coalesce(v_gift.name_ar, v_gift.name),
    'unit_price_gold', v_unit_price,
    'campaign_id', v_gift.campaign_id
  );
end;
$function$;

-- ============================================================
-- 8) الإدارة — صلاحية store.* وسبب إلزامي وتدقيق قبل/بعد
-- ============================================================
CREATE OR REPLACE FUNCTION public.admin_upsert_gift(
  p_admin_id uuid,
  p_gift_id uuid,
  p_payload jsonb,
  p_reason text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_admin public.users%ROWTYPE;
  v_before public.gifts%ROWTYPE;
  v_after public.gifts%ROWTYPE;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_name text := btrim(coalesce(p_payload ->> 'name', ''));
  v_name_ar text := nullif(btrim(coalesce(p_payload ->> 'name_ar', '')), '');
  v_icon_url text := btrim(coalesce(p_payload ->> 'icon_url', ''));
  v_icon_emoji text := coalesce(nullif(btrim(coalesce(p_payload ->> 'icon_emoji', '')), ''), '🎁');
  v_animation text := nullif(btrim(coalesce(p_payload ->> 'animation_url', '')), '');
  v_sound text := nullif(btrim(coalesce(p_payload ->> 'sound_url', '')), '');
  v_effect text := nullif(btrim(coalesce(p_payload ->> 'effect_key', '')), '');
  v_type text := coalesce(nullif(btrim(coalesce(p_payload ->> 'gift_type', '')), ''), 'normal');
  v_rarity text := coalesce(nullif(btrim(coalesce(p_payload ->> 'rarity', '')), ''), 'common');
  v_category text := nullif(btrim(coalesce(p_payload ->> 'category', '')), '');
  v_price bigint := (p_payload ->> 'price_gold')::bigint;
  v_ratio numeric(5,2) := coalesce((p_payload ->> 'recipient_diamond_ratio')::numeric, 50);
  v_premium boolean := coalesce((p_payload ->> 'is_premium')::boolean, false);
  v_sort integer := coalesce((p_payload ->> 'sort_order')::integer, 0);
  v_duration integer := coalesce((p_payload ->> 'display_duration_ms')::integer, 4000);
  v_from timestamptz := nullif(coalesce(p_payload ->> 'available_from', ''), '')::timestamptz;
  v_to timestamptz := nullif(coalesce(p_payload ->> 'available_to', ''), '')::timestamptz;
  v_campaign uuid := nullif(coalesce(p_payload ->> 'campaign_id', ''), '')::uuid;
  v_daily integer := nullif(coalesce(p_payload ->> 'daily_limit_per_user', ''), '')::integer;
  v_stock integer := nullif(coalesce(p_payload ->> 'stock_total', ''), '')::integer;
  v_active boolean := coalesce((p_payload ->> 'is_active')::boolean, true);
  v_archived timestamptz;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    IF auth.uid() IS NULL OR auth.uid() IS DISTINCT FROM p_admin_id
       OR NOT public.admin_staff_can(p_admin_id, 'store.manage') THEN
      RAISE EXCEPTION 'غير مصرح بإدارة متجر الهدايا';
    END IF;
  END IF;
  IF p_admin_id IS NULL OR p_payload IS NULL OR jsonb_typeof(p_payload) <> 'object' THEN
    RAISE EXCEPTION 'بيانات الهدية غير صالحة';
  END IF;
  IF v_reason IS NULL OR char_length(v_reason) > 500 THEN
    RAISE EXCEPTION 'أدخل سبباً لا يتجاوز 500 حرف';
  END IF;

  IF char_length(v_name) NOT BETWEEN 2 AND 50 THEN
    RAISE EXCEPTION 'اسم الهدية يجب أن يكون بين 2 و50 حرفاً';
  END IF;
  IF v_name_ar IS NOT NULL AND char_length(v_name_ar) NOT BETWEEN 2 AND 50 THEN
    RAISE EXCEPTION 'الاسم العربي يجب أن يكون بين 2 و50 حرفاً';
  END IF;
  IF v_icon_url <> '' AND v_icon_url NOT LIKE '/gifts/%' AND v_icon_url !~* '^https://' THEN
    RAISE EXCEPTION 'رابط الأيقونة يجب أن يبدأ بـ/gifts/ أو https://';
  END IF;
  IF v_animation IS NOT NULL AND v_animation NOT LIKE '/gifts/%' AND v_animation !~* '^https://' THEN
    RAISE EXCEPTION 'رابط الحركة غير صالح';
  END IF;
  IF v_sound IS NOT NULL AND v_sound NOT LIKE '/gifts/%' AND v_sound !~* '^https://' THEN
    RAISE EXCEPTION 'رابط الصوت غير صالح';
  END IF;
  IF v_effect IS NOT NULL AND char_length(v_effect) > 60 THEN
    RAISE EXCEPTION 'مفتاح المؤثر يجب ألا يتجاوز 60 حرفاً';
  END IF;
  IF v_type NOT IN ('normal','animated','entry','huge','seasonal','rare','collective','occasion') THEN
    RAISE EXCEPTION 'نوع الهدية غير صالح';
  END IF;
  IF v_rarity NOT IN ('common','uncommon','rare','epic','legendary') THEN
    RAISE EXCEPTION 'درجة الندرة غير صالحة';
  END IF;
  IF v_category IS NOT NULL AND char_length(v_category) > 30 THEN
    RAISE EXCEPTION 'التصنيف يجب ألا يتجاوز 30 حرفاً';
  END IF;
  IF v_price IS NULL OR v_price NOT BETWEEN 1 AND 10000000 THEN
    RAISE EXCEPTION 'سعر الهدية يجب أن يكون بين 1 و10,000,000';
  END IF;
  IF v_ratio NOT BETWEEN 1 AND 100 THEN
    RAISE EXCEPTION 'نسبة المستفيد يجب أن تكون بين 1 و100';
  END IF;
  IF v_sort NOT BETWEEN 0 AND 100000 THEN
    RAISE EXCEPTION 'ترتيب العرض غير صالح';
  END IF;
  IF v_duration NOT BETWEEN 1000 AND 30000 THEN
    RAISE EXCEPTION 'مدة العرض يجب أن تكون بين 1 و30 ثانية';
  END IF;
  IF v_to IS NOT NULL AND v_from IS NOT NULL AND v_to <= v_from THEN
    RAISE EXCEPTION 'نهاية العرض يجب أن تكون بعد بدايته';
  END IF;
  IF v_daily IS NOT NULL AND v_daily NOT BETWEEN 1 AND 1000 THEN
    RAISE EXCEPTION 'الحد اليومي يجب أن يكون بين 1 و1000';
  END IF;
  IF v_stock IS NOT NULL AND v_stock NOT BETWEEN 1 AND 1000000 THEN
    RAISE EXCEPTION 'المخزون يجب أن يكون بين 1 و1,000,000';
  END IF;
  IF v_campaign IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.gift_campaigns c WHERE c.id = v_campaign) THEN
    RAISE EXCEPTION 'الحملة غير موجودة';
  END IF;

  SELECT * INTO v_admin FROM public.users WHERE id = p_admin_id FOR UPDATE;
  IF NOT FOUND OR v_admin.status <> 'active' OR v_admin.role NOT IN ('admin', 'super_admin') THEN
    RAISE EXCEPTION 'الحساب الإداري غير نشط';
  END IF;

  IF p_gift_id IS NULL THEN
    INSERT INTO public.gifts (
      name, name_ar, icon_url, icon_emoji, animation_url, price_gold,
      recipient_diamond_ratio, is_premium, is_active, category, sort_order,
      gift_type, rarity, sound_url, effect_key, display_duration_ms,
      available_from, available_to, campaign_id, daily_limit_per_user,
      stock_total, stock_sold, updated_by, updated_at
    ) VALUES (
      v_name, v_name_ar, v_icon_url, v_icon_emoji, v_animation, v_price,
      v_ratio, v_premium, v_active, coalesce(v_category, 'common'), v_sort,
      v_type::public.gift_type, v_rarity::public.gift_rarity, v_sound, v_effect, v_duration,
      v_from, v_to, v_campaign, v_daily,
      v_stock, 0, p_admin_id, now()
    ) RETURNING * INTO v_after;

    INSERT INTO public.admin_audit_log (
      admin_id, action, target_type, target_id, before, after, reason, metadata
    ) VALUES (
      p_admin_id, 'create'::public.audit_action_type, 'gift', v_after.id,
      NULL, to_jsonb(v_after), v_reason,
      jsonb_build_object('reason', v_reason, 'name', v_after.name)
    );
  ELSE
    SELECT * INTO v_before FROM public.gifts WHERE id = p_gift_id FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'الهدية غير موجودة';
    END IF;
    IF v_stock IS NOT NULL AND v_stock < v_before.stock_sold THEN
      RAISE EXCEPTION 'المخزون لا يمكن أن يقل عن الكمية المباعة';
    END IF;
    v_archived := CASE WHEN v_active THEN NULL ELSE coalesce(v_before.archived_at, now()) END;

    UPDATE public.gifts
    SET name = v_name,
        name_ar = v_name_ar,
        icon_url = v_icon_url,
        icon_emoji = v_icon_emoji,
        animation_url = v_animation,
        price_gold = v_price,
        recipient_diamond_ratio = v_ratio,
        is_premium = v_premium,
        is_active = v_active,
        category = coalesce(v_category, 'common'),
        sort_order = v_sort,
        gift_type = v_type::public.gift_type,
        rarity = v_rarity::public.gift_rarity,
        sound_url = v_sound,
        effect_key = v_effect,
        display_duration_ms = v_duration,
        available_from = v_from,
        available_to = v_to,
        campaign_id = v_campaign,
        daily_limit_per_user = v_daily,
        stock_total = v_stock,
        archived_at = v_archived,
        updated_by = p_admin_id,
        updated_at = now()
    WHERE id = p_gift_id
    RETURNING * INTO v_after;

    INSERT INTO public.admin_audit_log (
      admin_id, action, target_type, target_id, before, after, reason, metadata
    ) VALUES (
      p_admin_id, 'update'::public.audit_action_type, 'gift', v_after.id,
      to_jsonb(v_before), to_jsonb(v_after), v_reason,
      jsonb_build_object('reason', v_reason, 'name', v_after.name,
        'price_before', v_before.price_gold, 'price_after', v_after.price_gold)
    );
  END IF;

  RETURN to_jsonb(v_after);
END;
$$;
REVOKE ALL ON FUNCTION public.admin_upsert_gift(uuid, uuid, jsonb, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_upsert_gift(uuid, uuid, jsonb, text)
  TO authenticated, service_role;

-- إزالة من العرض فقط — الصف والسجلات التاريخية تبقى
CREATE OR REPLACE FUNCTION public.admin_archive_gift(
  p_admin_id uuid,
  p_gift_id uuid,
  p_reason text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_admin public.users%ROWTYPE;
  v_before public.gifts%ROWTYPE;
  v_after public.gifts%ROWTYPE;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    IF auth.uid() IS NULL OR auth.uid() IS DISTINCT FROM p_admin_id
       OR NOT public.admin_staff_can(p_admin_id, 'store.manage') THEN
      RAISE EXCEPTION 'غير مصرح بإدارة متجر الهدايا';
    END IF;
  END IF;
  IF p_gift_id IS NULL OR v_reason IS NULL OR char_length(v_reason) > 500 THEN
    RAISE EXCEPTION 'أدخل سبباً لا يتجاوز 500 حرف';
  END IF;

  SELECT * INTO v_admin FROM public.users WHERE id = p_admin_id FOR UPDATE;
  IF NOT FOUND OR v_admin.status <> 'active' OR v_admin.role NOT IN ('admin', 'super_admin') THEN
    RAISE EXCEPTION 'الحساب الإداري غير نشط';
  END IF;

  SELECT * INTO v_before FROM public.gifts WHERE id = p_gift_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'الهدية غير موجودة';
  END IF;

  UPDATE public.gifts
  SET is_active = false, archived_at = now(), updated_by = p_admin_id, updated_at = now()
  WHERE id = p_gift_id
  RETURNING * INTO v_after;

  INSERT INTO public.admin_audit_log (
    admin_id, action, target_type, target_id, before, after, reason, metadata
  ) VALUES (
    p_admin_id, 'update'::public.audit_action_type, 'gift', p_gift_id,
    to_jsonb(v_before), to_jsonb(v_after), v_reason,
    jsonb_build_object('reason', v_reason, 'archived', true, 'name', v_after.name)
  );

  RETURN jsonb_build_object(
    'archived', true,
    'gift_id', p_gift_id,
    'gift_transactions_kept', (SELECT count(*) FROM public.gift_transactions t WHERE t.gift_id = p_gift_id)
  );
END;
$$;
REVOKE ALL ON FUNCTION public.admin_archive_gift(uuid, uuid, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_archive_gift(uuid, uuid, text)
  TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.admin_upsert_gift_campaign(
  p_admin_id uuid,
  p_campaign_id uuid,
  p_payload jsonb,
  p_reason text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_admin public.users%ROWTYPE;
  v_before public.gift_campaigns%ROWTYPE;
  v_after public.gift_campaigns%ROWTYPE;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_key text := lower(btrim(coalesce(p_payload ->> 'key', '')));
  v_name text := btrim(coalesce(p_payload ->> 'name', ''));
  v_name_ar text := nullif(btrim(coalesce(p_payload ->> 'name_ar', '')), '');
  v_from timestamptz := nullif(coalesce(p_payload ->> 'starts_at', ''), '')::timestamptz;
  v_to timestamptz := nullif(coalesce(p_payload ->> 'ends_at', ''), '')::timestamptz;
  v_discount numeric(5,2) := coalesce((p_payload ->> 'discount_percent')::numeric, 0);
  v_active boolean := coalesce((p_payload ->> 'is_active')::boolean, true);
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    IF auth.uid() IS NULL OR auth.uid() IS DISTINCT FROM p_admin_id
       OR NOT public.admin_staff_can(p_admin_id, 'store.manage') THEN
      RAISE EXCEPTION 'غير مصرح بإدارة متجر الهدايا';
    END IF;
  END IF;
  IF p_admin_id IS NULL OR p_payload IS NULL OR jsonb_typeof(p_payload) <> 'object' THEN
    RAISE EXCEPTION 'بيانات الحملة غير صالحة';
  END IF;
  IF v_reason IS NULL OR char_length(v_reason) > 500 THEN
    RAISE EXCEPTION 'أدخل سبباً لا يتجاوز 500 حرف';
  END IF;
  IF v_key !~ '^[a-z0-9_]{3,60}$' THEN
    RAISE EXCEPTION 'مفتاح الحملة يجب أن يكون أحرفاً إنجليزية صغيرة وأرقاماً و_ بين 3 و60';
  END IF;
  IF char_length(v_name) NOT BETWEEN 2 AND 80 THEN
    RAISE EXCEPTION 'اسم الحملة يجب أن يكون بين 2 و80 حرفاً';
  END IF;
  IF v_name_ar IS NOT NULL AND char_length(v_name_ar) NOT BETWEEN 2 AND 80 THEN
    RAISE EXCEPTION 'الاسم العربي للحملة غير صالح';
  END IF;
  IF v_from IS NULL OR v_to IS NULL OR v_to <= v_from THEN
    RAISE EXCEPTION 'نافذة الحملة غير صالحة (النهاية بعد البداية)';
  END IF;
  IF v_discount NOT BETWEEN 0 AND 90 THEN
    RAISE EXCEPTION 'نسبة الخصم يجب أن تكون بين 0 و90';
  END IF;

  SELECT * INTO v_admin FROM public.users WHERE id = p_admin_id FOR UPDATE;
  IF NOT FOUND OR v_admin.status <> 'active' OR v_admin.role NOT IN ('admin', 'super_admin') THEN
    RAISE EXCEPTION 'الحساب الإداري غير نشط';
  END IF;

  IF p_campaign_id IS NULL THEN
    INSERT INTO public.gift_campaigns (
      key, name, name_ar, starts_at, ends_at, discount_percent, is_active, created_by
    ) VALUES (
      v_key, v_name, v_name_ar, v_from, v_to, v_discount, v_active, p_admin_id
    ) RETURNING * INTO v_after;

    INSERT INTO public.admin_audit_log (
      admin_id, action, target_type, target_id, before, after, reason, metadata
    ) VALUES (
      p_admin_id, 'create'::public.audit_action_type, 'gift_campaign', v_after.id,
      NULL, to_jsonb(v_after), v_reason,
      jsonb_build_object('reason', v_reason, 'key', v_after.key)
    );
  ELSE
    SELECT * INTO v_before FROM public.gift_campaigns WHERE id = p_campaign_id FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'الحملة غير موجودة';
    END IF;
    IF EXISTS (SELECT 1 FROM public.gift_campaigns c WHERE c.key = v_key AND c.id <> p_campaign_id) THEN
      RAISE EXCEPTION 'مفتاح الحملة مستخدم مسبقاً';
    END IF;

    UPDATE public.gift_campaigns
    SET key = v_key,
        name = v_name,
        name_ar = v_name_ar,
        starts_at = v_from,
        ends_at = v_to,
        discount_percent = v_discount,
        is_active = v_active,
        updated_at = now()
    WHERE id = p_campaign_id
    RETURNING * INTO v_after;

    INSERT INTO public.admin_audit_log (
      admin_id, action, target_type, target_id, before, after, reason, metadata
    ) VALUES (
      p_admin_id, 'update'::public.audit_action_type, 'gift_campaign', v_after.id,
      to_jsonb(v_before), to_jsonb(v_after), v_reason,
      jsonb_build_object('reason', v_reason, 'key', v_after.key,
        'discount_before', v_before.discount_percent, 'discount_after', v_after.discount_percent)
    );
  END IF;

  RETURN to_jsonb(v_after);
END;
$$;
REVOKE ALL ON FUNCTION public.admin_upsert_gift_campaign(uuid, uuid, jsonb, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_upsert_gift_campaign(uuid, uuid, jsonb, text)
  TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.admin_list_gifts(p_admin_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    IF auth.uid() IS NULL OR auth.uid() IS DISTINCT FROM p_admin_id
       OR NOT public.admin_staff_can(p_admin_id, 'store.view') THEN
      RAISE EXCEPTION 'غير مصرح بعرض متجر الهدايا';
    END IF;
  END IF;
  RETURN coalesce((
    SELECT jsonb_agg(row_to_json(t)::jsonb ORDER BY t.sort_order, t.price_gold)
    FROM (
      SELECT g.*, c.key AS campaign_key, coalesce(c.name_ar, c.name) AS campaign_name,
             (SELECT count(*) FROM public.gift_transactions gt WHERE gt.gift_id = g.id) AS transactions_count
      FROM public.gifts g
      LEFT JOIN public.gift_campaigns c ON c.id = g.campaign_id
    ) t
  ), '[]'::jsonb);
END;
$$;
REVOKE ALL ON FUNCTION public.admin_list_gifts(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_list_gifts(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.admin_list_gift_campaigns(p_admin_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    IF auth.uid() IS NULL OR auth.uid() IS DISTINCT FROM p_admin_id
       OR NOT public.admin_staff_can(p_admin_id, 'store.view') THEN
      RAISE EXCEPTION 'غير مصرح بعرض حملات الهدايا';
    END IF;
  END IF;
  RETURN coalesce((
    SELECT jsonb_agg(row_to_json(t)::jsonb ORDER BY t.starts_at DESC)
    FROM (
      SELECT c.*,
             (SELECT count(*) FROM public.gifts g WHERE g.campaign_id = c.id) AS gifts_count,
             (c.is_active AND now() BETWEEN c.starts_at AND c.ends_at) AS running
      FROM public.gift_campaigns c
    ) t
  ), '[]'::jsonb);
END;
$$;
REVOKE ALL ON FUNCTION public.admin_list_gift_campaigns(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_list_gift_campaigns(uuid) TO authenticated, service_role;

SELECT set_config('request.jwt.claims', '', true);

COMMIT;
