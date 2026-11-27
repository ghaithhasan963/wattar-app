-- ============================================================
-- patch_m9_conversations.sql  (Migration #80)
-- M9.2 — المحادثات: إصلاح جذري + أصدقاء + ملصقات + هدايا داخل المحادثة
--   * السبب الجذري لعطل «فتح المحادثة»: سياسات RLS على
--     private_conversations/private_messages وسياسات Realtime على
--     realtime.messages ودالة get_private_message_quote كانت تستدعي
--     is_wattar_blocked_between(uuid, uuid) وهي غير موجودة (الموجود
--     نسخة معامل واحد تعتمد auth.uid()). النتيجة: كل قراءة للجداول
--     تفشل بـ42883، وكل فتح محادثة يفشل عند جلب السعر، واشتراك
--     Realtime الخاص يُرفض. الحل: نسخة صريحة من معاملين.
--   * ترقيم صفحات الرسائل (p_before + p_limit) بدل سقف 200 ثابت.
--   * ملصقات (القسم 26): حزم + ملصقات + كتالوج عام + إرسال خادمي
--     بنفس قواعد الحد المجاني ثم المدفوع + إدارة بصلاحية وسبب وتدقيق.
--   * هدايا داخل المحادثة: ربط رسالة بعملية هدية مُسوّاة مسبقاً
--     (المحاسبة تبقى في settle_gift_send وحدها — لا ازدواج).
-- يعتمد على: #12/#27/#79 (gifts)، #38 (privacy)، #69 (RBAC)،
--             patch_paid_messaging / patch_social_foundation.
-- ============================================================
BEGIN;

SELECT set_config('request.jwt.claims', '{"role":"service_role"}', true);

-- ============================================================
-- 1) إصلاح جذري: فحص الحظر بين مستخدمين صريحين
-- ============================================================
CREATE OR REPLACE FUNCTION public.is_wattar_blocked_between(p_user_a uuid, p_user_b uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT CASE
    WHEN p_user_a IS NULL OR p_user_b IS NULL THEN true
    WHEN p_user_a = p_user_b THEN false
    ELSE EXISTS (
      SELECT 1 FROM public.user_blocks b
      WHERE (b.blocker_id = p_user_a AND b.blocked_id = p_user_b)
         OR (b.blocker_id = p_user_b AND b.blocked_id = p_user_a)
    )
  END;
$$;
REVOKE ALL ON FUNCTION public.is_wattar_blocked_between(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_wattar_blocked_between(uuid, uuid) TO authenticated, service_role;

-- ============================================================
-- 2) توسيع الرسائل: نوع الرسالة + هدية + ملصق
-- ============================================================
ALTER TABLE public.private_messages
  ADD COLUMN IF NOT EXISTS message_kind text NOT NULL DEFAULT 'text',
  ADD COLUMN IF NOT EXISTS gift_transaction_id uuid REFERENCES public.gift_transactions(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS sticker_id uuid;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.private_messages'::regclass AND conname = 'private_messages_kind_check'
  ) THEN
    ALTER TABLE public.private_messages ADD CONSTRAINT private_messages_kind_check
      CHECK (message_kind IN ('text', 'sticker', 'gift'));
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.private_messages'::regclass AND conname = 'private_messages_kind_ref_check'
  ) THEN
    ALTER TABLE public.private_messages ADD CONSTRAINT private_messages_kind_ref_check CHECK (
      (message_kind = 'gift' AND gift_transaction_id IS NOT NULL)
      OR (message_kind = 'sticker' AND sticker_id IS NOT NULL)
      OR (message_kind = 'text' AND gift_transaction_id IS NULL AND sticker_id IS NULL)
    );
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS private_messages_gift_unique
  ON public.private_messages (gift_transaction_id)
  WHERE gift_transaction_id IS NOT NULL;

