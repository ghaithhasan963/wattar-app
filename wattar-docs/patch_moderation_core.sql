-- ============================================================================
-- هجرة #50 — نظام الإشراف الأساسي (M2.5 / القسم 22 من المطلوب)
-- التاريخ: 2026-11-16
--
-- تغطي:
--   1) جدول `moderation_settings` — عتبات التصعيد ومدد العقوبات (تحكم الإدارة).
--   2) جدول `moderation_words` — قوائم الكلمات الممنوعة/المسموحة (عامة أو خاصة بغرفة).
--   3) جدول `user_violations` — سجل المخالفات (إضافي فقط، لا يُحذف).
--   4) جدول `user_penalties` — العقوبات (تحذير/كتم/طرد/حظر مؤقت/حظر دائم) مع الإلغاء.
--   5) جدول `moderation_exceptions` — استثناءات (تجاوز الفلترة لمستخدم أو غرفة).
--   6) جدول `moderation_appeals` — الاعتراضات على العقوبات ومراجعتها.
--   7) توسيع `user_reports` — حالة البلاغ ومراجعته وربطه بمخالفة.
--   8) دوال الفلترة: `normalize_arabic_text`, `moderation_compact_text`,
--      `check_word_filter` (مع تحصين ضد التلاعب بالحروف/التشكيل/التكرار/الرموز).
--   9) دوال التنفيذ: `is_account_active` (استعادة تلقائية للحظر المنتهي),
--      `has_active_chat_mute`, `record_word_violation` (تصعيد تلقائي).
--  10) دوال الإدارة: `apply_moderation_penalty`, `revoke_moderation_penalty`,
--      `admin_review_user_report`, `admin_review_appeal`, CRUD الكلمات والإعدادات
--      والاستثناءات — كلها service_role فقط.
--  11) دوال المستخدم: `submit_moderation_appeal`, `get_my_moderation_status`.
--  12) ربط الفلترة في `send_room_message` و `send_private_message`.
--
-- الأمان (قاعدة P8 من R29): كل دالة خدمية تنتهي بـ REVOKE من PUBLIC/anon/authenticated.
-- القراءة للوحة الإدارة عبر سياسة is_admin() مع GRANT SELECT فقط (بدون كتابة مباشرة).
-- قواعد حسب الدولة: مؤجلة (R28) — البنية جاهزة عبر scope مستقبلاً.
-- ============================================================================

-- ============================================================================
-- 1) moderation_settings — صف واحد (id=true)
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.moderation_settings (
  id boolean PRIMARY KEY DEFAULT true CHECK (id),
  filter_enabled boolean NOT NULL DEFAULT true,
  warnings_before_mute integer NOT NULL DEFAULT 3 CHECK (warnings_before_mute BETWEEN 1 AND 50),
  mute_default_minutes integer NOT NULL DEFAULT 60 CHECK (mute_default_minutes BETWEEN 1 AND 43200),
  violations_before_temp_ban integer NOT NULL DEFAULT 6 CHECK (violations_before_temp_ban BETWEEN 2 AND 100),
  temp_ban_default_hours integer NOT NULL DEFAULT 24 CHECK (temp_ban_default_hours BETWEEN 1 AND 720),
  violations_before_permanent_ban integer NOT NULL DEFAULT 12 CHECK (violations_before_permanent_ban BETWEEN 3 AND 200),
  violation_counting_window_days integer NOT NULL DEFAULT 90 CHECK (violation_counting_window_days BETWEEN 1 AND 365),
  updated_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO public.moderation_settings (id) VALUES (true) ON CONFLICT (id) DO NOTHING;

ALTER TABLE public.moderation_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.moderation_settings FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS moderation_settings_admin_read ON public.moderation_settings;
CREATE POLICY moderation_settings_admin_read ON public.moderation_settings
  FOR SELECT TO authenticated
  USING (public.is_admin());

REVOKE ALL ON public.moderation_settings FROM anon, authenticated;
GRANT SELECT ON public.moderation_settings TO authenticated;
GRANT ALL ON public.moderation_settings TO service_role;

-- ============================================================================
-- 2) moderation_words — الكلمات الممنوعة والمسموحة (عامة أو خاصة بغرفة)
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.moderation_words (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  list_type text NOT NULL CHECK (list_type IN ('forbidden', 'allowed')),
  word text NOT NULL CHECK (length(btrim(word)) BETWEEN 1 AND 120),
  severity text NOT NULL DEFAULT 'medium' CHECK (severity IN ('low', 'medium', 'high')),
  room_id uuid REFERENCES public.rooms(id) ON DELETE CASCADE,
  is_active boolean NOT NULL DEFAULT true,
  created_by uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  scope_key uuid GENERATED ALWAYS AS
    (coalesce(room_id, '00000000-0000-0000-0000-000000000000'::uuid)) STORED
);

CREATE UNIQUE INDEX IF NOT EXISTS moderation_words_unique_idx
  ON public.moderation_words (list_type, word, scope_key);

CREATE INDEX IF NOT EXISTS moderation_words_lookup_idx
  ON public.moderation_words (list_type, is_active, room_id);

ALTER TABLE public.moderation_words ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.moderation_words FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS moderation_words_admin_read ON public.moderation_words;
CREATE POLICY moderation_words_admin_read ON public.moderation_words
  FOR SELECT TO authenticated
  USING (public.is_admin());

REVOKE ALL ON public.moderation_words FROM anon, authenticated;
GRANT SELECT ON public.moderation_words TO authenticated;
GRANT ALL ON public.moderation_words TO service_role;

-- ============================================================================
-- 3) user_violations — سجل المخالفات (إضافي فقط)
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.user_violations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  violation_type text NOT NULL CHECK (violation_type IN ('word_filter', 'manual_admin', 'report_review', 'harassment', 'spam', 'other')),
  source text NOT NULL DEFAULT 'auto' CHECK (source IN ('auto', 'admin')),
  severity text NOT NULL DEFAULT 'medium' CHECK (severity IN ('low', 'medium', 'high')),
  reason text NOT NULL CHECK (length(btrim(reason)) BETWEEN 1 AND 500),
  matched_word text,
  context_room_id uuid REFERENCES public.rooms(id) ON DELETE SET NULL,
  context_message text,
  created_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS user_violations_user_created_idx
  ON public.user_violations (user_id, created_at DESC);

ALTER TABLE public.user_violations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_violations FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS user_violations_admin_read ON public.user_violations;
CREATE POLICY user_violations_admin_read ON public.user_violations
  FOR SELECT TO authenticated
  USING (public.is_admin());

REVOKE ALL ON public.user_violations FROM anon, authenticated;
GRANT SELECT ON public.user_violations TO authenticated;
GRANT ALL ON public.user_violations TO service_role;

-- ============================================================================
-- 4) user_penalties — العقوبات
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.user_penalties (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  penalty_type text NOT NULL CHECK (penalty_type IN ('warning', 'mute', 'kick', 'temp_ban', 'permanent_ban')),
  reason text NOT NULL CHECK (length(btrim(reason)) BETWEEN 1 AND 500),
  violation_id uuid REFERENCES public.user_violations(id) ON DELETE SET NULL,
  room_id uuid REFERENCES public.rooms(id) ON DELETE SET NULL,
  starts_at timestamptz NOT NULL DEFAULT now(),
  ends_at timestamptz,
  revoked_at timestamptz,
  revoked_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  revoke_reason text,
  created_by uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT user_penalties_window_check CHECK (
    (penalty_type IN ('mute', 'temp_ban') AND ends_at IS NOT NULL AND ends_at > starts_at)
    OR (penalty_type IN ('warning', 'kick', 'permanent_ban') AND ends_at IS NULL)
  )
);

CREATE INDEX IF NOT EXISTS user_penalties_user_type_idx
  ON public.user_penalties (user_id, penalty_type, starts_at DESC);

CREATE INDEX IF NOT EXISTS user_penalties_active_mute_idx
  ON public.user_penalties (user_id, ends_at)
  WHERE penalty_type = 'mute' AND revoked_at IS NULL;

CREATE INDEX IF NOT EXISTS user_penalties_active_ban_idx
  ON public.user_penalties (user_id)
  WHERE penalty_type IN ('temp_ban', 'permanent_ban') AND revoked_at IS NULL;

ALTER TABLE public.user_penalties ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_penalties FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS user_penalties_admin_read ON public.user_penalties;
CREATE POLICY user_penalties_admin_read ON public.user_penalties
  FOR SELECT TO authenticated
  USING (public.is_admin());

-- يرى المستخدم عقوباته الخاصة (صفحة المخالفات والاعتراضات في التطبيق)
DROP POLICY IF EXISTS user_penalties_self_read ON public.user_penalties;
CREATE POLICY user_penalties_self_read ON public.user_penalties
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());

REVOKE ALL ON public.user_penalties FROM anon, authenticated;
GRANT SELECT ON public.user_penalties TO authenticated;
GRANT ALL ON public.user_penalties TO service_role;

-- ============================================================================
-- 5) moderation_exceptions — الاستثناءات
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.moderation_exceptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  subject_user_id uuid REFERENCES public.users(id) ON DELETE CASCADE,
  subject_room_id uuid REFERENCES public.rooms(id) ON DELETE CASCADE,
  exception_type text NOT NULL DEFAULT 'bypass_word_filter' CHECK (exception_type IN ('bypass_word_filter')),
  reason text NOT NULL CHECK (length(btrim(reason)) BETWEEN 1 AND 500),
  revoked_at timestamptz,
  revoked_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_by uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT moderation_exceptions_subject_check CHECK (
    (subject_user_id IS NULL) <> (subject_room_id IS NULL)
  )
);

