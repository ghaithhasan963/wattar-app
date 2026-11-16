-- ============================================================
-- patch_rate_limiting_risk.sql — migration #48 (M2.4: حد الطلبات + تقييم المخاطر)
--
-- الهدف: نظام حد طلبات شامل على مستوى القاعدة + تقييم مخاطر (جهاز/سلوك/شبكة).
-- يُستدعى من دوال RPC والدوال السحابية؛ لا يعتمد على الذاكرة المؤقتة.
--
-- التصميم:
--   1) جدول `rate_limit_buckets` — نوافذ منزلقة لكل (إجراء، معرف، نافذة).
--   2) جدول `risk_events` — أحداث مشبوهة للربط والتحليل.
--   3) جدول `device_fingerprints` — بصمات أجهزة معروفة (خطر/موثوق).
--   4) جدول `ip_reputation` — سمعة عناوين IP.
--   5) دالة `record_risk_event(event_type, ...)` — تسجل حدث خطر وتحدث درجات الجهاز/IP.
--   6) دالة `register_device_fingerprint(device_id, user_id, ...)` — تسجيل/تحديث بصمة جهاز
--      وتتبع عدد المستخدمين المميزين (multiple_accounts).
--   7) دالة `get_risk_score(user_id, device_id, ip)` — درجة مركبة 0–100 + توصية.
--   8) دالة `check_rate_limit(action, id_type, id_value, window, max, inc)` — تتحقق وتستهلك.
--   9) دوال مختصرة: check_auth/room/social/financial/game_rate_limit.
--
-- ملاحظة توافق: `consume_public_auth_rate_limits` (المستخدمة من auth edge functions)
-- تُترك كما هي دون تعديل — تعمل على جدول public_auth_rate_limits القائم بواجهتها الحالية.
--
-- ترتيب التعريفات: الدوال المساعدة تُعرَّف قبل مستدعيها، وجميع الاستدعاءات الداخلية
-- موضعية (positional) لتجنب مشاكل دقة التوقيع.
--
-- حدود افتراضية (قابلة للتعديل لاحقاً عبر admin_settings):
--   auth_signup:           3 / ساعة / IP
--   auth_login:            5 / 15 دقيقة / IP
--   auth_otp_request:      3 / ساعة / (هاتف/بريد)
--   auth_otp_verify:       5 / 15 دقيقة / (هاتف/بريد)
--   auth_password_reset_req:    2 / ساعة
--   auth_password_reset_submit: 3 / ساعة
--   room_join:             30 / دقيقة / مستخدم
--   room_message:          30 / دقيقة / مستخدم (تكميلي لحد RPC الأدق)
--   room_seat_claim:       10 / دقيقة / مستخدم
--   room_mic_toggle:       20 / دقيقة / مستخدم
--   social_private_message: 20 / دقيقة / مستخدم
--   social_friend_request:  20 / ساعة / مستخدم
--   social_follow:          30 / ساعة / مستخدم
--   social_gift_send:       10 / دقيقة / مستخدم
--   financial_deposit_request:    5 / ساعة / مستخدم
--   financial_withdrawal_request: 3 / ساعة / مستخدم
--   game_play:             60 / دقيقة / مستخدم
--
-- آمن للإعادة: IF NOT EXISTS / CREATE OR REPLACE.
-- التراجع: DROP FUNCTION ...; DROP TABLE ...;
-- ============================================================
BEGIN;

-- ---------- 1) جدول حد الطلبات ----------
CREATE TABLE IF NOT EXISTS public.rate_limit_buckets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bucket_key text NOT NULL UNIQUE,     -- مثال: "room_message:user:<uuid>"
  action text NOT NULL,                -- مفتاح الإجراء
  identifier_type text NOT NULL,       -- 'user' | 'ip' | 'device' | 'phone' | 'email'
  identifier_value text NOT NULL,
  window_seconds integer NOT NULL,
  max_requests integer NOT NULL,
  request_count integer NOT NULL DEFAULT 1,
  window_started_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS rate_limit_buckets_action_idx
  ON public.rate_limit_buckets (action);
CREATE INDEX IF NOT EXISTS rate_limit_buckets_identifier_idx
  ON public.rate_limit_buckets (identifier_type, identifier_value);
CREATE INDEX IF NOT EXISTS rate_limit_buckets_expired_idx
  ON public.rate_limit_buckets (updated_at);

