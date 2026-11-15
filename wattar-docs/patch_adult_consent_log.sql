-- ============================================================
-- patch_adult_consent_log.sql — migration #45 (M1.4 بوابة ١٨+)
--
-- الهدف: إثبات موافقة المستخدم على شرط العمر (18+) بسجل دائم لا يُعدَّل.
-- لماذا جدول منفصل؟ لأن `users.adult_confirmed_at` يحمل «متى» فقط، بلا
-- نوع الموافقة ولا نسخة النص الذي وافق عليه، ولا يمكن أن يكون سجلاً
-- تاريخياً (لأنه عمود واحد يُستبدل).
--
-- التصميم:
--   * جدول append-only: لا سياسة INSERT/UPDATE/DELETE لأي مستخدم.
--   * القراءة الذاتية فقط (user_id = auth.uid()).
--   * الكتابة حصراً عبر تريغر SECURITY DEFINER عند أول تأكيد للعمر،
--     سواء جاء من `complete_my_onboarding` أو `confirm_my_adult_status`
--     أو أي مسار إداري لاحق.
--   * تعبئة رجعية للمستخدمين الذين أكّدوا العمر قبل هذا التريغر.
--
-- آمن للإعادة: كل التعريفات IF NOT EXISTS / OR REPLACE / DROP IF EXISTS.
-- التراجع: DROP TRIGGER … ; DROP FUNCTION … ; DROP TABLE public.user_consents;
-- ============================================================
BEGIN;

-- ---------- 1) الجدول ----------
CREATE TABLE IF NOT EXISTS public.user_consents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  consent_type text NOT NULL,
  document_version text NOT NULL,
  accepted_at timestamptz NOT NULL DEFAULT now(),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  CONSTRAINT user_consents_type_check
    CHECK (consent_type IN ('adult_18_plus')),
  CONSTRAINT user_consents_version_check
    CHECK (length(document_version) BETWEEN 1 AND 64),
  CONSTRAINT user_consents_unique
    UNIQUE (user_id, consent_type, document_version)
);

CREATE INDEX IF NOT EXISTS user_consents_user_accepted_idx
  ON public.user_consents (user_id, accepted_at DESC);

COMMENT ON TABLE public.user_consents IS
  'سجل موافقات المستخدم (append-only). يُكتب بتريغر فقط ولا يُعدَّل أو يُحذف.';

-- ---------- 2) الحماية ----------
ALTER TABLE public.user_consents ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "user reads own consents" ON public.user_consents;
CREATE POLICY "user reads own consents"
  ON public.user_consents
  FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

REVOKE ALL ON public.user_consents FROM anon;
REVOKE ALL ON public.user_consents FROM authenticated;
GRANT SELECT ON public.user_consents TO authenticated;
GRANT ALL ON public.user_consents TO service_role;

-- ---------- 3) دالة التسجيل ----------
CREATE OR REPLACE FUNCTION public.record_adult_consent()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
BEGIN
  IF NEW.adult_confirmed_at IS NULL THEN
    RETURN NEW;
  END IF;

  INSERT INTO public.user_consents (user_id, consent_type, document_version, accepted_at, metadata)
  VALUES (
    NEW.id,
    'adult_18_plus',
    'adult-attestation-2026-11',
    NEW.adult_confirmed_at,
    jsonb_build_object('source', 'users.adult_confirmed_at')
  )
  ON CONFLICT (user_id, consent_type, document_version) DO NOTHING;

  RETURN NEW;
END;
$fn$;

-- ---------- 4) التريغرات (إدراج + أول تحديث فقط) ----------
DROP TRIGGER IF EXISTS wattar_record_adult_consent_insert ON public.users;
CREATE TRIGGER wattar_record_adult_consent_insert
  AFTER INSERT ON public.users
  FOR EACH ROW
  WHEN (NEW.adult_confirmed_at IS NOT NULL)
  EXECUTE FUNCTION public.record_adult_consent();

DROP TRIGGER IF EXISTS wattar_record_adult_consent_update ON public.users;
CREATE TRIGGER wattar_record_adult_consent_update
  AFTER UPDATE OF adult_confirmed_at ON public.users
  FOR EACH ROW
  WHEN (OLD.adult_confirmed_at IS NULL AND NEW.adult_confirmed_at IS NOT NULL)
  EXECUTE FUNCTION public.record_adult_consent();

-- ---------- 5) تعبئة رجعية أمينة ----------
INSERT INTO public.user_consents (user_id, consent_type, document_version, accepted_at, metadata)
SELECT u.id,
       'adult_18_plus',
       'adult-attestation-2026-11',
       u.adult_confirmed_at,
       jsonb_build_object('source', 'backfill', 'backfilled_at', now())
FROM public.users u
WHERE u.adult_confirmed_at IS NOT NULL
ON CONFLICT (user_id, consent_type, document_version) DO NOTHING;

COMMIT;