CREATE INDEX IF NOT EXISTS moderation_exceptions_user_idx
  ON public.moderation_exceptions (subject_user_id)
  WHERE revoked_at IS NULL;

CREATE INDEX IF NOT EXISTS moderation_exceptions_room_idx
  ON public.moderation_exceptions (subject_room_id)
  WHERE revoked_at IS NULL;

ALTER TABLE public.moderation_exceptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.moderation_exceptions FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS moderation_exceptions_admin_read ON public.moderation_exceptions;
CREATE POLICY moderation_exceptions_admin_read ON public.moderation_exceptions
  FOR SELECT TO authenticated
  USING (public.is_admin());

REVOKE ALL ON public.moderation_exceptions FROM anon, authenticated;
GRANT SELECT ON public.moderation_exceptions TO authenticated;
GRANT ALL ON public.moderation_exceptions TO service_role;

-- ============================================================================
-- 6) moderation_appeals — الاعتراضات
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.moderation_appeals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  penalty_id uuid REFERENCES public.user_penalties(id) ON DELETE SET NULL,
  statement text NOT NULL CHECK (length(btrim(statement)) BETWEEN 10 AND 1000),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  reviewed_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  review_note text,
  decided_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- اعتراض واحد قيد المراجعة لكل عقوبة
CREATE UNIQUE INDEX IF NOT EXISTS moderation_appeals_one_pending_idx
  ON public.moderation_appeals (penalty_id)
  WHERE status = 'pending' AND penalty_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS moderation_appeals_status_idx
  ON public.moderation_appeals (status, created_at DESC);

ALTER TABLE public.moderation_appeals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.moderation_appeals FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS moderation_appeals_admin_read ON public.moderation_appeals;
CREATE POLICY moderation_appeals_admin_read ON public.moderation_appeals
  FOR SELECT TO authenticated
  USING (public.is_admin());

-- يرى المستخدم اعتراضاته الخاصة فقط
DROP POLICY IF EXISTS moderation_appeals_self_read ON public.moderation_appeals;
CREATE POLICY moderation_appeals_self_read ON public.moderation_appeals
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());

REVOKE ALL ON public.moderation_appeals FROM anon, authenticated;
GRANT SELECT ON public.moderation_appeals TO authenticated;
GRANT ALL ON public.moderation_appeals TO service_role;

-- ============================================================================
-- 7) توسيع user_reports — حالة المراجعة
-- ============================================================================
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'user_reports' AND column_name = 'status'
  ) THEN
    ALTER TABLE public.user_reports
      ADD COLUMN status text NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'actioned', 'dismissed'));
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'user_reports' AND column_name = 'reviewed_by'
  ) THEN
    ALTER TABLE public.user_reports ADD COLUMN reviewed_by uuid;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'user_reports' AND column_name = 'reviewed_at'
  ) THEN
    ALTER TABLE public.user_reports ADD COLUMN reviewed_at timestamptz;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'user_reports' AND column_name = 'decision_note'
  ) THEN
    ALTER TABLE public.user_reports ADD COLUMN decision_note text;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'user_reports' AND column_name = 'linked_violation_id'
  ) THEN
    ALTER TABLE public.user_reports
      ADD COLUMN linked_violation_id uuid REFERENCES public.user_violations(id) ON DELETE SET NULL;
  END IF;
END
$$;

CREATE INDEX IF NOT EXISTS user_reports_status_idx
  ON public.user_reports (status, created_at DESC);

-- أنواع إشعارات الإشراف الجديدة (moderation_penalty / moderation_appeal)
DO $$
DECLARE
  v_def text;
BEGIN
  SELECT pg_get_constraintdef(oid) INTO v_def
  FROM pg_constraint
  WHERE conrelid = 'public.user_notifications'::regclass
    AND conname = 'user_notifications_event_type_check';
  IF v_def IS NOT NULL AND v_def NOT LIKE '%moderation_penalty%' THEN
    EXECUTE 'ALTER TABLE public.user_notifications DROP CONSTRAINT user_notifications_event_type_check';
    EXECUTE $constraint$ALTER TABLE public.user_notifications
      ADD CONSTRAINT user_notifications_event_type_check CHECK (
        event_type = ANY (ARRAY[
          'friend_request', 'friend_accepted', 'private_message', 'room_invitation',
          'new_follower', 'gift_received', 'deposit_update', 'withdrawal_update',
          'host_update', 'membership_update', 'host_earning', 'support_reply',
          'moderation_penalty', 'moderation_appeal'
        ]::text[])
      )$constraint$;
  END IF;
END
$$;

-- ============================================================================
-- 8) دوال الفلترة
-- ============================================================================

-- تطبيع النص العربي/اللاتيني: توحيد الألف والياء والتاء المربوطة والهمزات،
-- حذف التشكيل والتطويل والمحارف غير المرئية، فك التشويه الرقمي (leetspeak)،
-- وضغط الحروف المكررة — لمنع التحايل بكتابة الكلمة بأشكال مختلفة.
CREATE OR REPLACE FUNCTION public.normalize_arabic_text(p_text text)
RETURNS text
LANGUAGE sql
IMMUTABLE STRICT
AS $function$
  SELECT regexp_replace(
    translate(
      translate(
        lower(p_text),
        -- من ← إلى (بنفس الترتيب والطول): أإآٱ→اااا، ى→ي، ة→ه، ؤ→و، ئ→ي
        -- والتشويه الرقمي: 0→o، 1→i، 3→e، 4→a، 5→s، 7→h، 8→b، @→a، $→s
        'أإآٱىةؤئ0134578@$',
        'اااايهويoieashbas'
      ),
      -- حذف: التطويل والتشكيل والسكون والمدّة والمحارف غير المرئية وفاصلة الاتجاه
      'ـًٌٍَُِّْٰٕٔ​‌‍‎‏﻿­؜',
      ''
    ),
    '(.)\1+',
    '\1',
    'g'
  );
$function$;

-- النسخة المضغوطة: حروف وأرقام فقط (بدون فواصل) — لمواجهة الفصل بين الحروف بمسافات/رموز
CREATE OR REPLACE FUNCTION public.moderation_compact_text(p_text text)
RETURNS text
LANGUAGE sql
IMMUTABLE STRICT
AS $function$
  SELECT regexp_replace(public.normalize_arabic_text(p_text), '[^a-z0-9ء-ي]', '', 'g');
$function$;

-- فحص الرسالة ضد القوائم: يعيد {blocked, matched_word, severity}
-- p_room_id: الكلمات الخاصة بالغرفة تضاف للعامة؛ p_user_id: للاستثناءات.
CREATE OR REPLACE FUNCTION public.check_word_filter(
  p_text text,
  p_room_id uuid DEFAULT NULL,
  p_user_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_settings public.moderation_settings%ROWTYPE;
  v_norm text;
  v_compact text;
  v_word_norm text;
  v_word_compact text;
  v_matched text;
  v_severity text;
  v_found boolean := false;
BEGIN
  SELECT * INTO v_settings FROM public.moderation_settings WHERE id FOR SHARE;
  IF NOT FOUND OR NOT v_settings.filter_enabled THEN
    RETURN jsonb_build_object('blocked', false);
  END IF;

  -- الاستثناءات: مستخدم معيّن أو غرفة معيّنة معفاة من الفلترة
  IF EXISTS (
    SELECT 1 FROM public.moderation_exceptions e
    WHERE e.revoked_at IS NULL
      AND e.exception_type = 'bypass_word_filter'
      AND (
        (p_user_id IS NOT NULL AND e.subject_user_id = p_user_id)
        OR (p_room_id IS NOT NULL AND e.subject_room_id = p_room_id)
      )
  ) THEN
    RETURN jsonb_build_object('blocked', false);
  END IF;

  v_norm := public.normalize_arabic_text(p_text);
  v_compact := public.moderation_compact_text(p_text);

  -- الكلمات المسموحة تُحذف من النص أولاً (الأطول أولاً) فتمنع الالتباس
  FOR v_word_norm IN
    SELECT public.normalize_arabic_text(w.word)
    FROM public.moderation_words w
    WHERE w.list_type = 'allowed'
      AND w.is_active
      AND (w.room_id IS NULL OR w.room_id IS NOT DISTINCT FROM p_room_id)
    ORDER BY length(w.word) DESC
  LOOP
    IF v_word_norm IS NOT NULL AND length(v_word_norm) >= 2 THEN
      v_norm := replace(v_norm, v_word_norm, ' ');
      v_compact := replace(v_compact, v_word_norm, ' ');
    END IF;
  END LOOP;

  -- الكلمات الممنوعة: الأشد أولاً؛ مطابقة مباشرة على النص المطبع،
  -- ومطابقة مضغوطة (الكلمات >= 4 أحرف) لمواجهة الفصل بالرموز
  FOR v_word_norm, v_word_compact, v_matched, v_severity IN
    SELECT public.normalize_arabic_text(w.word),
           public.moderation_compact_text(w.word),
           w.word,
           w.severity
    FROM public.moderation_words w
    WHERE w.list_type = 'forbidden'
      AND w.is_active
      AND (w.room_id IS NULL OR w.room_id IS NOT DISTINCT FROM p_room_id)
    ORDER BY CASE w.severity WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END,
             length(w.word) DESC
  LOOP
    IF v_word_norm IS NULL OR length(v_word_norm) < 2 THEN
      CONTINUE;
    END IF;
    IF position(v_word_norm IN v_norm) > 0
       OR (length(v_word_compact) >= 4 AND position(v_word_compact IN v_compact) > 0)
    THEN
      v_found := true;
      EXIT;
    END IF;
  END LOOP;

  IF v_found THEN
    RETURN jsonb_build_object(
      'blocked', true,
      'matched_word', v_matched,
      'severity', v_severity
    );
  END IF;
  RETURN jsonb_build_object('blocked', false);
END;
$function$;

-- ============================================================================
-- 9) دوال التنفيذ
-- ============================================================================