COMMENT ON TABLE public.rate_limit_buckets IS
  'عدادات حد الطلبات بنوافذ منزلقة. مفتاح موحد: action:identifier_type:identifier_value.';

-- ---------- 2) جداول تقييم المخاطر ----------
CREATE TABLE IF NOT EXISTS public.device_fingerprints (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  device_id text NOT NULL UNIQUE,
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  user_count integer NOT NULL DEFAULT 0,  -- عدد مستخدمين مختلفين استخدموا هذا الجهاز
  risk_score integer NOT NULL DEFAULT 0,  -- 0–100 (0 آمن، 100 محظور)
  risk_level text NOT NULL DEFAULT 'low' CHECK (risk_level IN ('low','medium','high','critical')),
  is_blocked boolean NOT NULL DEFAULT false,
  block_reason text,
  blocked_at timestamptz,
  blocked_by uuid REFERENCES public.users(id),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,  -- يتضمن user_ids: مصفوفة معرفات المستخدمين
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS device_fingerprints_risk_idx
  ON public.device_fingerprints (risk_level, risk_score DESC);

CREATE TABLE IF NOT EXISTS public.ip_reputation (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ip inet NOT NULL UNIQUE,
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  request_count bigint NOT NULL DEFAULT 0,
  risk_score integer NOT NULL DEFAULT 0,
  risk_level text NOT NULL DEFAULT 'low' CHECK (risk_level IN ('low','medium','high','critical')),
  is_blocked boolean NOT NULL DEFAULT false,
  block_reason text,
  blocked_at timestamptz,
  blocked_by uuid REFERENCES public.users(id),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ip_reputation_risk_idx
  ON public.ip_reputation (risk_level, risk_score DESC);

CREATE TABLE IF NOT EXISTS public.risk_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES public.users(id) ON DELETE SET NULL,
  device_id text,
  ip inet,
  event_type text NOT NULL,   -- 'rate_limit_exceeded','multiple_accounts','suspicious_pattern','failed_auth','blocked_action'
  severity text NOT NULL DEFAULT 'low' CHECK (severity IN ('low','medium','high','critical')),
  description text NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS risk_events_user_created_idx
  ON public.risk_events (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS risk_events_device_created_idx
  ON public.risk_events (device_id, created_at DESC);
CREATE INDEX IF NOT EXISTS risk_events_ip_created_idx
  ON public.risk_events (ip, created_at DESC);
CREATE INDEX IF NOT EXISTS risk_events_type_created_idx
  ON public.risk_events (event_type, created_at DESC);

-- ---------- 3) الحماية ----------
ALTER TABLE public.rate_limit_buckets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.device_fingerprints ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ip_reputation ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.risk_events ENABLE ROW LEVEL SECURITY;

-- لا وصول مباشر من العميل؛ فقط service_role ودوال SECURITY DEFINER
REVOKE ALL ON public.rate_limit_buckets FROM anon, authenticated;
REVOKE ALL ON public.device_fingerprints FROM anon, authenticated;
REVOKE ALL ON public.ip_reputation FROM anon, authenticated;
REVOKE ALL ON public.risk_events FROM anon, authenticated;
GRANT ALL ON public.rate_limit_buckets TO service_role;
GRANT ALL ON public.device_fingerprints TO service_role;
GRANT ALL ON public.ip_reputation TO service_role;
GRANT ALL ON public.risk_events TO service_role;

-- ---------- 4) record_risk_event — تسجيل حدث خطر ----------
CREATE OR REPLACE FUNCTION public.record_risk_event(
  p_event_type text,
  p_user_id uuid DEFAULT NULL,
  p_device_id text DEFAULT NULL,
  p_ip inet DEFAULT NULL,
  p_severity text DEFAULT 'low',
  p_description text DEFAULT '',
  p_metadata jsonb DEFAULT '{}'::jsonb
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_event_id uuid;
  v_device_bump integer;
  v_ip_bump integer;
BEGIN
  IF p_event_type IS NULL OR length(p_event_type) > 64 THEN
    RAISE EXCEPTION 'Invalid event_type';
  END IF;
  IF p_severity NOT IN ('low','medium','high','critical') THEN
    RAISE EXCEPTION 'Invalid severity';
  END IF;

  INSERT INTO public.risk_events (user_id, device_id, ip, event_type, severity, description, metadata)
  VALUES (p_user_id, p_device_id, p_ip, p_event_type, p_severity, p_description, p_metadata)
  RETURNING id INTO v_event_id;

  -- تحديث/إنشاء درجة خطر الجهاز (upsert)
  IF p_device_id IS NOT NULL THEN
    v_device_bump := CASE p_severity
      WHEN 'low' THEN 1 WHEN 'medium' THEN 5 WHEN 'high' THEN 15 WHEN 'critical' THEN 40 END;
    INSERT INTO public.device_fingerprints (device_id, risk_score, risk_level)
    VALUES (p_device_id, LEAST(100, v_device_bump),
            CASE WHEN LEAST(100, v_device_bump) >= 80 THEN 'critical'
                 WHEN LEAST(100, v_device_bump) >= 50 THEN 'high'
                 WHEN LEAST(100, v_device_bump) >= 20 THEN 'medium'
                 ELSE 'low' END)
    ON CONFLICT (device_id) DO UPDATE
       SET risk_score = LEAST(100, device_fingerprints.risk_score + v_device_bump),
           risk_level = CASE
             WHEN LEAST(100, device_fingerprints.risk_score + v_device_bump) >= 80 THEN 'critical'
             WHEN LEAST(100, device_fingerprints.risk_score + v_device_bump) >= 50 THEN 'high'
             WHEN LEAST(100, device_fingerprints.risk_score + v_device_bump) >= 20 THEN 'medium'
             ELSE 'low'
           END,
           last_seen_at = now(),
           updated_at = now();
  END IF;

  -- تحديث/إنشاء درجة خطر الـIP (upsert)
  IF p_ip IS NOT NULL THEN
    v_ip_bump := CASE p_severity
      WHEN 'low' THEN 1 WHEN 'medium' THEN 3 WHEN 'high' THEN 10 WHEN 'critical' THEN 30 END;
    INSERT INTO public.ip_reputation (ip, request_count, risk_score, risk_level)
    VALUES (p_ip, 1, LEAST(100, v_ip_bump),
            CASE WHEN LEAST(100, v_ip_bump) >= 80 THEN 'critical'
                 WHEN LEAST(100, v_ip_bump) >= 50 THEN 'high'
                 WHEN LEAST(100, v_ip_bump) >= 20 THEN 'medium'
                 ELSE 'low' END)
    ON CONFLICT (ip) DO UPDATE
       SET risk_score = LEAST(100, ip_reputation.risk_score + v_ip_bump),
           risk_level = CASE
             WHEN LEAST(100, ip_reputation.risk_score + v_ip_bump) >= 80 THEN 'critical'
             WHEN LEAST(100, ip_reputation.risk_score + v_ip_bump) >= 50 THEN 'high'
             WHEN LEAST(100, ip_reputation.risk_score + v_ip_bump) >= 20 THEN 'medium'
             ELSE 'low'
           END,
           request_count = ip_reputation.request_count + 1,
           last_seen_at = now(),
           updated_at = now();
  END IF;

  RETURN v_event_id;
END;
$fn$;

-- ---------- 5) register_device_fingerprint — تسجيل/تحديث بصمة جهاز ----------
CREATE OR REPLACE FUNCTION public.register_device_fingerprint(
  p_device_id text,
  p_user_id uuid,
  p_ip inet DEFAULT NULL,
  p_metadata jsonb DEFAULT '{}'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_fp public.device_fingerprints%ROWTYPE;
  v_user_count integer;
BEGIN
  IF p_device_id IS NULL OR length(p_device_id) > 256 THEN
    RAISE EXCEPTION 'Invalid device_id';
  END IF;

  -- تسجيل الجهاز أو تحديثه، مع تتبع المستخدمين المميزين في metadata->'user_ids'
  INSERT INTO public.device_fingerprints (device_id, user_count, metadata)
  VALUES (
    p_device_id,
    CASE WHEN p_user_id IS NULL THEN 0 ELSE 1 END,
    CASE WHEN p_user_id IS NULL THEN p_metadata
         ELSE p_metadata || jsonb_build_object('user_ids', jsonb_build_array(p_user_id::text)) END
  )
  ON CONFLICT (device_id) DO UPDATE
    SET last_seen_at = now(),
        metadata = device_fingerprints.metadata || p_metadata
                   || jsonb_build_object(
                        'user_ids',
                        CASE WHEN device_fingerprints.metadata->'user_ids' ? p_user_id::text
                              THEN device_fingerprints.metadata->'user_ids'
                              ELSE coalesce(device_fingerprints.metadata->'user_ids', '[]'::jsonb)
                                   || jsonb_build_array(p_user_id::text)
                        END
                      ),
        updated_at = now()
  RETURNING * INTO v_fp;

  v_user_count := coalesce(jsonb_array_length(v_fp.metadata->'user_ids'), 0);

  UPDATE public.device_fingerprints
     SET user_count = v_user_count,
         updated_at = now()
   WHERE device_id = p_device_id
     AND user_count IS DISTINCT FROM v_user_count;

  -- إذا كان الجهاز يستخدمه أكثر من 5 مستخدمين، تسجيل حدث multiple_accounts
  IF v_user_count > 5 THEN
    PERFORM public.record_risk_event(
      'multiple_accounts',
      NULL,
      p_device_id,
      p_ip,
      CASE WHEN v_user_count > 20 THEN 'high' WHEN v_user_count > 10 THEN 'medium' ELSE 'low' END,
      'Device used by ' || v_user_count || ' different users',
      jsonb_build_object('user_count', v_user_count)
    );
  END IF;

  RETURN jsonb_build_object(
    'device_id', v_fp.device_id,
    'risk_score', v_fp.risk_score,
    'risk_level', v_fp.risk_level,
    'is_blocked', v_fp.is_blocked,
    'user_count', v_user_count
  );
END;
$fn$;

-- ---------- 6) get_risk_score — درجة الخطر المركبة ----------
CREATE OR REPLACE FUNCTION public.get_risk_score(
  p_user_id uuid DEFAULT NULL,
  p_device_id text DEFAULT NULL,
  p_ip inet DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_device_risk integer := 0;
  v_ip_risk integer := 0;
  v_recent_events integer := 0;
  v_final_score integer;
  v_recommendation text;
  v_device_blocked boolean := false;
  v_ip_blocked boolean := false;
BEGIN
  IF p_device_id IS NOT NULL THEN
    SELECT risk_score, is_blocked INTO v_device_risk, v_device_blocked
      FROM public.device_fingerprints WHERE device_id = p_device_id;
    IF NOT FOUND THEN
      v_device_risk := 0;
      v_device_blocked := false;
    END IF;
  END IF;

  IF p_ip IS NOT NULL THEN
    SELECT risk_score, is_blocked INTO v_ip_risk, v_ip_blocked
      FROM public.ip_reputation WHERE ip = p_ip;
    IF NOT FOUND THEN
      v_ip_risk := 0;
      v_ip_blocked := false;
    END IF;
  END IF;

  IF p_user_id IS NOT NULL THEN
    SELECT count(*) INTO v_recent_events
      FROM public.risk_events
     WHERE user_id = p_user_id
       AND created_at > now() - interval '24 hours'
       AND severity IN ('medium','high','critical');
  END IF;

  -- دمج الدرجات: جهاز 50% + IP 30% + أحداث حديثة 20%
  v_final_score := LEAST(100,
    (v_device_risk * 50 / 100) +
    (v_ip_risk * 30 / 100) +
    (LEAST(100, v_recent_events * 10) * 20 / 100)
  );

  IF v_device_blocked OR v_ip_blocked THEN
    v_recommendation := 'block';
    v_final_score := 100;
  ELSIF v_final_score >= 70 THEN
    v_recommendation := 'challenge';  -- طلب تحقق إضافي
  ELSIF v_final_score >= 40 THEN
    v_recommendation := 'monitor';    -- يسمح لكن يسجل للمراقبة
  ELSE
    v_recommendation := 'allow';
  END IF;

  RETURN jsonb_build_object(
    'score', v_final_score,
    'recommendation', v_recommendation,
    'components', jsonb_build_object(
      'device_score', v_device_risk,
      'device_blocked', v_device_blocked,
      'ip_score', v_ip_risk,
      'ip_blocked', v_ip_blocked,
      'recent_events_24h', v_recent_events
    )
  );
END;
$fn$;

-- ---------- 7) check_rate_limit — دالة حد الطلبات الأساسية ----------
CREATE OR REPLACE FUNCTION public.check_rate_limit(
  p_action text,
  p_identifier_type text,
  p_identifier_value text,
  p_window_seconds integer,
  p_max_requests integer,
  p_increment integer DEFAULT 1
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_bucket_key text := p_action || ':' || p_identifier_type || ':' || p_identifier_value;
  v_now timestamptz := clock_timestamp();
  v_count integer;
  v_allowed boolean;
  v_retry_after_ms integer;
BEGIN
  IF p_action IS NULL OR length(p_action) > 64
     OR p_identifier_type IS NULL
     OR p_identifier_type NOT IN ('user','ip','device','phone','email')
     OR p_identifier_value IS NULL OR length(p_identifier_value) > 256
     OR p_window_seconds NOT BETWEEN 1 AND 2592000
     OR p_max_requests NOT BETWEEN 1 AND 10000
     OR p_increment NOT BETWEEN 1 AND 100 THEN
    RAISE EXCEPTION 'Invalid rate limit parameters';
  END IF;

  INSERT INTO public.rate_limit_buckets (
    bucket_key, action, identifier_type, identifier_value,
    window_seconds, max_requests, request_count,
    window_started_at, updated_at
  ) VALUES (
    v_bucket_key, p_action, p_identifier_type, p_identifier_value,
    p_window_seconds, p_max_requests, p_increment,
    v_now, v_now
  )
  ON CONFLICT (bucket_key) DO UPDATE
    SET request_count = CASE
          WHEN rate_limit_buckets.window_started_at
               <= v_now - make_interval(secs => p_window_seconds) THEN p_increment
          ELSE rate_limit_buckets.request_count + p_increment
        END,
        window_started_at = CASE
          WHEN rate_limit_buckets.window_started_at
               <= v_now - make_interval(secs => p_window_seconds) THEN v_now
          ELSE rate_limit_buckets.window_started_at
        END,
        max_requests = GREATEST(rate_limit_buckets.max_requests, p_max_requests),
        window_seconds = GREATEST(rate_limit_buckets.window_seconds, p_window_seconds),
        updated_at = v_now
  RETURNING request_count INTO v_count;

  v_allowed := v_count <= p_max_requests;

  IF NOT v_allowed THEN
    SELECT (EXTRACT(EPOCH FROM (
      rate_limit_buckets.window_started_at + make_interval(secs => p_window_seconds) - v_now
    )) * 1000)::integer
      INTO v_retry_after_ms
      FROM public.rate_limit_buckets
     WHERE bucket_key = v_bucket_key;

    IF v_retry_after_ms IS NULL OR v_retry_after_ms < 0 THEN
      v_retry_after_ms := p_window_seconds * 1000;
    END IF;

    -- تسجيل حدث خطر (استدعاء موضعي)
    PERFORM public.record_risk_event(
      'rate_limit_exceeded',
      CASE WHEN p_identifier_type = 'user' THEN p_identifier_value::uuid ELSE NULL END,
      CASE WHEN p_identifier_type = 'device' THEN p_identifier_value ELSE NULL END,
      CASE WHEN p_identifier_type = 'ip' THEN p_identifier_value::inet ELSE NULL END,
      'medium',
      'Rate limit exceeded for action ' || p_action,
      jsonb_build_object('action', p_action, 'count', v_count,
                         'limit', p_max_requests, 'window_seconds', p_window_seconds)
    );
  ELSE
    v_retry_after_ms := 0;
  END IF;

  -- تنظيف احتمالي (1% من الاستدعاءات) للسجلات الأقدم من 30 يوماً
  IF random() < 0.01 THEN
    DELETE FROM public.rate_limit_buckets
     WHERE updated_at < v_now - interval '30 days';
  END IF;

  RETURN jsonb_build_object(
    'allowed', v_allowed,
    'count', v_count,
    'limit', p_max_requests,
    'window_seconds', p_window_seconds,
    'retry_after_ms', v_retry_after_ms
  );
END;
$fn$;

-- ---------- 8) دوال مختصرة ----------
CREATE OR REPLACE FUNCTION public.check_auth_rate_limit(
  p_action text,
  p_identifier_type text,
  p_identifier_value text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_window integer;
  v_limit integer;
BEGIN
  CASE p_action
    WHEN 'signup' THEN               v_window := 3600; v_limit := 3;
    WHEN 'login' THEN                v_window := 900;  v_limit := 5;
    WHEN 'otp_request' THEN          v_window := 3600; v_limit := 3;
    WHEN 'otp_verify' THEN           v_window := 900;  v_limit := 5;
    WHEN 'password_reset_req' THEN   v_window := 3600; v_limit := 2;
    WHEN 'password_reset_submit' THEN v_window := 3600; v_limit := 3;
    ELSE RAISE EXCEPTION 'Unknown auth action: %', p_action;
  END CASE;

  RETURN public.check_rate_limit(
    'auth_' || p_action, p_identifier_type, p_identifier_value, v_window, v_limit
  );
END;
$fn$;

CREATE OR REPLACE FUNCTION public.check_room_rate_limit(
  p_action text,
  p_user_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_window integer;
  v_limit integer;
BEGIN
  CASE p_action
    WHEN 'join' THEN       v_window := 60;   v_limit := 30;
    WHEN 'message' THEN    v_window := 60;   v_limit := 30;
    WHEN 'seat_claim' THEN v_window := 60;   v_limit := 10;
    WHEN 'mic_toggle' THEN v_window := 60;   v_limit := 20;
    ELSE RAISE EXCEPTION 'Unknown room action: %', p_action;
  END CASE;

  RETURN public.check_rate_limit(
    'room_' || p_action, 'user', p_user_id::text, v_window, v_limit
  );
END;
$fn$;

CREATE OR REPLACE FUNCTION public.check_social_rate_limit(
  p_action text,
  p_user_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_window integer;
  v_limit integer;
BEGIN
  CASE p_action
    WHEN 'private_message' THEN v_window := 60;   v_limit := 20;
    WHEN 'friend_request' THEN  v_window := 3600; v_limit := 20;
    WHEN 'follow' THEN          v_window := 3600; v_limit := 30;
    WHEN 'gift_send' THEN       v_window := 60;   v_limit := 10;
    ELSE RAISE EXCEPTION 'Unknown social action: %', p_action;
  END CASE;

  RETURN public.check_rate_limit(
    'social_' || p_action, 'user', p_user_id::text, v_window, v_limit
  );
END;
$fn$;

CREATE OR REPLACE FUNCTION public.check_financial_rate_limit(
  p_action text,
  p_user_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_window integer;
  v_limit integer;
BEGIN
  CASE p_action
    WHEN 'deposit_request' THEN    v_window := 3600; v_limit := 5;
    WHEN 'withdrawal_request' THEN v_window := 3600; v_limit := 3;
    ELSE RAISE EXCEPTION 'Unknown financial action: %', p_action;
  END CASE;

  RETURN public.check_rate_limit(
    'financial_' || p_action, 'user', p_user_id::text, v_window, v_limit
  );
END;
$fn$;

CREATE OR REPLACE FUNCTION public.check_game_rate_limit(
  p_action text,
  p_user_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
BEGIN
  RETURN public.check_rate_limit(
    'game_' || p_action, 'user', p_user_id::text, 60, 60
  );
END;
$fn$;

-- ---------- 9) منح التنفيذ ----------
-- دوال الحد: متاحة للمستخدمين المسجلين و service_role
-- دوال المخاطر: service_role فقط (تُستدعى من الدوال السحابية)
REVOKE ALL ON FUNCTION public.check_rate_limit(text,text,text,integer,integer,integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.check_auth_rate_limit(text,text,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.check_room_rate_limit(text,uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.check_social_rate_limit(text,uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.check_financial_rate_limit(text,uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.check_game_rate_limit(text,uuid) FROM PUBLIC;
-- دوال المخاطر: service_role فقط — سحب صريح من anon وauthenticated
-- (لأن DEFAULT PRIVILEGES من #46 تمنح authenticated تنفيذاً تلقائياً عند الإنشاء)
REVOKE ALL ON FUNCTION public.record_risk_event(text,uuid,text,inet,text,text,jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.register_device_fingerprint(text,uuid,inet,jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.get_risk_score(uuid,text,inet) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.check_rate_limit(text,text,text,integer,integer,integer) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.check_auth_rate_limit(text,text,text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.check_room_rate_limit(text,uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.check_social_rate_limit(text,uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.check_financial_rate_limit(text,uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.check_game_rate_limit(text,uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.record_risk_event(text,uuid,text,inet,text,text,jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.register_device_fingerprint(text,uuid,inet,jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.get_risk_score(uuid,text,inet) TO service_role;

COMMIT;