-- ============================================================
-- 3) الملصقات (القسم 26)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.sticker_packs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key text NOT NULL UNIQUE CHECK (key ~ '^[a-z0-9_]{3,60}$'),
  name character varying(80) NOT NULL CHECK (char_length(btrim(name)) BETWEEN 2 AND 80),
  name_ar character varying(80) CHECK (name_ar IS NULL OR char_length(btrim(name_ar)) BETWEEN 2 AND 80),
  icon_emoji character varying(16) NOT NULL DEFAULT '🙂',
  cover_url text,
  sort_order integer NOT NULL DEFAULT 0,
  is_premium boolean NOT NULL DEFAULT false,
  is_active boolean NOT NULL DEFAULT true,
  archived_at timestamptz,
  created_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.stickers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pack_id uuid NOT NULL REFERENCES public.sticker_packs(id) ON DELETE CASCADE,
  code character varying(60) NOT NULL CHECK (code ~ '^[a-z0-9_]{2,60}$'),
  emoji character varying(16),
  image_url text,
  animation_url text,
  sort_order integer NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (pack_id, code),
  CONSTRAINT stickers_asset_check CHECK (emoji IS NOT NULL OR image_url IS NOT NULL OR animation_url IS NOT NULL),
  CONSTRAINT stickers_url_check CHECK (
    (image_url IS NULL OR image_url LIKE '/stickers/%' OR image_url ~* '^https://')
    AND (animation_url IS NULL OR animation_url LIKE '/stickers/%' OR animation_url ~* '^https://')
  )
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.private_messages'::regclass AND conname = 'private_messages_sticker_fk'
  ) THEN
    ALTER TABLE public.private_messages
      ADD CONSTRAINT private_messages_sticker_fk
      FOREIGN KEY (sticker_id) REFERENCES public.stickers(id) ON DELETE SET NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS stickers_pack_order ON public.stickers (pack_id, sort_order);
CREATE INDEX IF NOT EXISTS sticker_packs_order ON public.sticker_packs (is_active, sort_order);

ALTER TABLE public.sticker_packs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stickers ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.sticker_packs FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.stickers FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.sticker_packs TO anon, authenticated, service_role;
GRANT SELECT ON public.stickers TO anon, authenticated, service_role;

DROP POLICY IF EXISTS sticker_packs_public_select ON public.sticker_packs;
CREATE POLICY sticker_packs_public_select ON public.sticker_packs
  FOR SELECT TO anon, authenticated
  USING (is_active AND archived_at IS NULL);

DROP POLICY IF EXISTS sticker_packs_admin_select ON public.sticker_packs;
CREATE POLICY sticker_packs_admin_select ON public.sticker_packs
  FOR SELECT TO authenticated
  USING (public.is_admin());

DROP POLICY IF EXISTS stickers_public_select ON public.stickers;
CREATE POLICY stickers_public_select ON public.stickers
  FOR SELECT TO anon, authenticated
  USING (
    is_active
    AND EXISTS (
      SELECT 1 FROM public.sticker_packs p
      WHERE p.id = stickers.pack_id AND p.is_active AND p.archived_at IS NULL
    )
  );

DROP POLICY IF EXISTS stickers_admin_select ON public.stickers;
CREATE POLICY stickers_admin_select ON public.stickers
  FOR SELECT TO authenticated
  USING (public.is_admin());

-- كتالوج حزم للمستخدم
CREATE OR REPLACE FUNCTION public.get_public_sticker_packs()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT coalesce(jsonb_agg(row_to_json(t)::jsonb ORDER BY t.sort_order, t.name), '[]'::jsonb)
  FROM (
    SELECT p.id, p.key, p.name, p.name_ar, p.icon_emoji, p.cover_url,
           p.is_premium, p.sort_order,
           coalesce((
             SELECT jsonb_agg(jsonb_build_object(
               'id', s.id, 'code', s.code, 'emoji', s.emoji,
               'image_url', s.image_url, 'animation_url', s.animation_url,
               'sort_order', s.sort_order
             ) ORDER BY s.sort_order, s.code)
             FROM public.stickers s
             WHERE s.pack_id = p.id AND s.is_active
           ), '[]'::jsonb) AS stickers
    FROM public.sticker_packs p
    WHERE p.is_active AND p.archived_at IS NULL
  ) t;
$$;
REVOKE ALL ON FUNCTION public.get_public_sticker_packs() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_public_sticker_packs() TO anon, authenticated, service_role;