-- هل الحساب فعال؟ مع استعادة تلقائية (lazy) للحظر المؤقت المنتهي:
-- banned + banned_until منتهية ← يعود active فوراً.
CREATE OR REPLACE FUNCTION public.is_account_active(p_user_id uuid)
RETURNS boolean
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_status public.user_status;
  v_until timestamptz;
BEGIN
  SELECT status, banned_until INTO v_status, v_until
  FROM public.users
  WHERE id = p_user_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RETURN false;
  END IF;
  IF v_status = 'active' THEN
    RETURN true;
  END IF;
  IF v_status = 'banned' AND v_until IS NOT NULL AND v_until <= now() THEN
    UPDATE public.users
    SET status = 'active',
        banned_reason = NULL,
        banned_until = NULL,
        updated_at = now()
    WHERE id = p_user_id;
    RETURN true;
  END IF;
  RETURN false;
END;
$function$;

-- هل يوجد كتم محادثة عامي (من الإدارة) ساري؟ (كتم الغرفة منفصل في room_chat_mutes)
CREATE OR REPLACE FUNCTION public.has_active_chat_mute(p_user_id uuid)
RETURNS boolean
LANGUAGE sql
VOLATILE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.user_penalties p
    WHERE p.user_id = p_user_id
      AND p.penalty_type = 'mute'
      AND p.revoked_at IS NULL
      AND p.ends_at > now()
  );
$function$;

-- تسجيل مخالفة فلترة كلمات + تصعيد تلقائي حسب عدد المخالفات داخل نافذة الإعدادات
CREATE OR REPLACE FUNCTION public.record_word_violation(
  p_user_id uuid,
  p_room_id uuid,
  p_message text,
  p_matched_word text,
  p_severity text
)
RETURNS uuid
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_settings public.moderation_settings%ROWTYPE;
  v_violation_id uuid;
  v_penalty_id uuid;
  v_count integer;
  v_sev text := coalesce(NULLIF(btrim(p_severity), ''), 'medium');
BEGIN
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'مستخدم غير صالح';
  END IF;
  IF v_sev NOT IN ('low', 'medium', 'high') THEN
    v_sev := 'medium';
  END IF;

  INSERT INTO public.user_violations (
    user_id, violation_type, source, severity, reason,
    matched_word, context_room_id, context_message
  ) VALUES (
    p_user_id, 'word_filter', 'auto', v_sev,
    'رسالة تحتوي كلمة ممنوعة',
    p_matched_word, p_room_id, left(p_message, 500)
  )
  RETURNING id INTO v_violation_id;

  -- ربط بخطة المخاطر (#48)
  PERFORM public.record_risk_event(
    p_event_type := 'blocked_action',
    p_user_id := p_user_id,
    p_severity := v_sev,
    p_description := 'word_filter:' || coalesce(p_matched_word, ''),
    p_metadata := jsonb_build_object('violation_id', v_violation_id, 'room_id', p_room_id)
  );

  SELECT * INTO v_settings FROM public.moderation_settings WHERE id;
  IF NOT FOUND THEN
    RETURN v_violation_id;
  END IF;

  SELECT count(*) INTO v_count
  FROM public.user_violations
  WHERE user_id = p_user_id
    AND created_at > now() - make_interval(days => v_settings.violation_counting_window_days);

  -- التصعيد التلقائي: حظر دائم ← حظر مؤقت ← كتم ← تحذير
  IF v_count >= v_settings.violations_before_permanent_ban THEN
    IF NOT public.is_account_active(p_user_id) THEN
      RETURN v_violation_id; -- محظور أصلاً: المخالفة تُسجَّل فقط
    END IF;
    INSERT INTO public.user_penalties (
      user_id, penalty_type, reason, violation_id, created_by
    ) VALUES (
      p_user_id, 'permanent_ban',
      'حظر دائم تلقائي: تجاوز حد المخالفات', v_violation_id, p_user_id
    ) RETURNING id INTO v_penalty_id;
    UPDATE public.users
    SET status = 'banned',
        banned_reason = 'حظر دائم تلقائي: تجاوز حد المخالفات',
        banned_until = NULL,
        updated_at = now()
    WHERE id = p_user_id;
    INSERT INTO public.user_notifications (user_id, event_type, reference_id, title, body, route)
    VALUES (p_user_id, 'moderation_penalty', v_penalty_id,
      'حظر دائم', 'تم حظر حسابك نهائياً لتكرار المخالفات.', '/(tabs)/profile')
    ON CONFLICT (user_id, event_type, reference_id) DO NOTHING;
  ELSIF v_count >= v_settings.violations_before_temp_ban THEN
    IF NOT public.is_account_active(p_user_id) THEN
      RETURN v_violation_id;
    END IF;
    INSERT INTO public.user_penalties (
      user_id, penalty_type, reason, violation_id, ends_at, created_by
    ) VALUES (
      p_user_id, 'temp_ban',
      'حظر مؤقت تلقائي: تجاوز حد المخالفات', v_violation_id,
      now() + make_interval(hours => v_settings.temp_ban_default_hours), p_user_id
    ) RETURNING id INTO v_penalty_id;
    UPDATE public.users
    SET status = 'banned',
        banned_reason = 'حظر مؤقت تلقائي: تجاوز حد المخالفات',
        banned_until = now() + make_interval(hours => v_settings.temp_ban_default_hours),
        updated_at = now()
    WHERE id = p_user_id;
    INSERT INTO public.user_notifications (user_id, event_type, reference_id, title, body, route)
    VALUES (p_user_id, 'moderation_penalty', v_penalty_id,
      'حظر مؤقت',
      format('تم حظرك مؤقتاً لمدة %s ساعة لتكرار المخالفات.', v_settings.temp_ban_default_hours),
      '/(tabs)/profile')
    ON CONFLICT (user_id, event_type, reference_id) DO NOTHING;
  ELSIF v_count >= v_settings.warnings_before_mute THEN
    IF public.has_active_chat_mute(p_user_id) THEN
      RETURN v_violation_id; -- مكتوم أصلاً
    END IF;
    INSERT INTO public.user_penalties (
      user_id, penalty_type, reason, violation_id, ends_at, created_by
    ) VALUES (
      p_user_id, 'mute',
      'كتم تلقائي: تكرار المخالفات', v_violation_id,
      now() + make_interval(mins => v_settings.mute_default_minutes), p_user_id
    ) RETURNING id INTO v_penalty_id;
    INSERT INTO public.user_notifications (user_id, event_type, reference_id, title, body, route)
    VALUES (p_user_id, 'moderation_penalty', v_penalty_id,
      'كتم المحادثة',
      format('تم كتم محادثتك لمدة %s دقيقة لتكرار المخالفات.', v_settings.mute_default_minutes),
      '/(tabs)/profile')
    ON CONFLICT (user_id, event_type, reference_id) DO NOTHING;
  ELSE
    INSERT INTO public.user_notifications (user_id, event_type, reference_id, title, body, route)
    VALUES (p_user_id, 'moderation_penalty', v_violation_id,
      'تحذير من الإشراف', 'رسالتك خالفت قواعد المحادثة. تجنب الكلمات الممنوعة وإلا ستتخذ إجراءات أشد.',
      '/(tabs)/profile')
    ON CONFLICT (user_id, event_type, reference_id) DO NOTHING;
  END IF;

  RETURN v_violation_id;
END;
$function$;

-- ============================================================================
-- 10) دوال الإدارة (service_role فقط — تُستدعى من Edge Functions بعد فحص الدور)
-- ============================================================================

-- تطبيق عقوبة يدوية: تحذير / كتم / طرد من غرفة / حظر مؤقت / حظر دائم
CREATE OR REPLACE FUNCTION public.apply_moderation_penalty(
  p_admin_id uuid,
  p_target_user_id uuid,
  p_penalty_type text,
  p_reason text,
  p_duration_minutes integer DEFAULT NULL,
  p_room_id uuid DEFAULT NULL,
  p_violation_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_admin public.users%ROWTYPE;
  v_target public.users%ROWTYPE;
  v_reason text := nullif(btrim(p_reason), '');
  v_penalty_id uuid;
  v_violation_id uuid := p_violation_id;
  v_action public.audit_action_type;
  v_ends_at timestamptz;
  v_target_name text;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'غير مصرح بتنفيذ الإجراء الإداري';
  END IF;
  IF p_admin_id IS NULL OR p_target_user_id IS NULL OR p_admin_id = p_target_user_id THEN
    RAISE EXCEPTION 'الحساب المستهدف غير صالح';
  END IF;
  IF p_penalty_type NOT IN ('warning', 'mute', 'kick', 'temp_ban', 'permanent_ban') THEN
    RAISE EXCEPTION 'نوع العقوبة غير صالح';
  END IF;
  IF v_reason IS NULL OR char_length(v_reason) > 500 THEN
    RAISE EXCEPTION 'أدخل سبباً واضحاً لا يتجاوز 500 حرف';
  END IF;

  SELECT * INTO v_admin FROM public.users WHERE id = p_admin_id FOR UPDATE;
  IF NOT FOUND OR v_admin.status <> 'active'
     OR v_admin.role NOT IN ('admin', 'super_admin') THEN
    RAISE EXCEPTION 'لا تملك صلاحية تنفيذ هذا الإجراء';
  END IF;

  SELECT * INTO v_target FROM public.users WHERE id = p_target_user_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'الحساب المستهدف غير موجود';
  END IF;
  IF v_target.role NOT IN ('user', 'guest') THEN
    RAISE EXCEPTION 'العقوبات متاحة لحسابات المستخدمين فقط';
  END IF;

  -- التحقق من المدد: كتم 1..30 يوماً، حظر مؤقت 5 دقائق..30 يوماً، الباقي بلا مدة
  IF p_penalty_type = 'mute' THEN
    IF p_duration_minutes IS NULL OR p_duration_minutes < 1 OR p_duration_minutes > 43200 THEN
      RAISE EXCEPTION 'مدة الكتم يجب أن تكون من دقيقة إلى 30 يوماً';
    END IF;
    v_ends_at := now() + make_interval(mins => p_duration_minutes);
  ELSIF p_penalty_type = 'temp_ban' THEN
    IF p_duration_minutes IS NULL OR p_duration_minutes < 5 OR p_duration_minutes > 43200 THEN
      RAISE EXCEPTION 'مدة الحظر المؤقت يجب أن تكون من 5 دقائق إلى 30 يوماً';
    END IF;
    v_ends_at := now() + make_interval(mins => p_duration_minutes);
  ELSIF p_duration_minutes IS NOT NULL THEN
    RAISE EXCEPTION 'هذه العقوبة لا تقبل مدة';
  END IF;

  IF p_penalty_type = 'kick' THEN
    IF p_room_id IS NULL OR NOT EXISTS (SELECT 1 FROM public.rooms WHERE id = p_room_id) THEN
      RAISE EXCEPTION 'الطرد يتطلب غرفة صحيحة';
    END IF;
  ELSIF p_room_id IS NOT NULL THEN
    RAISE EXCEPTION 'هذه العقوبة لا تقبل غرفة';
  END IF;

  -- مخالفة مرتبطة إن لم توجد
  IF v_violation_id IS NULL THEN
    INSERT INTO public.user_violations (
      user_id, violation_type, source, severity, reason, context_room_id, created_by
    ) VALUES (
      p_target_user_id, 'manual_admin', 'admin', 'high', v_reason, p_room_id, p_admin_id
    )
    RETURNING id INTO v_violation_id;
  END IF;

  v_action := CASE p_penalty_type
    WHEN 'temp_ban' THEN 'suspend'::public.audit_action_type
    WHEN 'permanent_ban' THEN 'ban'::public.audit_action_type
    ELSE 'update'::public.audit_action_type
  END;

  INSERT INTO public.user_penalties (
    user_id, penalty_type, reason, violation_id, room_id, ends_at, created_by
  ) VALUES (
    p_target_user_id, p_penalty_type, v_reason, v_violation_id, p_room_id, v_ends_at, p_admin_id
  )
  RETURNING id INTO v_penalty_id;

  IF p_penalty_type = 'temp_ban' OR p_penalty_type = 'permanent_ban' THEN
    UPDATE public.users
    SET status = 'banned',
        banned_reason = v_reason,
        banned_until = CASE WHEN p_penalty_type = 'temp_ban' THEN v_ends_at ELSE NULL END,
        updated_at = now()
    WHERE id = p_target_user_id;
  ELSIF p_penalty_type = 'kick' THEN
    UPDATE public.room_seats
    SET user_id = NULL, status = 'empty', is_mic_on = false, joined_at = NULL
    WHERE room_id = p_room_id AND user_id = p_target_user_id;
    DELETE FROM public.room_presence WHERE room_id = p_room_id AND user_id = p_target_user_id;
    SELECT coalesce(nullif(u.display_name, ''), u.username) INTO v_target_name
    FROM public.users u WHERE u.id = p_target_user_id;
    INSERT INTO public.room_messages (room_id, user_id, message, is_system)
    VALUES (p_room_id, p_admin_id, 'أخرجت الإدارة ' || coalesce(v_target_name, 'مستخدماً') || ' من الغرفة.', true);
  END IF;

  INSERT INTO public.user_notifications (user_id, event_type, reference_id, title, body, route)
  VALUES (
    p_target_user_id, 'moderation_penalty', v_penalty_id,
    CASE p_penalty_type
      WHEN 'warning' THEN 'تحذير'
      WHEN 'mute' THEN 'كتم المحادثة'
      WHEN 'kick' THEN 'طرد من الغرفة'
      WHEN 'temp_ban' THEN 'حظر مؤقت'
      ELSE 'حظر دائم'
    END,
    CASE
      WHEN p_penalty_type = 'warning' THEN 'تحذير: ' || v_reason
      WHEN p_penalty_type = 'mute' THEN format('تم كتم محادثتك لمدة %s دقيقة. السبب: %s', p_duration_minutes, v_reason)
      WHEN p_penalty_type = 'kick' THEN 'تم إخراجك من الغرفة. السبب: ' || v_reason
      WHEN p_penalty_type = 'temp_ban' THEN format('تم حظرك مؤقتاً حتى %s. السبب: %s', to_char(v_ends_at, 'YYYY-MM-DD HH24:MI'), v_reason)
      ELSE 'تم حظر حسابك نهائياً. السبب: ' || v_reason
    END,
    '/(tabs)/profile'
  )
  ON CONFLICT (user_id, event_type, reference_id) DO NOTHING;

  INSERT INTO public.admin_audit_log (
    admin_id, action, target_type, target_id, before, after, metadata
  ) VALUES (
    p_admin_id, v_action, 'user', p_target_user_id,
    jsonb_build_object('status', v_target.status, 'banned_until', v_target.banned_until),
    jsonb_build_object(
      'penalty_type', p_penalty_type,
      'ends_at', v_ends_at,
      'status', CASE WHEN p_penalty_type IN ('temp_ban', 'permanent_ban') THEN 'banned' ELSE v_target.status::text END
    ),
    jsonb_build_object(
      'penalty_id', v_penalty_id,
      'violation_id', v_violation_id,
      'duration_minutes', p_duration_minutes,
      'room_id', p_room_id,
      'reason', v_reason
    )
  );

  RETURN jsonb_build_object(
    'penalty_id', v_penalty_id,
    'violation_id', v_violation_id,
    'penalty_type', p_penalty_type,
    'ends_at', v_ends_at
  );
END;
$function$;

-- إلغاء عقوبة (رفع كتم/حظر) مع إعادة تنشيط الحساب عند الحاجة
CREATE OR REPLACE FUNCTION public.revoke_moderation_penalty(
  p_admin_id uuid,
  p_penalty_id uuid,
  p_reason text
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_admin public.users%ROWTYPE;
  v_penalty public.user_penalties%ROWTYPE;
  v_reason text := nullif(btrim(p_reason), '');
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'غير مصرح بتنفيذ الإجراء الإداري';
  END IF;
  IF v_reason IS NULL OR char_length(v_reason) > 500 THEN
    RAISE EXCEPTION 'أدخل سبباً واضحاً لا يتجاوز 500 حرف';
  END IF;

  SELECT * INTO v_admin FROM public.users WHERE id = p_admin_id FOR UPDATE;
  IF NOT FOUND OR v_admin.status <> 'active'
     OR v_admin.role NOT IN ('admin', 'super_admin') THEN
    RAISE EXCEPTION 'لا تملك صلاحية تنفيذ هذا الإجراء';
  END IF;

  SELECT * INTO v_penalty FROM public.user_penalties
  WHERE id = p_penalty_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'العقوبة غير موجودة';
  END IF;
  IF v_penalty.revoked_at IS NOT NULL THEN
    RAISE EXCEPTION 'العقوبة ملغاة مسبقاً';
  END IF;

  UPDATE public.user_penalties
  SET revoked_at = now(), revoked_by = p_admin_id, revoke_reason = v_reason
  WHERE id = p_penalty_id;

  IF v_penalty.penalty_type IN ('temp_ban', 'permanent_ban') THEN
    -- إعادة التنشيط فقط إن لم توجد عقوبة حظر أخرى سارية
    IF v_penalty.user_id IN (
      SELECT p.user_id FROM public.user_penalties p
      WHERE p.user_id = v_penalty.user_id
        AND p.penalty_type IN ('temp_ban', 'permanent_ban')
        AND p.revoked_at IS NULL
        AND p.id <> v_penalty.id
        AND (p.ends_at IS NULL OR p.ends_at > now())
    ) THEN
      NULL; -- حظر آخر ساري: نكتفي بإلغاء السجل
    ELSE
      UPDATE public.users
      SET status = 'active',
          banned_reason = NULL,
          banned_until = NULL,
          updated_at = now()
      WHERE id = v_penalty.user_id AND status = 'banned';
    END IF;
  END IF;

  INSERT INTO public.user_notifications (user_id, event_type, reference_id, title, body, route)
  VALUES (v_penalty.user_id, 'moderation_penalty', v_penalty.id,
    'رفع العقوبة', 'تم رفع العقوبة المفروضة عليك.', '/(tabs)/profile')
  ON CONFLICT (user_id, event_type, reference_id) DO NOTHING;

  INSERT INTO public.admin_audit_log (
    admin_id, action, target_type, target_id, before, after, metadata
  ) VALUES (
    p_admin_id,
    CASE WHEN v_penalty.penalty_type IN ('temp_ban', 'permanent_ban')
      THEN 'unban'::public.audit_action_type
      ELSE 'update'::public.audit_action_type END,
    'user', v_penalty.user_id,
    jsonb_build_object('penalty_type', v_penalty.penalty_type, 'revoked', false),
    jsonb_build_object('penalty_type', v_penalty.penalty_type, 'revoked', true),
    jsonb_build_object('penalty_id', v_penalty.id, 'reason', v_reason)
  );

  RETURN jsonb_build_object('penalty_id', v_penalty.id, 'revoked', true);
END;
$function$;

-- مراجعة بلاغ: تنفيذ الإجراء (مع عقوبة اختيارية) أو رفض البلاغ
CREATE OR REPLACE FUNCTION public.admin_review_user_report(
  p_admin_id uuid,
  p_report_id uuid,
  p_decision text,
  p_note text DEFAULT NULL,
  p_penalty text DEFAULT NULL,
  p_duration_minutes integer DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_admin public.users%ROWTYPE;
  v_report public.user_reports%ROWTYPE;
  v_violation_id uuid;
  v_result jsonb := NULL;
  v_note text := nullif(btrim(p_note), '');
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'غير مصرح بتنفيذ الإجراء الإداري';
  END IF;
  IF p_decision NOT IN ('actioned', 'dismissed') THEN
    RAISE EXCEPTION 'القرار غير صالح';
  END IF;
  IF v_note IS NOT NULL AND char_length(v_note) > 500 THEN
    RAISE EXCEPTION 'الملاحظة لا تتجاوز 500 حرف';
  END IF;
  IF p_decision = 'actioned' AND p_penalty IS NOT NULL
     AND p_penalty NOT IN ('warning', 'mute', 'temp_ban', 'permanent_ban') THEN
    RAISE EXCEPTION 'العقوبة المطلوبة غير متاحة لمراجعة البلاغات';
  END IF;

  SELECT * INTO v_admin FROM public.users WHERE id = p_admin_id FOR UPDATE;
  IF NOT FOUND OR v_admin.status <> 'active'
     OR v_admin.role NOT IN ('admin', 'super_admin') THEN
    RAISE EXCEPTION 'لا تملك صلاحية تنفيذ هذا الإجراء';
  END IF;

  SELECT * INTO v_report FROM public.user_reports
  WHERE id = p_report_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'البلاغ غير موجود';
  END IF;
  IF v_report.status <> 'pending' THEN
    RAISE EXCEPTION 'البلاغ تمت مراجعته مسبقاً';
  END IF;
  IF v_report.reported_id = p_admin_id THEN
    RAISE EXCEPTION 'لا يمكن مراجعة بلاغ عليك';
  END IF;

  IF p_decision = 'actioned' THEN
    INSERT INTO public.user_violations (
      user_id, violation_type, source, severity, reason, created_by
    ) VALUES (
      v_report.reported_id, 'report_review', 'admin', 'high',
      'بلاغ مؤكد: ' || coalesce(v_report.reason, 'بدون سبب'), p_admin_id
    )
    RETURNING id INTO v_violation_id;

    IF p_penalty IS NOT NULL THEN
      v_result := public.apply_moderation_penalty(
        p_admin_id, v_report.reported_id, p_penalty,
        'بلاغ مؤكد: ' || coalesce(v_report.reason, 'بدون سبب'),
        p_duration_minutes, NULL, v_violation_id
      );
    END IF;
  END IF;

  UPDATE public.user_reports
  SET status = p_decision,
      reviewed_by = p_admin_id,
      reviewed_at = now(),
      decision_note = v_note,
      linked_violation_id = v_violation_id
  WHERE id = p_report_id;

  INSERT INTO public.admin_audit_log (
    admin_id, action, target_type, target_id, before, after, metadata
  ) VALUES (
    p_admin_id,
    CASE WHEN p_decision = 'actioned' THEN 'approve'::public.audit_action_type
         ELSE 'reject'::public.audit_action_type END,
    'user_report', p_report_id,
    jsonb_build_object('status', 'pending'),
    jsonb_build_object('status', p_decision, 'violation_id', v_violation_id),
    jsonb_build_object('note', v_note, 'penalty', p_penalty,
      'duration_minutes', p_duration_minutes, 'result', v_result)
  );

  RETURN jsonb_build_object(
    'report_id', p_report_id,
    'status', p_decision,
    'violation_id', v_violation_id,
    'penalty_result', v_result
  );
END;
$function$;

-- إضافة/تعديل كلمة في القوائم (upsert)
CREATE OR REPLACE FUNCTION public.admin_upsert_moderation_word(
  p_admin_id uuid,
  p_list_type text,
  p_word text,
  p_severity text DEFAULT 'medium',
  p_room_id uuid DEFAULT NULL,
  p_is_active boolean DEFAULT true
)
RETURNS uuid
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_admin public.users%ROWTYPE;
  v_word text := btrim(coalesce(p_word, ''));
  v_severity text := coalesce(NULLIF(btrim(p_severity), ''), 'medium');
  v_id uuid;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'غير مصرح بتنفيذ الإجراء الإداري';
  END IF;
  IF p_list_type NOT IN ('forbidden', 'allowed') THEN
    RAISE EXCEPTION 'نوع القائمة غير صالح';
  END IF;
  IF length(v_word) NOT BETWEEN 1 AND 120 THEN
    RAISE EXCEPTION 'الكلمة يجب أن تكون بين 1 و120 حرف';
  END IF;
  IF v_severity NOT IN ('low', 'medium', 'high') THEN
    RAISE EXCEPTION 'الخطورة غير صالحة';
  END IF;
  IF p_room_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.rooms WHERE id = p_room_id) THEN
    RAISE EXCEPTION 'الغرفة غير موجودة';
  END IF;
  IF p_list_type = 'allowed' THEN
    v_severity := 'low';
  END IF;

  SELECT * INTO v_admin FROM public.users WHERE id = p_admin_id FOR SHARE;
  IF NOT FOUND OR v_admin.status <> 'active'
     OR v_admin.role NOT IN ('admin', 'super_admin') THEN
    RAISE EXCEPTION 'لا تملك صلاحية تنفيذ هذا الإجراء';
  END IF;

  INSERT INTO public.moderation_words (list_type, word, severity, room_id, is_active, created_by)
  VALUES (p_list_type, v_word, v_severity, p_room_id, p_is_active, p_admin_id)
  ON CONFLICT (list_type, word, scope_key) DO UPDATE
    SET severity = EXCLUDED.severity,
        is_active = EXCLUDED.is_active
  RETURNING id INTO v_id;

  INSERT INTO public.admin_audit_log (
    admin_id, action, target_type, target_id, before, after, metadata
  ) VALUES (
    p_admin_id, 'update'::public.audit_action_type, 'moderation_word', v_id,
    NULL,
    jsonb_build_object('list_type', p_list_type, 'word', v_word,
      'severity', v_severity, 'room_id', p_room_id, 'is_active', p_is_active),
    jsonb_build_object('upsert', true)
  );

  RETURN v_id;
END;
$function$;

-- حذف كلمة من القوائم
CREATE OR REPLACE FUNCTION public.admin_delete_moderation_word(
  p_admin_id uuid,
  p_word_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_admin public.users%ROWTYPE;
  v_word public.moderation_words%ROWTYPE;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'غير مصرح بتنفيذ الإجراء الإداري';
  END IF;

  SELECT * INTO v_admin FROM public.users WHERE id = p_admin_id FOR SHARE;
  IF NOT FOUND OR v_admin.status <> 'active'
     OR v_admin.role NOT IN ('admin', 'super_admin') THEN
    RAISE EXCEPTION 'لا تملك صلاحية تنفيذ هذا الإجراء';
  END IF;

  SELECT * INTO v_word FROM public.moderation_words WHERE id = p_word_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'الكلمة غير موجودة';
  END IF;

  DELETE FROM public.moderation_words WHERE id = p_word_id;

  INSERT INTO public.admin_audit_log (
    admin_id, action, target_type, target_id, before, after, metadata
  ) VALUES (
    p_admin_id, 'delete'::public.audit_action_type, 'moderation_word', p_word_id,
    jsonb_build_object('list_type', v_word.list_type, 'word', v_word.word, 'room_id', v_word.room_id),
    NULL,
    jsonb_build_object('deleted', true)
  );

  RETURN jsonb_build_object('deleted', true, 'word_id', p_word_id);
END;
$function$;

-- تحديث إعدادات الإشراف (مفاتيح مسموحة فقط)
CREATE OR REPLACE FUNCTION public.admin_update_moderation_settings(
  p_admin_id uuid,
  p_settings jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_admin public.users%ROWTYPE;
  v_current public.moderation_settings%ROWTYPE;
  v_keys text[] := array[
    'filter_enabled', 'warnings_before_mute', 'mute_default_minutes',
    'violations_before_temp_ban', 'temp_ban_default_hours',
    'violations_before_permanent_ban', 'violation_counting_window_days'
  ];
  v_key text;
  v_value jsonb;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'غير مصرح بتنفيذ الإجراء الإداري';
  END IF;
  IF p_settings IS NULL OR p_settings = '{}'::jsonb THEN
    RAISE EXCEPTION 'لا توجد إعدادات للتحديث';
  END IF;

  SELECT * INTO v_admin FROM public.users WHERE id = p_admin_id FOR SHARE;
  IF NOT FOUND OR v_admin.status <> 'active'
     OR v_admin.role NOT IN ('admin', 'super_admin') THEN
    RAISE EXCEPTION 'لا تملك صلاحية تنفيذ هذا الإجراء';
  END IF;

  FOREACH v_key IN ARRAY v_keys LOOP
    v_value := p_settings -> v_key;
    CONTINUE WHEN v_value IS NULL;
    IF v_key = 'filter_enabled' THEN
      IF jsonb_typeof(v_value) <> 'boolean' THEN
        RAISE EXCEPTION 'قيمة filter_enabled يجب أن تكون منطقية';
      END IF;
    ELSE
      IF jsonb_typeof(v_value) <> 'number' OR (v_value ->> 0) !~ '^[0-9]+$' THEN
        RAISE EXCEPTION 'قيمة % يجب أن تكون عدداً صحيحاً موجباً', v_key;
      END IF;
    END IF;
  END LOOP;

  SELECT * INTO v_current FROM public.moderation_settings WHERE id FOR UPDATE;

  UPDATE public.moderation_settings
  SET filter_enabled = coalesce((p_settings ->> 'filter_enabled')::boolean, filter_enabled),
      warnings_before_mute = coalesce((p_settings ->> 'warnings_before_mute')::integer, warnings_before_mute),
      mute_default_minutes = coalesce((p_settings ->> 'mute_default_minutes')::integer, mute_default_minutes),
      violations_before_temp_ban = coalesce((p_settings ->> 'violations_before_temp_ban')::integer, violations_before_temp_ban),
      temp_ban_default_hours = coalesce((p_settings ->> 'temp_ban_default_hours')::integer, temp_ban_default_hours),
      violations_before_permanent_ban = coalesce((p_settings ->> 'violations_before_permanent_ban')::integer, violations_before_permanent_ban),
      violation_counting_window_days = coalesce((p_settings ->> 'violation_counting_window_days')::integer, violation_counting_window_days),
      updated_by = p_admin_id,
      updated_at = now()
  WHERE id;

  INSERT INTO public.admin_audit_log (
    admin_id, action, target_type, target_id, before, after, metadata
  ) VALUES (
    p_admin_id, 'update'::public.audit_action_type, 'moderation_settings', NULL,
    to_jsonb(v_current) - 'id',
    p_settings,
    jsonb_build_object('settings_update', true)
  );

  RETURN (SELECT to_jsonb(s) - 'id' FROM public.moderation_settings s WHERE s.id);
END;
$function$;

-- إضافة استثناء (إعفاء مستخدم أو غرفة من الفلترة)
CREATE OR REPLACE FUNCTION public.admin_add_moderation_exception(
  p_admin_id uuid,
  p_reason text,
  p_subject_user_id uuid DEFAULT NULL,
  p_subject_room_id uuid DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_admin public.users%ROWTYPE;
  v_id uuid;
  v_reason text := nullif(btrim(p_reason), '');
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'غير مصرح بتنفيذ الإجراء الإداري';
  END IF;
  IF (p_subject_user_id IS NULL) = (p_subject_room_id IS NULL) THEN
    RAISE EXCEPTION 'حدد مستخدماً أو غرفة (وليس كليهما)';
  END IF;
  IF v_reason IS NULL OR char_length(v_reason) > 500 THEN
    RAISE EXCEPTION 'أدخل سبباً واضحاً لا يتجاوز 500 حرف';
  END IF;

  SELECT * INTO v_admin FROM public.users WHERE id = p_admin_id FOR SHARE;
  IF NOT FOUND OR v_admin.status <> 'active'
     OR v_admin.role NOT IN ('admin', 'super_admin') THEN
    RAISE EXCEPTION 'لا تملك صلاحية تنفيذ هذا الإجراء';
  END IF;
  IF p_subject_user_id IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM public.users WHERE id = p_subject_user_id) THEN
    RAISE EXCEPTION 'المستخدم غير موجود';
  END IF;
  IF p_subject_room_id IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM public.rooms WHERE id = p_subject_room_id) THEN
    RAISE EXCEPTION 'الغرفة غير موجودة';
  END IF;

  INSERT INTO public.moderation_exceptions (
    subject_user_id, subject_room_id, exception_type, reason, created_by
  ) VALUES (
    p_subject_user_id, p_subject_room_id, 'bypass_word_filter', v_reason, p_admin_id
  )
  RETURNING id INTO v_id;

  INSERT INTO public.admin_audit_log (
    admin_id, action, target_type, target_id, before, after, metadata
  ) VALUES (
    p_admin_id, 'create'::public.audit_action_type, 'moderation_exception', v_id,
    NULL,
    jsonb_build_object('subject_user_id', p_subject_user_id,
      'subject_room_id', p_subject_room_id, 'reason', v_reason),
    jsonb_build_object('exception_type', 'bypass_word_filter')
  );

  RETURN v_id;
END;
$function$;

-- إلغاء استثناء
CREATE OR REPLACE FUNCTION public.admin_revoke_moderation_exception(
  p_admin_id uuid,
  p_exception_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_admin public.users%ROWTYPE;
  v_rows integer;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'غير مصرح بتنفيذ الإجراء الإداري';
  END IF;

  SELECT * INTO v_admin FROM public.users WHERE id = p_admin_id FOR SHARE;
  IF NOT FOUND OR v_admin.status <> 'active'
     OR v_admin.role NOT IN ('admin', 'super_admin') THEN
    RAISE EXCEPTION 'لا تملك صلاحية تنفيذ هذا الإجراء';
  END IF;

  UPDATE public.moderation_exceptions
  SET revoked_at = now(), revoked_by = p_admin_id
  WHERE id = p_exception_id AND revoked_at IS NULL;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows = 0 THEN
    RAISE EXCEPTION 'الاستثناء غير موجود أو ملغى مسبقاً';
  END IF;

  INSERT INTO public.admin_audit_log (
    admin_id, action, target_type, target_id, before, after, metadata
  ) VALUES (
    p_admin_id, 'update'::public.audit_action_type, 'moderation_exception', p_exception_id,
    jsonb_build_object('revoked', false),
    jsonb_build_object('revoked', true),
    jsonb_build_object('revoked', true)
  );

  RETURN jsonb_build_object('revoked', true, 'exception_id', p_exception_id);
END;
$function$;

-- مراجعة اعتراض: قبول (رفع العقوبة) أو رفض
CREATE OR REPLACE FUNCTION public.admin_review_appeal(
  p_admin_id uuid,
  p_appeal_id uuid,
  p_decision text,
  p_note text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_admin public.users%ROWTYPE;
  v_appeal public.moderation_appeals%ROWTYPE;
  v_note text := nullif(btrim(p_note), '');
  v_revoke_result jsonb := NULL;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'غير مصرح بتنفيذ الإجراء الإداري';
  END IF;
  IF p_decision NOT IN ('approved', 'rejected') THEN
    RAISE EXCEPTION 'القرار غير صالح';
  END IF;
  IF v_note IS NOT NULL AND char_length(v_note) > 500 THEN
    RAISE EXCEPTION 'الملاحظة لا تتجاوز 500 حرف';
  END IF;

  SELECT * INTO v_admin FROM public.users WHERE id = p_admin_id FOR UPDATE;
  IF NOT FOUND OR v_admin.status <> 'active'
     OR v_admin.role NOT IN ('admin', 'super_admin') THEN
    RAISE EXCEPTION 'لا تملك صلاحية تنفيذ هذا الإجراء';
  END IF;

  SELECT * INTO v_appeal FROM public.moderation_appeals
  WHERE id = p_appeal_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'الاعتراض غير موجود';
  END IF;
  IF v_appeal.status <> 'pending' THEN
    RAISE EXCEPTION 'الاعتراض تمت مراجعته مسبقاً';
  END IF;

  IF p_decision = 'approved' AND v_appeal.penalty_id IS NOT NULL THEN
    v_revoke_result := public.revoke_moderation_penalty(
      p_admin_id, v_appeal.penalty_id,
      'قبول الاعتراض' || CASE WHEN v_note IS NOT NULL THEN ': ' || v_note ELSE '' END
    );
  END IF;

  UPDATE public.moderation_appeals
  SET status = p_decision,
      reviewed_by = p_admin_id,
      review_note = v_note,
      decided_at = now()
  WHERE id = p_appeal_id;

  INSERT INTO public.user_notifications (user_id, event_type, reference_id, title, body, route)
  VALUES (v_appeal.user_id, 'moderation_appeal', v_appeal.id,
    CASE WHEN p_decision = 'approved' THEN 'قبول الاعتراض' ELSE 'رفض الاعتراض' END,
    CASE WHEN p_decision = 'approved'
      THEN 'تم قبول اعتراضك ورفع العقوبة.'
      ELSE 'تم رفض اعتراضك.' || CASE WHEN v_note IS NOT NULL THEN ' السبب: ' || v_note ELSE '' END END,
    '/(tabs)/profile')
  ON CONFLICT (user_id, event_type, reference_id) DO NOTHING;

  INSERT INTO public.admin_audit_log (
    admin_id, action, target_type, target_id, before, after, metadata
  ) VALUES (
    p_admin_id,
    CASE WHEN p_decision = 'approved' THEN 'approve'::public.audit_action_type
         ELSE 'reject'::public.audit_action_type END,
    'moderation_appeal', p_appeal_id,
    jsonb_build_object('status', 'pending'),
    jsonb_build_object('status', p_decision),
    jsonb_build_object('note', v_note, 'revoke_result', v_revoke_result)
  );

  RETURN jsonb_build_object(
    'appeal_id', p_appeal_id,
    'status', p_decision,
    'revoke_result', v_revoke_result
  );
END;
$function$;

-- ============================================================================
-- 11) دوال المستخدم (للمصادقين فقط)
-- ============================================================================

-- تقديم اعتراض على عقوبة (المستخدم نفسه، عقوبته، بدون اعتراض قائم عليها)
CREATE OR REPLACE FUNCTION public.submit_moderation_appeal(
  p_penalty_id uuid,
  p_statement text
)
RETURNS uuid
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_penalty public.user_penalties%ROWTYPE;
  v_statement text := btrim(coalesce(p_statement, ''));
  v_appeal_id uuid;
  v_rate jsonb;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'يجب تسجيل الدخول';
  END IF;
  IF length(v_statement) NOT BETWEEN 10 AND 1000 THEN
    RAISE EXCEPTION 'نص الاعتراض يجب أن يكون بين 10 و1000 حرف';
  END IF;

  -- حد إرسال: 5 اعتراضات في الساعة (#48)
  SELECT public.check_rate_limit('moderation_appeal', 'user', v_uid::text, 3600, 5) INTO v_rate;
  IF NOT (v_rate ->> 'allowed')::boolean THEN
    RAISE EXCEPTION 'أرسلت عدة اعتراضات، انتظر قبل المحاولة مجدداً';
  END IF;

  SELECT * INTO v_penalty FROM public.user_penalties
  WHERE id = p_penalty_id AND user_id = v_uid;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'العقوبة غير موجودة';
  END IF;
  IF v_penalty.revoked_at IS NOT NULL THEN
    RAISE EXCEPTION 'العقوبة ملغاة ولا تقبل الاعتراض';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.moderation_appeals
    WHERE penalty_id = p_penalty_id AND status = 'pending'
  ) THEN
    RAISE EXCEPTION 'يوجد اعتراض قيد المراجعة لهذه العقوبة';
  END IF;
  IF (
    SELECT count(*) FROM public.moderation_appeals
    WHERE user_id = v_uid AND status = 'pending'
  ) >= 3 THEN
    RAISE EXCEPTION 'لديك 3 اعتراضات قيد المراجعة، انتظر قراراتها أولاً';
  END IF;

  INSERT INTO public.moderation_appeals (user_id, penalty_id, statement)
  VALUES (v_uid, p_penalty_id, v_statement)
  RETURNING id INTO v_appeal_id;

  RETURN v_appeal_id;
END;
$function$;

-- حالة الإشراف للمستخدم الحالي: عقوبات سارية + عدد المخالفات + اعتراضاته
CREATE OR REPLACE FUNCTION public.get_my_moderation_status()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_settings public.moderation_settings%ROWTYPE;
  v_count integer;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'يجب تسجيل الدخول';
  END IF;

  SELECT * INTO v_settings FROM public.moderation_settings WHERE id;

  SELECT count(*) INTO v_count
  FROM public.user_violations
  WHERE user_id = v_uid
    AND created_at > now() - make_interval(days => coalesce(v_settings.violation_counting_window_days, 90));

  RETURN jsonb_build_object(
    'violations_in_window', v_count,
    'window_days', v_settings.violation_counting_window_days,
    'active_penalties', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', p.id,
        'penalty_type', p.penalty_type,
        'reason', p.reason,
        'starts_at', p.starts_at,
        'ends_at', p.ends_at,
        'revoked', p.revoked_at IS NOT NULL
      ) ORDER BY p.starts_at DESC)
      FROM public.user_penalties p
      WHERE p.user_id = v_uid
        AND p.revoked_at IS NULL
        AND (p.ends_at IS NULL OR p.ends_at > now())
    ), '[]'::jsonb),
    'appeals', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', a.id,
        'penalty_id', a.penalty_id,
        'status', a.status,
        'statement', a.statement,
        'review_note', a.review_note,
        'created_at', a.created_at,
        'decided_at', a.decided_at
      ) ORDER BY a.created_at DESC)
      FROM public.moderation_appeals a
      WHERE a.user_id = v_uid
    ), '[]'::jsonb)
  );