-- ============================================================
-- 4) ترقيم صفحات الرسائل (بدل سقف 200 ثابت)
-- ============================================================
DROP FUNCTION IF EXISTS public.list_private_messages(uuid);
DROP FUNCTION IF EXISTS public.list_private_messages(uuid, timestamptz, integer);
DROP FUNCTION IF EXISTS public.list_private_messages(uuid, timestamptz, uuid, integer);
CREATE FUNCTION public.list_private_messages(
  p_conversation_id uuid,
  p_before timestamptz DEFAULT NULL,
  p_before_id uuid DEFAULT NULL,
  p_limit integer DEFAULT 30
)
RETURNS TABLE (
  message_id uuid,
  sender_id uuid,
  body text,
  created_at timestamptz,
  read_at timestamptz,
  username text,
  display_name text,
  avatar_url text,
  charged_coins bigint,
  host_commission_diamonds bigint,
  message_kind text,
  gift_transaction_id uuid,
  sticker_id uuid,
  gift_name text,
  gift_emoji text,
  gift_icon_url text,
  sticker_emoji text,
  sticker_image_url text,
  sticker_animation_url text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT m.id, m.sender_id, m.body, m.created_at, m.read_at,
         u.username::text, u.display_name::text, u.avatar_url,
         m.charged_coins, m.host_commission_diamonds,
         m.message_kind, m.gift_transaction_id, m.sticker_id,
         coalesce(g.name_ar, g.name),
         g.icon_emoji,
         g.icon_url,
         s.emoji,
         s.image_url,
         s.animation_url
  FROM public.private_messages m
  JOIN public.private_conversations c ON c.id = m.conversation_id
  JOIN public.users u ON u.id = m.sender_id
  LEFT JOIN public.gift_transactions gt ON gt.id = m.gift_transaction_id
  LEFT JOIN public.gifts g ON g.id = gt.gift_id
  LEFT JOIN public.stickers s ON s.id = m.sticker_id
  WHERE c.id = p_conversation_id
    AND auth.uid() IN (c.user_one_id, c.user_two_id)
    AND (p_before IS NULL OR (m.created_at, m.id) < (
      p_before,
      coalesce(p_before_id, 'ffffffff-ffff-ffff-ffff-ffffffffffff'::uuid)
    ))
    AND NOT public.is_wattar_blocked_between(c.user_one_id, c.user_two_id)
  ORDER BY m.created_at DESC, m.id DESC
  LIMIT least(greatest(coalesce(p_limit, 30), 1), 100);
$$;
REVOKE ALL ON FUNCTION public.list_private_messages(uuid, timestamptz, uuid, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_private_messages(uuid, timestamptz, uuid, integer) TO authenticated, service_role;

-- ============================================================
-- 5) إرسال ملصق — نفس قواعد الحد المجاني ثم المدفوع (خادمياً)
-- ============================================================
CREATE OR REPLACE FUNCTION public.send_sticker_message(
  p_conversation_id uuid,
  p_sticker_id uuid,
  p_idempotency_key text,
  p_confirmed_price_coin bigint
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_sender_id uuid := auth.uid();
  v_message_id uuid := gen_random_uuid();
  v_conversation public.private_conversations%ROWTYPE;
  v_sticker public.stickers%ROWTYPE;
  v_pack public.sticker_packs%ROWTYPE;
  v_other_user_id uuid;
  v_quote jsonb;
  v_charge bigint := 0;
  v_commission bigint := 0;
  v_other_host boolean;
  v_commission_pct integer := 0;
  v_existing public.private_messages%ROWTYPE;
  v_label text;
BEGIN
  IF v_sender_id IS NULL THEN RAISE EXCEPTION 'يجب تسجيل الدخول'; END IF;
  IF length(trim(coalesce(p_idempotency_key, ''))) NOT BETWEEN 10 AND 70 THEN
    RAISE EXCEPTION 'مفتاح إرسال الرسالة غير صالح';
  END IF;
  IF p_confirmed_price_coin IS NULL OR p_confirmed_price_coin < 0 THEN
    RAISE EXCEPTION 'تأكيد سعر الرسالة غير صالح';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext('private-message:' || p_idempotency_key));
  SELECT * INTO v_existing FROM public.private_messages WHERE idempotency_key = p_idempotency_key;
  IF FOUND THEN
    IF v_existing.sender_id <> v_sender_id
       OR v_existing.conversation_id <> p_conversation_id
       OR v_existing.sticker_id IS DISTINCT FROM p_sticker_id THEN
      RAISE EXCEPTION 'مفتاح الإرسال مستخدم لرسالة أخرى';
    END IF;
    RETURN jsonb_build_object(
      'message_id', v_existing.id,
      'charged_coins', v_existing.charged_coins,
      'host_commission_diamonds', v_existing.host_commission_diamonds,
      'already_processed', true
    );
  END IF;

  SELECT * INTO v_sticker FROM public.stickers WHERE id = p_sticker_id AND is_active;
  IF NOT FOUND THEN RAISE EXCEPTION 'الملصق غير متاح'; END IF;
  SELECT * INTO v_pack FROM public.sticker_packs WHERE id = v_sticker.pack_id AND is_active AND archived_at IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'حزمة الملصقات غير متاحة'; END IF;

  SELECT * INTO v_conversation
  FROM public.private_conversations
  WHERE id = p_conversation_id
    AND v_sender_id IN (user_one_id, user_two_id)
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'المحادثة غير متاحة'; END IF;

  v_other_user_id := CASE WHEN v_sender_id = v_conversation.user_one_id
    THEN v_conversation.user_two_id ELSE v_conversation.user_one_id END;

  IF NOT public.is_account_active(v_sender_id) OR NOT public.is_account_active(v_other_user_id) THEN
    RAISE EXCEPTION 'أحد الحسابين غير مؤهل للمراسلة';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.users
    WHERE id = v_sender_id AND adult_confirmed_at IS NOT NULL AND onboarding_completed_at IS NOT NULL
  ) OR NOT EXISTS (
    SELECT 1 FROM public.users
    WHERE id = v_other_user_id AND adult_confirmed_at IS NOT NULL AND onboarding_completed_at IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'أحد الحسابين غير مؤهل للمراسلة';
  END IF;
  IF public.has_active_chat_mute(v_sender_id) THEN
    RAISE EXCEPTION 'تم كتم محادثتك من قبل الإدارة';
  END IF;

  -- قواعد التسعير نفسها (دالة واحدة هي المرجع — لا ازدواج منطق)
  v_quote := public.get_private_message_quote(p_conversation_id);
  v_charge := coalesce((v_quote ->> 'price_coin')::bigint, 0);
  v_other_host := coalesce((v_quote ->> 'recipient_is_host')::boolean, false);
  v_commission_pct := coalesce((v_quote ->> 'host_commission_percent')::integer, 0);

  IF v_charge > p_confirmed_price_coin THEN
    RAISE EXCEPTION 'تغيّر سعر الرسالة أو انتهت الرسائل المجانية. حدّث السعر وأكد الإرسال من جديد.';
  END IF;

  IF v_charge > 0 THEN
    PERFORM public.record_wallet_transaction(
      v_sender_id, 'message_sent'::public.wallet_tx_type, -v_charge,
      'gold', NULL, 'private-message:' || p_idempotency_key || ':coin',
      'private_message', v_message_id,
      jsonb_build_object('conversation_id', p_conversation_id, 'recipient_id', v_other_user_id,
        'kind', 'sticker', 'sticker_id', p_sticker_id),
      'private-message-send'
    );
  END IF;
  IF v_charge > 0 AND v_other_host AND v_commission_pct > 0 THEN
    v_commission := floor(v_charge * v_commission_pct / 100.0)::bigint;
    PERFORM public.record_wallet_transaction(
      v_other_user_id, 'message_commission'::public.wallet_tx_type, v_commission,
      'diamond', NULL, 'private-message:' || p_idempotency_key || ':host',
      'private_message', v_message_id,
      jsonb_build_object('conversation_id', p_conversation_id, 'sender_id', v_sender_id,
        'charged_coins', v_charge, 'commission_percent', v_commission_pct),
      'private-message-send'
    );
    INSERT INTO public.user_notifications (
      user_id, actor_id, event_type, reference_id, title, body, route
    ) VALUES (
      v_other_user_id, v_sender_id, 'host_earning', v_message_id,
      'عمولة رسالة جديدة',
      format('أُضيفت %s Diamond إلى رصيدك من رسالة مدفوعة.', v_commission),
      '/(tabs)/wallet'
    )
    ON CONFLICT (user_id, event_type, reference_id) DO NOTHING;
  END IF;

  v_label := coalesce(nullif(v_sticker.emoji, ''), v_sticker.code);
  INSERT INTO public.private_messages (
    id, conversation_id, sender_id, body, charged_coins,
    host_commission_diamonds, sender_is_host_at_send, idempotency_key,
    message_kind, sticker_id
  ) VALUES (
    v_message_id, p_conversation_id, v_sender_id, v_label,
    v_charge, v_commission,
    coalesce((v_quote ->> 'sender_is_host')::boolean, false),
    p_idempotency_key, 'sticker', p_sticker_id
  );
  UPDATE public.private_conversations SET updated_at = now() WHERE id = p_conversation_id;

  RETURN jsonb_build_object(
    'message_id', v_message_id,
    'charged_coins', v_charge,
    'host_commission_diamonds', v_commission,
    'free_remaining', v_quote -> 'free_remaining',
    'already_processed', false
  );
END;
$$;
REVOKE ALL ON FUNCTION public.send_sticker_message(uuid, uuid, text, bigint) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.send_sticker_message(uuid, uuid, text, bigint) TO authenticated, service_role;

-- ============================================================
-- 6) هدايا داخل المحادثة — ربط بعملية هدية مُسوّاة مسبقاً
--    (لا حركة مالية هنا: settle_gift_send هي المسؤول الوحيد)
-- ============================================================
CREATE OR REPLACE FUNCTION public.attach_gift_message(
  p_conversation_id uuid,
  p_gift_transaction_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_sender_id uuid := auth.uid();
  v_conversation public.private_conversations%ROWTYPE;
  v_tx public.gift_transactions%ROWTYPE;
  v_gift_name text;
  v_existing public.private_messages%ROWTYPE;
  v_message_id uuid;
BEGIN
  IF v_sender_id IS NULL THEN RAISE EXCEPTION 'يجب تسجيل الدخول'; END IF;
  IF p_conversation_id IS NULL OR p_gift_transaction_id IS NULL THEN
    RAISE EXCEPTION 'بيانات الهدية غير صالحة';
  END IF;

  SELECT * INTO v_conversation
  FROM public.private_conversations
  WHERE id = p_conversation_id AND v_sender_id IN (user_one_id, user_two_id);
  IF NOT FOUND THEN RAISE EXCEPTION 'المحادثة غير متاحة'; END IF;
  IF public.is_wattar_blocked_between(v_conversation.user_one_id, v_conversation.user_two_id) THEN
    RAISE EXCEPTION 'المحادثة غير متاحة';
  END IF;

  SELECT * INTO v_tx FROM public.gift_transactions WHERE id = p_gift_transaction_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'عملية الهدية غير موجودة'; END IF;
  IF v_tx.from_user_id <> v_sender_id THEN
    RAISE EXCEPTION 'لا يمكنك إرفاق هدية أرسلها غيرك';
  END IF;
  IF v_tx.to_user_id NOT IN (v_conversation.user_one_id, v_conversation.user_two_id)
     OR v_tx.to_user_id = v_sender_id THEN
    RAISE EXCEPTION 'الهدية ليست موجهة لطرف هذه المحادثة';
  END IF;

  SELECT * INTO v_existing FROM public.private_messages
  WHERE gift_transaction_id = p_gift_transaction_id;
  IF FOUND THEN
    RETURN jsonb_build_object('message_id', v_existing.id, 'already_processed', true);
  END IF;

  SELECT coalesce(g.name_ar, g.name) INTO v_gift_name FROM public.gifts g WHERE g.id = v_tx.gift_id;

  INSERT INTO public.private_messages (
    conversation_id, sender_id, body, charged_coins, host_commission_diamonds,
    sender_is_host_at_send, message_kind, gift_transaction_id
  ) VALUES (
    p_conversation_id, v_sender_id, coalesce(v_gift_name, 'هدية'),
    0, 0, false, 'gift', p_gift_transaction_id
  ) RETURNING id INTO v_message_id;

  UPDATE public.private_conversations SET updated_at = now() WHERE id = p_conversation_id;

  RETURN jsonb_build_object('message_id', v_message_id, 'already_processed', false);
END;
$$;
REVOKE ALL ON FUNCTION public.attach_gift_message(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.attach_gift_message(uuid, uuid) TO authenticated, service_role;

-- ============================================================
-- 7) صلاحيات الملصقات + إدارة بلا حذف سجلات
-- ============================================================
INSERT INTO public.admin_permission_catalog (permission, category, description)
VALUES
  ('stickers.view', 'المحادثات والملصقات', 'عرض حزم الملصقات'),
  ('stickers.manage', 'المحادثات والملصقات', 'إدارة حزم الملصقات')
ON CONFLICT (permission) DO UPDATE
  SET category = EXCLUDED.category, description = EXCLUDED.description;

INSERT INTO public.admin_role_permissions (staff_role, permission, allowed)
VALUES
  ('super_admin', 'stickers.view', true),
  ('super_admin', 'stickers.manage', true),
  ('operations', 'stickers.view', true),
  ('operations', 'stickers.manage', true),
  ('moderator', 'stickers.view', true),
  ('support', 'stickers.view', true)
ON CONFLICT (staff_role, permission) DO UPDATE SET allowed = EXCLUDED.allowed;

CREATE OR REPLACE FUNCTION public.admin_upsert_sticker_pack(
  p_admin_id uuid,
  p_pack_id uuid,
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
  v_before public.sticker_packs%ROWTYPE;
  v_after public.sticker_packs%ROWTYPE;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_key text := lower(btrim(coalesce(p_payload ->> 'key', '')));
  v_name text := btrim(coalesce(p_payload ->> 'name', ''));
  v_name_ar text := nullif(btrim(coalesce(p_payload ->> 'name_ar', '')), '');
  v_emoji text := coalesce(nullif(btrim(coalesce(p_payload ->> 'icon_emoji', '')), ''), '🙂');
  v_cover text := nullif(btrim(coalesce(p_payload ->> 'cover_url', '')), '');
  v_sort integer := coalesce((p_payload ->> 'sort_order')::integer, 0);
  v_premium boolean := coalesce((p_payload ->> 'is_premium')::boolean, false);
  v_active boolean := coalesce((p_payload ->> 'is_active')::boolean, true);
  v_archived timestamptz;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    IF auth.uid() IS NULL OR auth.uid() IS DISTINCT FROM p_admin_id
       OR NOT public.admin_staff_can(p_admin_id, 'stickers.manage') THEN
      RAISE EXCEPTION 'غير مصرح بإدارة الملصقات';
    END IF;
  END IF;
  IF p_admin_id IS NULL OR p_payload IS NULL OR jsonb_typeof(p_payload) <> 'object' THEN
    RAISE EXCEPTION 'بيانات الحزمة غير صالحة';
  END IF;
  IF v_reason IS NULL OR char_length(v_reason) > 500 THEN
    RAISE EXCEPTION 'أدخل سبباً لا يتجاوز 500 حرف';
  END IF;
  IF v_key !~ '^[a-z0-9_]{3,60}$' THEN
    RAISE EXCEPTION 'مفتاح الحزمة يجب أن يكون أحرفاً إنجليزية صغيرة وأرقاماً و_ بين 3 و60';
  END IF;
  IF char_length(v_name) NOT BETWEEN 2 AND 80 THEN
    RAISE EXCEPTION 'اسم الحزمة يجب أن يكون بين 2 و80 حرفاً';
  END IF;
  IF v_cover IS NOT NULL AND v_cover NOT LIKE '/stickers/%' AND v_cover !~* '^https://' THEN
    RAISE EXCEPTION 'رابط الغلاف غير صالح';
  END IF;

  SELECT * INTO v_admin FROM public.users WHERE id = p_admin_id FOR UPDATE;
  IF NOT FOUND OR v_admin.status <> 'active' OR v_admin.role NOT IN ('admin', 'super_admin') THEN
    RAISE EXCEPTION 'الحساب الإداري غير نشط';
  END IF;

  IF p_pack_id IS NULL THEN
    INSERT INTO public.sticker_packs (
      key, name, name_ar, icon_emoji, cover_url, sort_order, is_premium, is_active, created_by
    ) VALUES (
      v_key, v_name, v_name_ar, v_emoji, v_cover, v_sort, v_premium, v_active, p_admin_id
    ) RETURNING * INTO v_after;

    INSERT INTO public.admin_audit_log (
      admin_id, action, target_type, target_id, before, after, reason, metadata
    ) VALUES (
      p_admin_id, 'create'::public.audit_action_type, 'sticker_pack', v_after.id,
      NULL, to_jsonb(v_after), v_reason,
      jsonb_build_object('reason', v_reason, 'key', v_after.key)
    );
  ELSE
    SELECT * INTO v_before FROM public.sticker_packs WHERE id = p_pack_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'الحزمة غير موجودة'; END IF;
    IF EXISTS (SELECT 1 FROM public.sticker_packs p WHERE p.key = v_key AND p.id <> p_pack_id) THEN
      RAISE EXCEPTION 'مفتاح الحزمة مستخدم مسبقاً';
    END IF;
    v_archived := CASE WHEN v_active THEN NULL ELSE coalesce(v_before.archived_at, now()) END;

    UPDATE public.sticker_packs
    SET key = v_key,
        name = v_name,
        name_ar = v_name_ar,
        icon_emoji = v_emoji,
        cover_url = v_cover,
        sort_order = v_sort,
        is_premium = v_premium,
        is_active = v_active,
        archived_at = v_archived,
        updated_at = now()
    WHERE id = p_pack_id
    RETURNING * INTO v_after;

    INSERT INTO public.admin_audit_log (
      admin_id, action, target_type, target_id, before, after, reason, metadata
    ) VALUES (
      p_admin_id, 'update'::public.audit_action_type, 'sticker_pack', v_after.id,
      to_jsonb(v_before), to_jsonb(v_after), v_reason,
      jsonb_build_object('reason', v_reason, 'key', v_after.key)
    );
  END IF;

  RETURN to_jsonb(v_after);
END;
$$;
REVOKE ALL ON FUNCTION public.admin_upsert_sticker_pack(uuid, uuid, jsonb, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_upsert_sticker_pack(uuid, uuid, jsonb, text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.admin_upsert_sticker(
  p_admin_id uuid,
  p_sticker_id uuid,
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
  v_before public.stickers%ROWTYPE;
  v_after public.stickers%ROWTYPE;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_pack uuid := nullif(coalesce(p_payload ->> 'pack_id', ''), '')::uuid;
  v_code text := lower(btrim(coalesce(p_payload ->> 'code', '')));
  v_emoji text := nullif(btrim(coalesce(p_payload ->> 'emoji', '')), '');
  v_image text := nullif(btrim(coalesce(p_payload ->> 'image_url', '')), '');
  v_anim text := nullif(btrim(coalesce(p_payload ->> 'animation_url', '')), '');
  v_sort integer := coalesce((p_payload ->> 'sort_order')::integer, 0);
  v_active boolean := coalesce((p_payload ->> 'is_active')::boolean, true);
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    IF auth.uid() IS NULL OR auth.uid() IS DISTINCT FROM p_admin_id
       OR NOT public.admin_staff_can(p_admin_id, 'stickers.manage') THEN
      RAISE EXCEPTION 'غير مصرح بإدارة الملصقات';
    END IF;
  END IF;
  IF p_admin_id IS NULL OR p_payload IS NULL OR jsonb_typeof(p_payload) <> 'object' THEN
    RAISE EXCEPTION 'بيانات الملصق غير صالحة';
  END IF;
  IF v_reason IS NULL OR char_length(v_reason) > 500 THEN
    RAISE EXCEPTION 'أدخل سبباً لا يتجاوز 500 حرف';
  END IF;
  IF v_pack IS NULL OR NOT EXISTS (SELECT 1 FROM public.sticker_packs p WHERE p.id = v_pack) THEN
    RAISE EXCEPTION 'الحزمة غير موجودة';
  END IF;
  IF v_code !~ '^[a-z0-9_]{2,60}$' THEN
    RAISE EXCEPTION 'رمز الملصق يجب أن يكون أحرفاً إنجليزية صغيرة وأرقاماً و_ بين 2 و60';
  END IF;
  IF v_emoji IS NULL AND v_image IS NULL AND v_anim IS NULL THEN
    RAISE EXCEPTION 'أدخل رمزاً أو صورة أو حركة للملصق';
  END IF;
  IF v_image IS NOT NULL AND v_image NOT LIKE '/stickers/%' AND v_image !~* '^https://' THEN
    RAISE EXCEPTION 'رابط الصورة غير صالح';
  END IF;
  IF v_anim IS NOT NULL AND v_anim NOT LIKE '/stickers/%' AND v_anim !~* '^https://' THEN
    RAISE EXCEPTION 'رابط الحركة غير صالح';
  END IF;

  SELECT * INTO v_admin FROM public.users WHERE id = p_admin_id FOR UPDATE;
  IF NOT FOUND OR v_admin.status <> 'active' OR v_admin.role NOT IN ('admin', 'super_admin') THEN
    RAISE EXCEPTION 'الحساب الإداري غير نشط';
  END IF;

  IF p_sticker_id IS NULL THEN
    INSERT INTO public.stickers (pack_id, code, emoji, image_url, animation_url, sort_order, is_active)
    VALUES (v_pack, v_code, v_emoji, v_image, v_anim, v_sort, v_active)
    RETURNING * INTO v_after;

    INSERT INTO public.admin_audit_log (
      admin_id, action, target_type, target_id, before, after, reason, metadata
    ) VALUES (
      p_admin_id, 'create'::public.audit_action_type, 'sticker', v_after.id,
      NULL, to_jsonb(v_after), v_reason,
      jsonb_build_object('reason', v_reason, 'code', v_after.code)
    );
  ELSE
    SELECT * INTO v_before FROM public.stickers WHERE id = p_sticker_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'الملصق غير موجود'; END IF;
    IF EXISTS (
      SELECT 1 FROM public.stickers s
      WHERE s.pack_id = v_pack AND s.code = v_code AND s.id <> p_sticker_id
    ) THEN
      RAISE EXCEPTION 'رمز الملصق مستخدم في هذه الحزمة';
    END IF;

    UPDATE public.stickers
    SET pack_id = v_pack,
        code = v_code,
        emoji = v_emoji,
        image_url = v_image,
        animation_url = v_anim,
        sort_order = v_sort,
        is_active = v_active,
        updated_at = now()
    WHERE id = p_sticker_id
    RETURNING * INTO v_after;

    INSERT INTO public.admin_audit_log (
      admin_id, action, target_type, target_id, before, after, reason, metadata
    ) VALUES (
      p_admin_id, 'update'::public.audit_action_type, 'sticker', v_after.id,
      to_jsonb(v_before), to_jsonb(v_after), v_reason,
      jsonb_build_object('reason', v_reason, 'code', v_after.code)
    );
  END IF;

  RETURN to_jsonb(v_after);
END;
$$;
REVOKE ALL ON FUNCTION public.admin_upsert_sticker(uuid, uuid, jsonb, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_upsert_sticker(uuid, uuid, jsonb, text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.admin_list_sticker_packs(p_admin_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    IF auth.uid() IS NULL OR auth.uid() IS DISTINCT FROM p_admin_id
       OR NOT public.admin_staff_can(p_admin_id, 'stickers.view') THEN
      RAISE EXCEPTION 'غير مصرح بعرض الملصقات';
    END IF;
  END IF;
  RETURN coalesce((
    SELECT jsonb_agg(row_to_json(t)::jsonb ORDER BY t.sort_order, t.name)
    FROM (
      SELECT p.*,
             (SELECT count(*) FROM public.stickers s WHERE s.pack_id = p.id) AS stickers_count,
             (SELECT count(*) FROM public.stickers s WHERE s.pack_id = p.id AND s.is_active) AS active_stickers,
             coalesce((
               SELECT jsonb_agg(row_to_json(s)::jsonb ORDER BY s.sort_order, s.code)
               FROM public.stickers s WHERE s.pack_id = p.id
             ), '[]'::jsonb) AS stickers
      FROM public.sticker_packs p
    ) t
  ), '[]'::jsonb);
END;
$$;
REVOKE ALL ON FUNCTION public.admin_list_sticker_packs(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_list_sticker_packs(uuid) TO authenticated, service_role;

-- ============================================================
-- 8) بذر حزم ملصقات حقيقية (قابلة للتعديل من اللوحة، بلا تكرار)
-- ============================================================
INSERT INTO public.sticker_packs (key, name, name_ar, icon_emoji, sort_order)
VALUES
  ('reactions', 'Reactions', 'تعبيرات', '😀', 10),
  ('love', 'Love', 'حب', '💖', 20)
ON CONFLICT (key) DO NOTHING;

INSERT INTO public.stickers (pack_id, code, emoji, sort_order)
SELECT p.id, v.code, v.emoji, v.sort_order
FROM public.sticker_packs p
JOIN (VALUES
  ('reactions', 'smile', '😀', 1),
  ('reactions', 'laugh', '😂', 2),
  ('reactions', 'wow', '😮', 3),
  ('reactions', 'cry', '😭', 4),
  ('reactions', 'clap', '👏', 5),
  ('reactions', 'fire', '🔥', 6),
  ('reactions', 'cool', '😎', 7),
  ('reactions', 'party', '🥳', 8),
  ('love', 'heart', '❤️', 1),
  ('love', 'kiss', '😘', 2),
  ('love', 'rose', '🌹', 3),
  ('love', 'sparkle', '✨', 4),
  ('love', 'hug', '🤗', 5),
  ('love', 'diamond', '💎', 6),
  ('love', 'gift', '🎁', 7),
  ('love', 'crown', '👑', 8)
) AS v(pack_key, code, emoji, sort_order) ON v.pack_key = p.key
WHERE NOT EXISTS (
  SELECT 1 FROM public.stickers s WHERE s.pack_id = p.id AND s.code = v.code
);

SELECT set_config('request.jwt.claims', '', true);

COMMIT;