END;
$function$;

-- ============================================================================
-- 12) ربط الفلترة في مسارات الرسائل
-- ============================================================================

CREATE OR REPLACE FUNCTION public.send_room_message(p_room_id uuid, p_message text)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_body text := btrim(coalesce(p_message, ''));
  v_room public.rooms%ROWTYPE;
  v_adult timestamptz;
  v_recent integer;
  v_msg public.room_messages%ROWTYPE;
  v_filter jsonb;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'يجب تسجيل الدخول أولاً';
  END IF;
  IF length(v_body) < 1 OR length(v_body) > 500 THEN
    RAISE EXCEPTION 'الرسالة يجب أن تكون بين 1 و500 حرف';
  END IF;

  -- M2.4: حد قاعدي تكاملي (الأدق 5/10ث و20/دقيقة يبقى أدناه)
  IF NOT ((public.check_room_rate_limit('message', v_uid) ->> 'allowed')::boolean) THEN
    RAISE EXCEPTION 'تجاوزت حد الرسائل المسموح، انتظر قليلاً';
  END IF;

  SELECT * INTO v_room FROM public.rooms WHERE id = p_room_id FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'الغرفة غير موجودة';
  END IF;
  IF v_room.status = 'closed' THEN
    RAISE EXCEPTION 'لا يمكن إرسال رسائل إلى غرفة مغلقة';
  END IF;

  -- M2.5: نشاط الحساب مع الاستعادة التلقائية للحظر المؤقت المنتهي
  IF NOT public.is_account_active(v_uid) THEN
    RAISE EXCEPTION 'الحساب غير مؤهل لإرسال الرسائل';
  END IF;
  SELECT u.adult_confirmed_at INTO v_adult
  FROM public.users u WHERE u.id = v_uid;
  IF v_adult IS NULL THEN
    RAISE EXCEPTION 'الحساب غير مؤهل لإرسال الرسائل';
  END IF;

  -- M2.5: كتم عام من الإدارة
  IF public.has_active_chat_mute(v_uid) THEN
    RAISE EXCEPTION 'تم كتم محادثتك من قبل الإدارة';
  END IF;

  IF v_room.owner_id <> v_uid AND EXISTS (
    SELECT 1 FROM public.user_blocks b
    WHERE (b.blocker_id = v_uid AND b.blocked_id = v_room.owner_id)
       OR (b.blocker_id = v_room.owner_id AND b.blocked_id = v_uid)
  ) THEN
    RAISE EXCEPTION 'لا يمكنك إرسال رسائل إلى هذه الغرفة';
  END IF;

  IF v_room.is_private AND v_room.owner_id <> v_uid AND NOT EXISTS (
    SELECT 1 FROM public.room_invitations i
    WHERE i.room_id = p_room_id AND i.recipient_id = v_uid AND i.status = 'accepted'
  ) THEN
    RAISE EXCEPTION 'لا تملك صلاحية الكتابة في هذه الغرفة';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.room_chat_mutes m
    WHERE m.room_id = p_room_id AND m.user_id = v_uid AND m.expires_at > now()
  ) THEN
    RAISE EXCEPTION 'تم كتم محادثتك مؤقتاً في هذه الغرفة';
  END IF;

  -- M2.5: فلترة الكلمات الممنوعة (تشمل كلمات هذه الغرفة خاصة)
  -- ملاحظة: نُعيد blocked=true بدل RAISE حتى تُلتزم المخالفة المسجَّلة مع الاستجابة
  -- (الرفع كان سيتراجع المعاملة كاملة بما فيها تسجيل المخالفة — سلوك R30).
  v_filter := public.check_word_filter(v_body, p_room_id, v_uid);
  IF (v_filter ->> 'blocked')::boolean THEN
    PERFORM public.record_word_violation(
      v_uid, p_room_id, v_body,
      v_filter ->> 'matched_word', v_filter ->> 'severity'
    );
    RETURN jsonb_build_object(
      'blocked', true,
      'reason_code', 'word_filter',
      'message', 'الرسالة تحتوي على كلمات غير مسموح بها'
    );
  END IF;

  -- حدّ معدل أدق: 5 رسائل / 10 ثوانٍ في الغرفة، و20 رسالة / دقيقة إجمالاً.
  SELECT count(*) INTO v_recent
  FROM public.room_messages m
  WHERE m.user_id = v_uid
    AND NOT m.is_system
    AND m.room_id = p_room_id
    AND m.created_at > now() - interval '10 seconds';
  IF v_recent >= 5 THEN
    RAISE EXCEPTION 'أنت ترسل الرسائل بسرعة كبيرة، انتظر قليلاً';
  END IF;

  SELECT count(*) INTO v_recent
  FROM public.room_messages m
  WHERE m.user_id = v_uid
    AND NOT m.is_system
    AND m.created_at > now() - interval '60 seconds';
  IF v_recent >= 20 THEN
    RAISE EXCEPTION 'تجاوزت حد الرسائل المسموح في الدقيقة';
  END IF;

  INSERT INTO public.room_messages (room_id, user_id, message, is_system)
  VALUES (p_room_id, v_uid, v_body, false)
  RETURNING * INTO v_msg;

  RETURN jsonb_build_object(
    'id', v_msg.id,
    'room_id', v_msg.room_id,
    'user_id', v_msg.user_id,
    'message', v_msg.message,
    'is_system', v_msg.is_system,
    'created_at', v_msg.created_at
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.send_private_message(p_conversation_id uuid, p_body text, p_idempotency_key text, p_confirmed_price_coin bigint)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_sender_id uuid := auth.uid();
  v_message_id uuid := gen_random_uuid();
  v_conversation public.private_conversations%ROWTYPE;
  v_settings public.private_message_settings%ROWTYPE;
  v_other_user_id uuid;
  v_free_used integer;
  v_charge bigint := 0;
  v_commission bigint := 0;
  v_friends boolean;
  v_mutual_follows boolean;
  v_sender_host boolean;
  v_other_host boolean;
  v_existing public.private_messages%ROWTYPE;
  v_filter jsonb;
  v_sender_adult timestamptz;
  v_other_adult timestamptz;
BEGIN
  IF v_sender_id IS NULL THEN RAISE EXCEPTION 'يجب تسجيل الدخول'; END IF;
  IF length(trim(coalesce(p_body, ''))) NOT BETWEEN 1 AND 2000 THEN
    RAISE EXCEPTION 'يجب أن تكون الرسالة بين حرف واحد و2000 حرف';
  END IF;
  IF length(trim(coalesce(p_idempotency_key, ''))) NOT BETWEEN 10 AND 70 THEN
    RAISE EXCEPTION 'مفتاح إرسال الرسالة غير صالح';
  END IF;
  IF p_confirmed_price_coin IS NULL OR p_confirmed_price_coin < 0 THEN
    RAISE EXCEPTION 'تأكيد سعر الرسالة غير صالح';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext('private-message:' || p_idempotency_key));
  SELECT * INTO v_existing FROM public.private_messages
  WHERE idempotency_key = p_idempotency_key;
  IF FOUND THEN
    IF v_existing.sender_id <> v_sender_id
       OR v_existing.conversation_id <> p_conversation_id
       OR v_existing.body <> trim(p_body) THEN
      RAISE EXCEPTION 'مفتاح الإرسال مستخدم لرسالة أخرى';
    END IF;
    RETURN jsonb_build_object(
      'message_id', v_existing.id, 'charged_coins', v_existing.charged_coins,
      'host_commission_diamonds', v_existing.host_commission_diamonds,
      'already_processed', true
    );
  END IF;

  SELECT * INTO v_conversation
  FROM public.private_conversations
  WHERE id = p_conversation_id
    AND v_sender_id IN (user_one_id, user_two_id)
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'المحادثة غير متاحة'; END IF;
  v_other_user_id := CASE WHEN v_sender_id = v_conversation.user_one_id
    THEN v_conversation.user_two_id ELSE v_conversation.user_one_id END;
  IF public.is_wattar_blocked_between(v_other_user_id) THEN
    RAISE EXCEPTION 'المحادثة غير متاحة';
  END IF;
  IF NOT public.check_privacy_permission(v_other_user_id, 'message') THEN
    RAISE EXCEPTION 'هذا المستخدم لا يسمح بالمراسلة إلا للأصدقاء';
  END IF;
  PERFORM 1 FROM public.users
  WHERE id IN (v_sender_id, v_other_user_id)
  ORDER BY id
  FOR UPDATE;

  -- M2.5: نشاط الحسابين مع الاستعادة التلقائية للحظر المؤقت المنتهي
  IF NOT public.is_account_active(v_sender_id)
     OR NOT public.is_account_active(v_other_user_id) THEN
    RAISE EXCEPTION 'أحد الحسابين غير مؤهل للمراسلة';
  END IF;
  SELECT adult_confirmed_at INTO v_sender_adult FROM public.users WHERE id = v_sender_id;
  SELECT adult_confirmed_at INTO v_other_adult FROM public.users WHERE id = v_other_user_id;
  IF v_sender_adult IS NULL OR v_other_adult IS NULL
     OR NOT EXISTS (
       SELECT 1 FROM public.users WHERE id = v_sender_id AND onboarding_completed_at IS NOT NULL
     )
     OR NOT EXISTS (
       SELECT 1 FROM public.users WHERE id = v_other_user_id AND onboarding_completed_at IS NOT NULL
     ) THEN
    RAISE EXCEPTION 'أحد الحسابين غير مؤهل للمراسلة';
  END IF;

  -- M2.5: كتم عام من الإدارة
  IF public.has_active_chat_mute(v_sender_id) THEN
    RAISE EXCEPTION 'تم كتم محادثتك من قبل الإدارة';
  END IF;

  -- M2.5: فلترة الكلمات الممنوعة (عامة)
  -- نُعيد blocked=true بدل RAISE حتى تُلتزم المخالفة مع الاستجابة (كما في رسائل الغرف)
  v_filter := public.check_word_filter(p_body, NULL, v_sender_id);
  IF (v_filter ->> 'blocked')::boolean THEN
    PERFORM public.record_word_violation(
      v_sender_id, NULL, p_body,
      v_filter ->> 'matched_word', v_filter ->> 'severity'
    );
    RETURN jsonb_build_object(
      'blocked', true,
      'reason_code', 'word_filter',
      'message', 'الرسالة تحتوي على كلمات غير مسموح بها'
    );
  END IF;

  SELECT * INTO v_settings FROM public.private_message_settings WHERE id = true FOR SHARE;
  PERFORM 1 FROM public.host_program_members
  WHERE user_id IN (v_sender_id, v_other_user_id)
  ORDER BY user_id
  FOR SHARE;
  SELECT EXISTS (
    SELECT 1 FROM public.friend_requests f
    WHERE f.status = 'accepted'
      AND ((f.requester_id = v_sender_id AND f.recipient_id = v_other_user_id)
        OR (f.requester_id = v_other_user_id AND f.recipient_id = v_sender_id))
  ) INTO v_friends;
  SELECT
    EXISTS (
      SELECT 1 FROM public.user_follows
      WHERE follower_id = v_sender_id AND followed_id = v_other_user_id
    )
    AND EXISTS (
      SELECT 1 FROM public.user_follows
      WHERE follower_id = v_other_user_id AND followed_id = v_sender_id
    )
  INTO v_mutual_follows;
  SELECT EXISTS (SELECT 1 FROM public.host_program_members WHERE user_id = v_sender_id AND status = 'active')
    INTO v_sender_host;
  SELECT EXISTS (SELECT 1 FROM public.host_program_members WHERE user_id = v_other_user_id AND status = 'active')
    INTO v_other_host;

  SELECT count(*)::integer INTO v_free_used
  FROM public.private_messages m
  WHERE m.conversation_id = p_conversation_id
    AND m.sender_is_host_at_send = false;
  IF NOT v_friends AND NOT v_mutual_follows AND NOT v_sender_host
     AND v_free_used >= v_settings.free_message_limit THEN
    v_charge := v_settings.price_coin;
    IF v_other_host THEN
      v_commission := floor(v_charge * v_settings.host_commission_percent / 100.0)::bigint;
    END IF;
  END IF;
  IF v_charge > p_confirmed_price_coin THEN
    RAISE EXCEPTION 'تغيّر سعر الرسالة أو انتهت الرسائل المجانية. حدّث السعر وأكد الإرسال من جديد.';
  END IF;

  IF v_charge > 0 THEN
    PERFORM public.record_wallet_transaction(
      v_sender_id, 'message_sent'::public.wallet_tx_type, -v_charge,
      'gold', NULL, 'private-message:' || p_idempotency_key || ':coin',
      'private_message', v_message_id,
      jsonb_build_object('conversation_id', p_conversation_id, 'recipient_id', v_other_user_id),
      'private-message-send'
    );
  END IF;
  IF v_commission > 0 THEN
    PERFORM public.record_wallet_transaction(
      v_other_user_id, 'message_commission'::public.wallet_tx_type, v_commission,
      'diamond', NULL, 'private-message:' || p_idempotency_key || ':host',
      'private_message', v_message_id,
      jsonb_build_object('conversation_id', p_conversation_id, 'sender_id', v_sender_id,
        'charged_coins', v_charge, 'commission_percent', v_settings.host_commission_percent),
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

  INSERT INTO public.private_messages (
    id, conversation_id, sender_id, body, charged_coins,
    host_commission_diamonds, sender_is_host_at_send, idempotency_key
  ) VALUES (
    v_message_id, p_conversation_id, v_sender_id, trim(p_body),
    v_charge, v_commission, v_sender_host, p_idempotency_key
  );
  UPDATE public.private_conversations SET updated_at = now()
  WHERE id = p_conversation_id;
  RETURN jsonb_build_object(
    'message_id', v_message_id, 'charged_coins', v_charge,
    'host_commission_diamonds', v_commission, 'free_remaining',
    CASE WHEN v_friends OR v_mutual_follows OR v_sender_host THEN NULL
      ELSE greatest(0, v_settings.free_message_limit - v_free_used - 1) END,
    'already_processed', false
  );
END;
$function$;

-- ============================================================================
-- 13) الصلاحيات (قاعدة P8: REVOKE صريح من PUBLIC/anon/authenticated لكل دالة خدمية)
-- ============================================================================
REVOKE ALL ON FUNCTION public.normalize_arabic_text(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.moderation_compact_text(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.check_word_filter(text, uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.is_account_active(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.has_active_chat_mute(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.record_word_violation(uuid, uuid, text, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.apply_moderation_penalty(uuid, uuid, text, text, integer, uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.revoke_moderation_penalty(uuid, uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.admin_review_user_report(uuid, uuid, text, text, text, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.admin_upsert_moderation_word(uuid, text, text, text, uuid, boolean) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.admin_delete_moderation_word(uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.admin_update_moderation_settings(uuid, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.admin_add_moderation_exception(uuid, text, uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.admin_revoke_moderation_exception(uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.admin_review_appeal(uuid, uuid, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.submit_moderation_appeal(uuid, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_my_moderation_status() FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.normalize_arabic_text(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.moderation_compact_text(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.check_word_filter(text, uuid, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.is_account_active(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.has_active_chat_mute(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.record_word_violation(uuid, uuid, text, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.apply_moderation_penalty(uuid, uuid, text, text, integer, uuid, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.revoke_moderation_penalty(uuid, uuid, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.admin_review_user_report(uuid, uuid, text, text, text, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.admin_upsert_moderation_word(uuid, text, text, text, uuid, boolean) TO service_role;
GRANT EXECUTE ON FUNCTION public.admin_delete_moderation_word(uuid, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.admin_update_moderation_settings(uuid, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.admin_add_moderation_exception(uuid, text, uuid, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.admin_revoke_moderation_exception(uuid, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.admin_review_appeal(uuid, uuid, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.submit_moderation_appeal(uuid, text) TO service_role, authenticated;
GRANT EXECUTE ON FUNCTION public.get_my_moderation_status() TO service_role, authenticated;
