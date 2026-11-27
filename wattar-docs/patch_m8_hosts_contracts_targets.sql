-- ============================================================
-- patch_m8_hosts_contracts_targets.sql  (Migration #74)
-- M8.1 اعتماد المضيفات (مستقل + وكالة) + هوية قبل السحب
-- M8.2 عقود المضيفات (عام/وكالة/مضيفة) + سجل تاريخي + لا أثر رجعي
-- M8.3 أهداف شهرية + مكافآت منفصلة محاسبياً
--
-- يعتمد على patch_m8_enum_prep.sql (قيم wallet_tx_type و audit_action_type).
-- كل الدوال الإدارية تُستدعى من اللوحة بجلسة المدير (auth.uid) أو من
-- Edge Functions بـ service_role، وتتحقق من الصلاحية عبر admin_staff_can.
-- ============================================================
BEGIN;

SELECT set_config('request.jwt.claims', jsonb_build_object('role', 'service_role')::text, false);

-- ============================================================
-- 1) مستندات المضيفات + سجل أحداث الطلب
-- ============================================================
CREATE TABLE IF NOT EXISTS public.host_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  application_id uuid REFERENCES public.host_applications(id) ON DELETE SET NULL,
  doc_type text NOT NULL CHECK (doc_type IN ('id_card', 'passport', 'selfie', 'video', 'other')),
  file_path text NOT NULL CHECK (char_length(btrim(file_path)) BETWEEN 3 AND 500),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  review_note text,
  reviewed_by uuid REFERENCES public.users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  reviewed_at timestamptz
);
CREATE INDEX IF NOT EXISTS host_documents_user_created
  ON public.host_documents (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS host_documents_status
  ON public.host_documents (status, created_at DESC);
ALTER TABLE public.host_documents ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.host_documents FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.host_documents TO authenticated;

DROP POLICY IF EXISTS host_documents_owner_admin_select ON public.host_documents;
CREATE POLICY host_documents_owner_admin_select ON public.host_documents
  FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.is_admin());

CREATE TABLE IF NOT EXISTS public.host_application_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  application_id uuid NOT NULL REFERENCES public.host_applications(id) ON DELETE CASCADE,
  actor_id uuid REFERENCES public.users(id) ON DELETE SET NULL,
  event_type text NOT NULL CHECK (event_type IN (
    'submitted', 'info_requested', 'document_uploaded', 'document_reviewed',
    'approved', 'rejected', 'withdrawn', 'agency_nominated', 'revoked'
  )),
  note text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS host_application_events_app_created
  ON public.host_application_events (application_id, created_at DESC);
ALTER TABLE public.host_application_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.host_application_events FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.host_application_events TO authenticated;

DROP POLICY IF EXISTS host_application_events_owner_admin_select ON public.host_application_events;
CREATE POLICY host_application_events_owner_admin_select ON public.host_application_events
  FOR SELECT TO authenticated
  USING (
    public.is_admin()
    OR EXISTS (
      SELECT 1 FROM public.host_applications a
      WHERE a.id = host_application_events.application_id AND a.user_id = auth.uid()
    )
  );

-- ============================================================
-- 2) توسيع طلبات المضيفات: المصدر + الوكالة + حالة الهوية
-- ============================================================
ALTER TABLE public.host_applications
  ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'independent',
  ADD COLUMN IF NOT EXISTS agency_id uuid REFERENCES public.agencies(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS nominated_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS info_requested_at timestamptz,
  ADD COLUMN IF NOT EXISTS withdrawn_at timestamptz;

ALTER TABLE public.host_applications
  DROP CONSTRAINT IF EXISTS host_applications_status_check;
ALTER TABLE public.host_applications
  ADD CONSTRAINT host_applications_status_check
  CHECK (status IN ('pending', 'info_requested', 'approved', 'rejected', 'withdrawn'));

ALTER TABLE public.host_applications
  DROP CONSTRAINT IF EXISTS host_applications_source_check;
ALTER TABLE public.host_applications
  ADD CONSTRAINT host_applications_source_check
  CHECK (source IN ('independent', 'agency'));

ALTER TABLE public.host_applications
  DROP CONSTRAINT IF EXISTS host_applications_agency_source_check;
ALTER TABLE public.host_applications
  ADD CONSTRAINT host_applications_agency_source_check
  CHECK (
    (source = 'independent' AND agency_id IS NULL)
    OR (source = 'agency' AND agency_id IS NOT NULL)
  );

DROP INDEX IF EXISTS public.host_applications_one_pending_per_user;
CREATE UNIQUE INDEX host_applications_one_open_per_user
  ON public.host_applications (user_id)
  WHERE status IN ('pending', 'info_requested');

-- ============================================================
-- 3) توسيع المضيفات الموثقات: الهوية + الوكالة + الإيقاف/السحب
-- ============================================================
ALTER TABLE public.verified_hosts
  ADD COLUMN IF NOT EXISTS identity_status text NOT NULL DEFAULT 'unverified',
  ADD COLUMN IF NOT EXISTS identity_verified_at timestamptz,
  ADD COLUMN IF NOT EXISTS identity_verified_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS identity_document_type text,
  ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'independent',
  ADD COLUMN IF NOT EXISTS agency_id uuid REFERENCES public.agencies(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS suspended_at timestamptz,
  ADD COLUMN IF NOT EXISTS suspended_reason text,
  ADD COLUMN IF NOT EXISTS revoked_at timestamptz,
  ADD COLUMN IF NOT EXISTS revoked_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS revoked_reason text;

ALTER TABLE public.verified_hosts
  DROP CONSTRAINT IF EXISTS verified_hosts_status_check;
ALTER TABLE public.verified_hosts
  ADD CONSTRAINT verified_hosts_status_check
  CHECK (status IN ('pending', 'active', 'suspended', 'revoked'));

ALTER TABLE public.verified_hosts
  DROP CONSTRAINT IF EXISTS verified_hosts_identity_status_check;
ALTER TABLE public.verified_hosts
  ADD CONSTRAINT verified_hosts_identity_status_check
  CHECK (identity_status IN ('unverified', 'pending', 'verified', 'rejected'));

ALTER TABLE public.verified_hosts
  DROP CONSTRAINT IF EXISTS verified_hosts_source_check;
ALTER TABLE public.verified_hosts
  ADD CONSTRAINT verified_hosts_source_check
  CHECK (source IN ('independent', 'agency', 'admin'));

ALTER TABLE public.verified_hosts
  DROP CONSTRAINT IF EXISTS verified_hosts_agency_source_check;
ALTER TABLE public.verified_hosts
  ADD CONSTRAINT verified_hosts_agency_source_check
  CHECK ((source = 'agency' AND agency_id IS NOT NULL) OR source <> 'agency');

-- ============================================================
-- 4) العقود: عام / وكالة / مضيفة + سجل تاريخي
-- ============================================================
CREATE TABLE IF NOT EXISTS public.host_contracts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scope text NOT NULL CHECK (scope IN ('global', 'agency', 'host')),
  agency_id uuid REFERENCES public.agencies(id) ON DELETE RESTRICT,
  host_user_id uuid REFERENCES public.users(id) ON DELETE RESTRICT,
  title text NOT NULL CHECK (char_length(btrim(title)) BETWEEN 2 AND 120),
  profit_share_percent numeric(5,2) NOT NULL DEFAULT 0 CHECK (profit_share_percent BETWEEN 0 AND 100),
  platform_commission_percent numeric(5,2) NOT NULL DEFAULT 0 CHECK (platform_commission_percent BETWEEN 0 AND 100),
  agent_commission_percent numeric(5,2) NOT NULL DEFAULT 0 CHECK (agent_commission_percent BETWEEN 0 AND 100),
  targets jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(targets) = 'object'),
  rewards jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(rewards) = 'object'),
  starts_at timestamptz NOT NULL DEFAULT now(),
  ends_at timestamptz,
  auto_renew boolean NOT NULL DEFAULT false,
  renewal_notice_days integer NOT NULL DEFAULT 7 CHECK (renewal_notice_days BETWEEN 0 AND 90),
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'active', 'suspended', 'terminated', 'expired')),
  version integer NOT NULL DEFAULT 1 CHECK (version >= 1),
  parent_contract_id uuid REFERENCES public.host_contracts(id) ON DELETE SET NULL,
  created_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  approved_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  terminated_at timestamptz,
  termination_reason text,
  CONSTRAINT host_contracts_scope_refs CHECK (
    (scope = 'global' AND agency_id IS NULL AND host_user_id IS NULL)
    OR (scope = 'agency' AND agency_id IS NOT NULL AND host_user_id IS NULL)
    OR (scope = 'host' AND host_user_id IS NOT NULL AND agency_id IS NULL)
  ),
  CONSTRAINT host_contracts_commission_sum CHECK (
    platform_commission_percent + agent_commission_percent <= 100
  ),
  CONSTRAINT host_contracts_period_valid CHECK (ends_at IS NULL OR ends_at > starts_at)
);
CREATE INDEX IF NOT EXISTS host_contracts_scope_status
  ON public.host_contracts (scope, status, starts_at DESC);
CREATE INDEX IF NOT EXISTS host_contracts_agency
  ON public.host_contracts (agency_id, starts_at DESC) WHERE agency_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS host_contracts_host
  ON public.host_contracts (host_user_id, starts_at DESC) WHERE host_user_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS host_contracts_one_active_global
  ON public.host_contracts (scope) WHERE status = 'active' AND scope = 'global';
CREATE UNIQUE INDEX IF NOT EXISTS host_contracts_one_active_agency
  ON public.host_contracts (agency_id) WHERE status = 'active' AND scope = 'agency';
CREATE UNIQUE INDEX IF NOT EXISTS host_contracts_one_active_host
  ON public.host_contracts (host_user_id) WHERE status = 'active' AND scope = 'host';

ALTER TABLE public.host_contracts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.host_contracts FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.host_contracts TO authenticated;

DROP POLICY IF EXISTS host_contracts_read ON public.host_contracts;
CREATE POLICY host_contracts_read ON public.host_contracts
  FOR SELECT TO authenticated
  USING (
    public.is_admin()
    OR host_user_id = auth.uid()
    OR (
      scope = 'agency'
      AND EXISTS (SELECT 1 FROM public.agencies a WHERE a.id = host_contracts.agency_id AND a.owner_user_id = auth.uid())
    )
  );

CREATE TABLE IF NOT EXISTS public.host_contract_history (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  contract_id uuid NOT NULL REFERENCES public.host_contracts(id) ON DELETE CASCADE,
  action text NOT NULL CHECK (action IN ('created', 'updated', 'versioned', 'status_changed')),
  before jsonb,
  after jsonb,
  actor_id uuid REFERENCES public.users(id) ON DELETE SET NULL,
  reason text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS host_contract_history_contract
  ON public.host_contract_history (contract_id, created_at DESC);
ALTER TABLE public.host_contract_history ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.host_contract_history FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.host_contract_history TO authenticated;

DROP POLICY IF EXISTS host_contract_history_read ON public.host_contract_history;
CREATE POLICY host_contract_history_read ON public.host_contract_history
  FOR SELECT TO authenticated
  USING (
    public.is_admin()
    OR EXISTS (
      SELECT 1 FROM public.host_contracts c
      WHERE c.id = host_contract_history.contract_id
        AND (
          c.host_user_id = auth.uid()
          OR (c.scope = 'agency' AND EXISTS (
            SELECT 1 FROM public.agencies a WHERE a.id = c.agency_id AND a.owner_user_id = auth.uid()
          ))
        )
    )
  );

CREATE OR REPLACE FUNCTION public.host_contract_history_trigger()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.host_contract_history (contract_id, action, before, after, actor_id, reason)
    VALUES (NEW.id, 'created', NULL, to_jsonb(NEW), NEW.created_by, NEW.termination_reason);
  ELSE
    INSERT INTO public.host_contract_history (contract_id, action, before, after, actor_id, reason)
    VALUES (
      NEW.id,
      CASE WHEN NEW.status IS DISTINCT FROM OLD.status THEN 'status_changed' ELSE 'updated' END,
      to_jsonb(OLD), to_jsonb(NEW),
      coalesce(NEW.approved_by, NEW.created_by),
      NEW.termination_reason
    );
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.host_contract_history_trigger() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS host_contracts_history_trg ON public.host_contracts;
CREATE TRIGGER host_contracts_history_trg
  AFTER INSERT OR UPDATE ON public.host_contracts
  FOR EACH ROW EXECUTE FUNCTION public.host_contract_history_trigger();

-- ============================================================
-- 5) الأهداف الشهرية + المكافآت + جلسات البث
-- ============================================================
CREATE TABLE IF NOT EXISTS public.host_targets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  period_month date NOT NULL CHECK (period_month = date_trunc('month', period_month)::date),
  scope text NOT NULL CHECK (scope IN ('host', 'agency', 'level')),
  host_user_id uuid REFERENCES public.users(id) ON DELETE RESTRICT,
  agency_id uuid REFERENCES public.agencies(id) ON DELETE RESTRICT,
  level integer CHECK (level BETWEEN 1 AND 100),
  metric text NOT NULL CHECK (metric IN ('stream_hours', 'active_days', 'gift_value', 'attendance_days', 'other')),
  target_value numeric(14,2) NOT NULL CHECK (target_value > 0),
  reward_type text NOT NULL DEFAULT 'coin' CHECK (reward_type IN ('coin', 'diamond', 'cosmetic')),
  reward_amount numeric(14,2) NOT NULL DEFAULT 0 CHECK (reward_amount >= 0),
  reward_metadata jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(reward_metadata) = 'object'),
  is_active boolean NOT NULL DEFAULT true,
  created_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT host_targets_scope_refs CHECK (
    (scope = 'host' AND host_user_id IS NOT NULL AND agency_id IS NULL AND level IS NULL)
    OR (scope = 'agency' AND agency_id IS NOT NULL AND host_user_id IS NULL AND level IS NULL)
    OR (scope = 'level' AND level IS NOT NULL AND host_user_id IS NULL AND agency_id IS NULL)
  )
);
CREATE UNIQUE INDEX IF NOT EXISTS host_targets_unique_host
  ON public.host_targets (period_month, metric, host_user_id) WHERE scope = 'host';
CREATE UNIQUE INDEX IF NOT EXISTS host_targets_unique_agency
  ON public.host_targets (period_month, metric, agency_id) WHERE scope = 'agency';
CREATE UNIQUE INDEX IF NOT EXISTS host_targets_unique_level
  ON public.host_targets (period_month, metric, level) WHERE scope = 'level';
CREATE INDEX IF NOT EXISTS host_targets_month
  ON public.host_targets (period_month, is_active);

ALTER TABLE public.host_targets ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.host_targets FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.host_targets TO authenticated;

DROP POLICY IF EXISTS host_targets_read ON public.host_targets;
CREATE POLICY host_targets_read ON public.host_targets
  FOR SELECT TO authenticated
  USING (
    public.is_admin()
    OR host_user_id = auth.uid()
    OR (scope = 'agency' AND EXISTS (
      SELECT 1 FROM public.agencies a WHERE a.id = host_targets.agency_id AND a.owner_user_id = auth.uid()
    ))
  );

CREATE TABLE IF NOT EXISTS public.host_target_awards (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  target_id uuid NOT NULL REFERENCES public.host_targets(id) ON DELETE RESTRICT,
  host_user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  period_month date NOT NULL,
  metric text NOT NULL,
  target_value numeric(14,2) NOT NULL,
  achieved_value numeric(14,2) NOT NULL,
  reward_type text NOT NULL,
  reward_amount numeric(14,2) NOT NULL DEFAULT 0,
  wallet_transaction_id uuid REFERENCES public.wallet_transactions(id) ON DELETE RESTRICT,
  awarded_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  awarded_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT host_target_awards_once UNIQUE (target_id, host_user_id, period_month)
);
CREATE INDEX IF NOT EXISTS host_target_awards_host
  ON public.host_target_awards (host_user_id, period_month DESC);
ALTER TABLE public.host_target_awards ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.host_target_awards FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.host_target_awards TO authenticated;

DROP POLICY IF EXISTS host_target_awards_read ON public.host_target_awards;
CREATE POLICY host_target_awards_read ON public.host_target_awards
  FOR SELECT TO authenticated
  USING (host_user_id = auth.uid() OR public.is_admin());

CREATE TABLE IF NOT EXISTS public.host_activity_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  room_id uuid NOT NULL REFERENCES public.rooms(id) ON DELETE CASCADE,
  session_id text NOT NULL CHECK (session_id ~ '^[A-Za-z0-9._:-]{8,100}$'),
  started_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  ended_at timestamptz,
  minutes integer CHECK (minutes IS NULL OR minutes >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT host_activity_sessions_unique UNIQUE (user_id, room_id, session_id)
);
CREATE INDEX IF NOT EXISTS host_activity_sessions_user_time
  ON public.host_activity_sessions (user_id, started_at DESC);
ALTER TABLE public.host_activity_sessions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.host_activity_sessions FROM PUBLIC, anon, authenticated;

-- ============================================================
-- 6) إعدادات وكتالوج صلاحيات M8
-- ============================================================
INSERT INTO public.admin_settings (key, value, description, is_public)
VALUES
  ('host_target_active_day_min_minutes', '60'::jsonb, 'الحد الأدنى لدقائق البث لاحتساب يوم نشاط للمضيفة', false),
  ('agency_host_auto_approve', 'false'::jsonb, 'هل تعتمد الوكالة المضيفة مباشرة عند ترشيحها ضمن صلاحياتها', false),
  ('host_identity_required_for_withdrawal', 'true'::jsonb, 'منع سحب المضيفة قبل التحقق من هويتها', false)
ON CONFLICT (key) DO NOTHING;

-- M8: توسيع أنواع الإشعارات المسموحة (القيد الحي من patch_moderation_core.sql)
ALTER TABLE public.user_notifications
  DROP CONSTRAINT IF EXISTS user_notifications_event_type_check;
ALTER TABLE public.user_notifications
  ADD CONSTRAINT user_notifications_event_type_check CHECK (
    event_type = ANY (ARRAY[
      'friend_request', 'friend_accepted', 'private_message', 'room_invitation',
      'new_follower', 'gift_received', 'deposit_update', 'withdrawal_update',
      'host_update', 'membership_update', 'host_earning', 'support_reply',
      'moderation_penalty', 'moderation_appeal',
      'host_application', 'host_status', 'host_target', 'host_contract',
      'vip_purchase', 'protection_purchase', 'level_up', 'loyalty_streak'
    ]::text[])
  );

INSERT INTO public.admin_permission_catalog (permission, category, description)
VALUES
  ('hosts.contracts.view', 'المضيفات', 'عرض عقود المضيفات'),
  ('hosts.contracts.manage', 'المضيفات', 'إنشاء وتعديل عقود المضيفات'),
  ('hosts.targets.view', 'المضيفات', 'عرض أهداف المضيفات وتقدمها'),
  ('hosts.targets.manage', 'المضيفات', 'إدارة أهداف المضيفات وصرف مكافآتها'),
  ('hosts.identity.manage', 'المضيفات', 'مراجعة مستندات هوية المضيفات والتحقق منها'),
  ('vip.view', 'الاقتصاد', 'عرض درجات VIP'),
  ('vip.manage', 'الاقتصاد', 'إدارة درجات VIP وأسعارها ومزاياها'),
  ('protection.view', 'الاقتصاد', 'عرض أدوات الحماية المدفوعة'),
  ('protection.manage', 'الاقتصاد', 'إدارة أدوات الحماية وأسعارها'),
  ('levels.view', 'الاقتصاد', 'عرض إعدادات المستويات والخبرة'),
  ('levels.manage', 'الاقتصاد', 'إدارة منحنى الخبرة والمستويات'),
  ('loyalty.view', 'الاقتصاد', 'عرض نقاط الولاء'),
  ('loyalty.manage', 'الاقتصاد', 'إدارة نقاط الولاء')
ON CONFLICT (permission) DO NOTHING;

INSERT INTO public.admin_role_permissions (staff_role, permission, allowed)
SELECT r.staff_role, p.permission, true
FROM (VALUES
  ('super_admin'::public.admin_staff_role, 'hosts.contracts.view'),
  ('super_admin', 'hosts.contracts.manage'),
  ('super_admin', 'hosts.targets.view'),
  ('super_admin', 'hosts.targets.manage'),
  ('super_admin', 'hosts.identity.manage'),
  ('super_admin', 'vip.view'),
  ('super_admin', 'vip.manage'),
  ('super_admin', 'protection.view'),
  ('super_admin', 'protection.manage'),
  ('super_admin', 'levels.view'),
  ('super_admin', 'levels.manage'),
  ('super_admin', 'loyalty.view'),
  ('super_admin', 'loyalty.manage'),
  ('operations', 'hosts.contracts.view'),
  ('operations', 'hosts.targets.view'),
  ('operations', 'hosts.targets.manage'),
  ('operations', 'hosts.identity.manage'),
  ('operations', 'vip.view'),
  ('operations', 'vip.manage'),
  ('operations', 'protection.view'),
  ('operations', 'protection.manage'),
  ('operations', 'levels.view'),
  ('operations', 'levels.manage'),
  ('operations', 'loyalty.view'),
  ('operations', 'loyalty.manage'),
  ('finance', 'hosts.contracts.view'),
  ('finance', 'hosts.contracts.manage'),
  ('finance', 'hosts.targets.view'),
  ('finance', 'hosts.targets.manage'),
  ('finance', 'vip.view'),
  ('finance', 'protection.view'),
  ('finance', 'levels.view'),
  ('finance', 'loyalty.view'),
  ('moderator', 'hosts.identity.manage'),
  ('moderator', 'vip.view'),
  ('moderator', 'protection.view'),
  ('moderator', 'levels.view'),
  ('support', 'vip.view'),
  ('support', 'protection.view')
) AS r(staff_role, permission)
JOIN public.admin_permission_catalog p ON p.permission = r.permission
ON CONFLICT (staff_role, permission) DO NOTHING;

-- ============================================================
-- 7) دوال M8.1 — مراجعة الطلب والمستندات والهوية
-- ============================================================
CREATE OR REPLACE FUNCTION public.admin_request_host_documents(
  p_admin_id uuid,
  p_application_id uuid,
  p_note text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_admin public.users%ROWTYPE;
  v_app public.host_applications%ROWTYPE;
  v_note text := nullif(btrim(p_note), '');
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    IF auth.uid() IS NULL OR auth.uid() IS DISTINCT FROM p_admin_id
       OR NOT public.admin_staff_can(p_admin_id, 'hosts.applications.manage') THEN
      RAISE EXCEPTION 'غير مصرح بطلب مستندات المضيفة';
    END IF;
  END IF;
  IF p_admin_id IS NULL OR p_application_id IS NULL OR v_note IS NULL
     OR char_length(v_note) > 500 THEN
    RAISE EXCEPTION 'أدخل سبب طلب المستندات (حتى 500 حرف)';
  END IF;

  SELECT * INTO v_admin FROM public.users WHERE id = p_admin_id FOR UPDATE;
  IF NOT FOUND OR v_admin.status <> 'active' OR v_admin.role NOT IN ('admin', 'super_admin') THEN
    RAISE EXCEPTION 'الحساب الإداري غير نشط';
  END IF;

  SELECT * INTO v_app FROM public.host_applications WHERE id = p_application_id FOR UPDATE;
  IF NOT FOUND OR v_app.status NOT IN ('pending', 'info_requested') THEN
    RAISE EXCEPTION 'الطلب غير موجود أو لم يعد قابلاً لطلب المستندات';
  END IF;

  UPDATE public.host_applications
  SET status = 'info_requested', info_requested_at = now(), review_note = v_note
  WHERE id = p_application_id;

  INSERT INTO public.host_application_events (application_id, actor_id, event_type, note)
  VALUES (p_application_id, p_admin_id, 'info_requested', v_note);

  INSERT INTO public.user_notifications (user_id, actor_id, event_type, reference_id, title, body, route)
  VALUES (
    v_app.user_id, p_admin_id, 'host_application', p_application_id,
    'مستندات إضافية مطلوبة', v_note, '/host-application'
  );

  INSERT INTO public.admin_audit_log (admin_id, action, target_type, target_id, before, after, metadata)
  VALUES (
    p_admin_id, 'request_info'::public.audit_action_type, 'host_application', p_application_id,
    jsonb_build_object('status', v_app.status),
    jsonb_build_object('status', 'info_requested'),
    jsonb_build_object('note', v_note)
  );

  RETURN jsonb_build_object('application_id', p_application_id, 'status', 'info_requested');
END;
$$;
REVOKE ALL ON FUNCTION public.admin_request_host_documents(uuid, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_request_host_documents(uuid, uuid, text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.admin_review_host_document(
  p_admin_id uuid,
  p_document_id uuid,
  p_approve boolean,
  p_note text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_admin public.users%ROWTYPE;
  v_doc public.host_documents%ROWTYPE;
  v_note text := nullif(btrim(p_note), '');
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    IF auth.uid() IS NULL OR auth.uid() IS DISTINCT FROM p_admin_id
       OR NOT public.admin_staff_can(p_admin_id, 'hosts.identity.manage') THEN
      RAISE EXCEPTION 'غير مصرح بمراجعة مستندات الهوية';
    END IF;
  END IF;
  IF p_admin_id IS NULL OR p_document_id IS NULL OR p_approve IS NULL
     OR (v_note IS NOT NULL AND char_length(v_note) > 500) THEN
    RAISE EXCEPTION 'بيانات مراجعة المستند غير مكتملة';
  END IF;

  SELECT * INTO v_admin FROM public.users WHERE id = p_admin_id FOR UPDATE;
  IF NOT FOUND OR v_admin.status <> 'active' OR v_admin.role NOT IN ('admin', 'super_admin') THEN
    RAISE EXCEPTION 'الحساب الإداري غير نشط';
  END IF;

  SELECT * INTO v_doc FROM public.host_documents WHERE id = p_document_id FOR UPDATE;
  IF NOT FOUND OR v_doc.status <> 'pending' THEN
    RAISE EXCEPTION 'المستند غير موجود أو تمت مراجعته';
  END IF;

  UPDATE public.host_documents
  SET status = CASE WHEN p_approve THEN 'approved' ELSE 'rejected' END,
      review_note = v_note,
      reviewed_by = p_admin_id,
      reviewed_at = now()
  WHERE id = p_document_id;

  IF v_doc.application_id IS NOT NULL THEN
    INSERT INTO public.host_application_events (application_id, actor_id, event_type, note)
    VALUES (v_doc.application_id, p_admin_id, 'document_reviewed',
      CASE WHEN p_approve THEN 'اعتُمد مستند: ' ELSE 'رُفض مستند: ' END || v_doc.doc_type
      || coalesce(' — ' || v_note, ''));
  END IF;

  INSERT INTO public.admin_audit_log (admin_id, action, target_type, target_id, before, after, metadata)
  VALUES (
    p_admin_id,
    CASE WHEN p_approve THEN 'approve'::public.audit_action_type ELSE 'reject'::public.audit_action_type END,
    'host_document', p_document_id,
    jsonb_build_object('status', v_doc.status, 'doc_type', v_doc.doc_type),
    jsonb_build_object('status', CASE WHEN p_approve THEN 'approved' ELSE 'rejected' END),
    jsonb_build_object('user_id', v_doc.user_id, 'note', v_note)
  );

  RETURN jsonb_build_object('document_id', p_document_id,
    'status', CASE WHEN p_approve THEN 'approved' ELSE 'rejected' END);
END;
$$;
REVOKE ALL ON FUNCTION public.admin_review_host_document(uuid, uuid, boolean, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_review_host_document(uuid, uuid, boolean, text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.admin_verify_host_identity(
  p_admin_id uuid,
  p_user_id uuid,
  p_approve boolean,
  p_document_id uuid,
  p_note text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_admin public.users%ROWTYPE;
  v_host public.verified_hosts%ROWTYPE;
  v_doc public.host_documents%ROWTYPE;
  v_note text := nullif(btrim(p_note), '');
  v_before text;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    IF auth.uid() IS NULL OR auth.uid() IS DISTINCT FROM p_admin_id
       OR NOT public.admin_staff_can(p_admin_id, 'hosts.identity.manage') THEN
      RAISE EXCEPTION 'غير مصرح بالتحقق من هوية المضيفة';
    END IF;
  END IF;
  IF p_admin_id IS NULL OR p_user_id IS NULL OR p_approve IS NULL
     OR (v_note IS NOT NULL AND char_length(v_note) > 500) THEN
    RAISE EXCEPTION 'بيانات التحقق من الهوية غير مكتملة';
  END IF;

  SELECT * INTO v_admin FROM public.users WHERE id = p_admin_id FOR UPDATE;
  IF NOT FOUND OR v_admin.status <> 'active' OR v_admin.role NOT IN ('admin', 'super_admin') THEN
    RAISE EXCEPTION 'الحساب الإداري غير نشط';
  END IF;

  SELECT * INTO v_host FROM public.verified_hosts WHERE user_id = p_user_id FOR UPDATE;
  IF NOT FOUND OR v_host.status = 'revoked' THEN
    RAISE EXCEPTION 'لا توجد مضيفة قابلة للتحقق';
  END IF;
  v_before := v_host.identity_status;

  IF p_approve THEN
    IF p_document_id IS NULL THEN
      RAISE EXCEPTION 'اختر مستند الهوية المعتمد';
    END IF;
    SELECT * INTO v_doc FROM public.host_documents WHERE id = p_document_id FOR UPDATE;
    IF NOT FOUND OR v_doc.user_id <> p_user_id OR v_doc.status <> 'approved'
       OR v_doc.doc_type NOT IN ('id_card', 'passport') THEN
      RAISE EXCEPTION 'يجب اعتماد مستند هوية رسمي (بطاقة/جواز) قبل التحقق';
    END IF;

    UPDATE public.verified_hosts
    SET identity_status = 'verified',
        identity_verified_at = now(),
        identity_verified_by = p_admin_id,
        identity_document_type = v_doc.doc_type
    WHERE user_id = p_user_id;
  ELSE
    UPDATE public.verified_hosts
    SET identity_status = 'rejected',
        identity_verified_at = NULL,
        identity_verified_by = p_admin_id
    WHERE user_id = p_user_id;
  END IF;

  INSERT INTO public.admin_audit_log (admin_id, action, target_type, target_id, before, after, metadata)
  VALUES (
    p_admin_id,
    CASE WHEN p_approve THEN 'approve'::public.audit_action_type ELSE 'reject'::public.audit_action_type END,
    'host_identity', p_user_id,
    jsonb_build_object('identity_status', v_before),
    jsonb_build_object('identity_status', CASE WHEN p_approve THEN 'verified' ELSE 'rejected' END),
    jsonb_build_object('document_id', p_document_id, 'note', v_note)
  );

  INSERT INTO public.user_notifications (user_id, actor_id, event_type, reference_id, title, body, route)
  VALUES (
    p_user_id, p_admin_id, 'host_status', p_user_id,
    CASE WHEN p_approve THEN 'تم التحقق من هويتك' ELSE 'لم يُقبل مستند الهوية' END,
    coalesce(v_note, CASE WHEN p_approve THEN 'أصبح بإمكانك تفعيل السحب بعد استيفاء الشروط.' ELSE 'يرجى رفع مستند واضح وإعادة المحاولة.' END),
    '/host-application'
  );

  RETURN jsonb_build_object('user_id', p_user_id,
    'identity_status', CASE WHEN p_approve THEN 'verified' ELSE 'rejected' END);
END;
$$;
REVOKE ALL ON FUNCTION public.admin_verify_host_identity(uuid, uuid, boolean, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_verify_host_identity(uuid, uuid, boolean, uuid, text) TO authenticated, service_role;

-- ============================================================
-- 8) مراجعة طلب الاعتماد (مستقل/وكالة) — تحديث الدالة القائمة
-- ============================================================
CREATE OR REPLACE FUNCTION public.admin_review_host_application(
  p_admin_id uuid,
  p_application_id uuid,
  p_approve boolean,
  p_review_note text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_admin public.users%ROWTYPE;
  v_application public.host_applications%ROWTYPE;
  v_user public.users%ROWTYPE;
  v_note text := nullif(btrim(p_review_note), '');
  v_status text;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    IF auth.uid() IS NULL OR auth.uid() IS DISTINCT FROM p_admin_id
       OR NOT public.admin_staff_can(p_admin_id, 'hosts.applications.manage') THEN
      RAISE EXCEPTION 'غير مصرح بمراجعة طلبات المضيفات';
    END IF;
  END IF;
  IF p_admin_id IS NULL OR p_application_id IS NULL OR p_approve IS NULL THEN
    RAISE EXCEPTION 'بيانات مراجعة الطلب غير مكتملة';
  END IF;
  IF (NOT p_approve AND v_note IS NULL)
     OR (v_note IS NOT NULL AND char_length(v_note) > 500) THEN
    RAISE EXCEPTION 'أدخل سببًا للرفض لا يتجاوز 500 حرف';
  END IF;

  SELECT * INTO v_admin FROM public.users WHERE id = p_admin_id FOR UPDATE;
  IF NOT FOUND OR v_admin.status <> 'active' OR v_admin.role NOT IN ('admin', 'super_admin') THEN
    RAISE EXCEPTION 'لا تملك صلاحية مراجعة الطلبات';
  END IF;

  SELECT * INTO v_application FROM public.host_applications WHERE id = p_application_id FOR UPDATE;
  IF NOT FOUND OR v_application.status NOT IN ('pending', 'info_requested') THEN
    RAISE EXCEPTION 'الطلب غير موجود أو تمت مراجعته مسبقًا';
  END IF;

  SELECT * INTO v_user FROM public.users WHERE id = v_application.user_id FOR UPDATE;
  IF NOT FOUND OR v_user.status <> 'active' OR v_user.role <> 'user' THEN
    RAISE EXCEPTION 'حساب المتقدمة غير نشط';
  END IF;

  IF p_approve
     AND (v_user.adult_confirmed_at IS NULL OR v_user.onboarding_completed_at IS NULL) THEN
    RAISE EXCEPTION 'لا يمكن اعتماد التوثيق قبل تأكيد العمر وإكمال الملف الشخصي';
  END IF;

  v_status := CASE WHEN p_approve THEN 'approved' ELSE 'rejected' END;
  UPDATE public.host_applications
  SET status = v_status,
      review_note = v_note,
      reviewed_by = p_admin_id,
      reviewed_at = now()
  WHERE id = p_application_id;

  IF p_approve THEN
    INSERT INTO public.verified_hosts (
      user_id, status, approved_by, approved_at, source, agency_id, identity_status
    )
    VALUES (
      v_user.id, 'active', p_admin_id, now(),
      coalesce(v_application.source, 'independent'), v_application.agency_id, 'unverified'
    )
    ON CONFLICT (user_id) DO UPDATE
      SET status = 'active',
          approved_by = EXCLUDED.approved_by,
          approved_at = EXCLUDED.approved_at,
          source = EXCLUDED.source,
          agency_id = EXCLUDED.agency_id,
          revoked_at = NULL,
          revoked_by = NULL,
          revoked_reason = NULL,
          suspended_at = NULL,
          suspended_reason = NULL;
  END IF;

  INSERT INTO public.host_application_events (application_id, actor_id, event_type, note)
  VALUES (p_application_id, p_admin_id, v_status, v_note);

  INSERT INTO public.user_notifications (user_id, actor_id, event_type, reference_id, title, body, route)
  VALUES (
    v_user.id, p_admin_id, 'host_application', p_application_id,
    CASE WHEN p_approve THEN 'تم اعتماد طلب المضيفة' ELSE 'تم رفض طلب المضيفة' END,
    coalesce(v_note, CASE WHEN p_approve
      THEN 'أكمل رفع مستند الهوية لتفعيل السحب.'
      ELSE 'يمكنك تعديل الطلب وإعادة التقديم.' END),
    '/host-application'
  );

  INSERT INTO public.admin_audit_log (admin_id, action, target_type, target_id, before, after, metadata)
  VALUES (
    p_admin_id,
    CASE WHEN p_approve THEN 'approve'::public.audit_action_type ELSE 'reject'::public.audit_action_type END,
    'host_application', p_application_id,
    jsonb_build_object('status', v_application.status),
    jsonb_build_object('status', v_status, 'user_id', v_user.id,
      'source', v_application.source, 'agency_id', v_application.agency_id),
    jsonb_build_object('review_note', v_note)
  );

  RETURN jsonb_build_object(
    'application_id', p_application_id,
    'user_id', v_user.id,
    'status', v_status,
    'source', v_application.source
  );
END;
$$;
REVOKE ALL ON FUNCTION public.admin_review_host_application(uuid, uuid, boolean, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_review_host_application(uuid, uuid, boolean, text) TO authenticated, service_role;

-- ============================================================
-- 9) إدارة اعتماد المضيفة: تعليق/تفعيل/سحب
-- ============================================================
CREATE OR REPLACE FUNCTION public.admin_manage_verified_host(
  p_admin_id uuid,
  p_user_id uuid,
  p_action text,
  p_reason text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_admin public.users%ROWTYPE;
  v_user public.users%ROWTYPE;
  v_before text;
  v_after text;
  v_action public.audit_action_type;
  v_reason text := nullif(btrim(p_reason), '');
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    IF auth.uid() IS NULL OR auth.uid() IS DISTINCT FROM p_admin_id
       OR NOT public.admin_staff_can(p_admin_id, 'hosts.applications.manage') THEN
      RAISE EXCEPTION 'غير مصرح بإدارة اعتماد المضيفات';
    END IF;
  END IF;
  IF p_admin_id IS NULL OR p_user_id IS NULL OR p_admin_id = p_user_id THEN
    RAISE EXCEPTION 'الحساب المستهدف غير صالح';
  END IF;
  IF p_action NOT IN ('assign', 'suspend', 'activate', 'revoke')
     OR v_reason IS NULL OR char_length(v_reason) > 500 THEN
    RAISE EXCEPTION 'حدد إجراءً وسببًا لا يتجاوز 500 حرف';
  END IF;

  SELECT * INTO v_admin FROM public.users WHERE id = p_admin_id FOR UPDATE;
  IF NOT FOUND OR v_admin.status <> 'active' OR v_admin.role NOT IN ('admin', 'super_admin') THEN
    RAISE EXCEPTION 'لا تملك صلاحية إدارة المضيفات';
  END IF;

  SELECT * INTO v_user FROM public.users WHERE id = p_user_id FOR UPDATE;
  IF NOT FOUND OR v_user.status <> 'active' OR v_user.role <> 'user'
     OR v_user.adult_confirmed_at IS NULL OR v_user.onboarding_completed_at IS NULL THEN
    RAISE EXCEPTION 'لا يمكن تعيين هذا الحساب كمضيفة؛ يجب أن يكون حساب مستخدمة نشطًا ومكتمل التحقق';
  END IF;

  SELECT status INTO v_before FROM public.verified_hosts WHERE user_id = p_user_id FOR UPDATE;

  IF p_action = 'assign' THEN
    IF v_before = 'active' THEN
      RAISE EXCEPTION 'هذا الحساب مضيفة نشطة بالفعل';
    END IF;
    INSERT INTO public.verified_hosts (user_id, status, approved_by, approved_at, source, identity_status)
    VALUES (p_user_id, 'active', p_admin_id, now(), 'admin', 'unverified')
    ON CONFLICT (user_id) DO UPDATE
      SET status = 'active', approved_by = p_admin_id, approved_at = now(),
          source = 'admin', revoked_at = NULL, revoked_by = NULL, revoked_reason = NULL,
          suspended_at = NULL, suspended_reason = NULL;
    v_after := 'active';
    v_action := 'approve'::public.audit_action_type;

  ELSIF p_action = 'activate' THEN
    IF v_before IS NULL OR v_before NOT IN ('suspended', 'revoked') THEN
      RAISE EXCEPTION 'لا توجد مضيفة موقوفة أو مسحوبة لإعادة تفعيلها';
    END IF;
    UPDATE public.verified_hosts
    SET status = 'active', approved_by = p_admin_id, approved_at = now(),
        revoked_at = NULL, revoked_by = NULL, revoked_reason = NULL,
        suspended_at = NULL, suspended_reason = NULL
    WHERE user_id = p_user_id;
    v_after := 'active';
    v_action := 'approve'::public.audit_action_type;

  ELSIF p_action = 'suspend' THEN
    IF v_before IS DISTINCT FROM 'active' THEN
      RAISE EXCEPTION 'لا توجد مضيفة نشطة لإيقافها';
    END IF;
    UPDATE public.verified_hosts
    SET status = 'suspended', suspended_at = now(), suspended_reason = v_reason
    WHERE user_id = p_user_id;
    v_after := 'suspended';
    v_action := 'suspend'::public.audit_action_type;

  ELSE
    IF v_before IS DISTINCT FROM 'active' THEN
      RAISE EXCEPTION 'لا توجد مضيفة نشطة لسحب اعتمادها';
    END IF;
    UPDATE public.verified_hosts
    SET status = 'revoked', revoked_at = now(), revoked_by = p_admin_id, revoked_reason = v_reason
    WHERE user_id = p_user_id;
    v_after := 'revoked';
    v_action := 'revoke'::public.audit_action_type;
  END IF;

  INSERT INTO public.admin_audit_log (admin_id, action, target_type, target_id, before, after, metadata)
  VALUES (
    p_admin_id, v_action, 'verified_host', p_user_id,
    jsonb_build_object('status', v_before),
    jsonb_build_object('status', v_after),
    jsonb_build_object('reason', v_reason, 'operation', p_action)
  );

  INSERT INTO public.user_notifications (user_id, actor_id, event_type, reference_id, title, body, route)
  VALUES (
    p_user_id, p_admin_id, 'host_status', p_user_id,
    CASE p_action WHEN 'suspend' THEN 'تم تعليق اعتماد المضيفة'
                  WHEN 'revoke' THEN 'تم سحب اعتماد المضيفة'
                  ELSE 'تم تفعيل اعتماد المضيفة' END,
    v_reason, '/host-application'
  );

  RETURN jsonb_build_object('user_id', p_user_id, 'status', v_after);
END;
$$;
REVOKE ALL ON FUNCTION public.admin_manage_verified_host(uuid, uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_manage_verified_host(uuid, uuid, text, text) TO authenticated, service_role;

-- ============================================================
-- 10) مسار الوكالة: ترشيح مضيفة ضمن صلاحيات الوكالة
-- ============================================================
CREATE OR REPLACE FUNCTION public.agency_nominate_host(
  p_agency_id uuid,
  p_user_id uuid,
  p_application_text text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_agency public.agencies%ROWTYPE;
  v_user public.users%ROWTYPE;
  v_app public.host_applications%ROWTYPE;
  v_auto boolean;
  v_text text := btrim(coalesce(p_application_text, ''));
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'يجب تسجيل الدخول';
  END IF;
  IF p_agency_id IS NULL OR p_user_id IS NULL
     OR char_length(v_text) < 20 OR char_length(v_text) > 2000 THEN
    RAISE EXCEPTION 'بيانات الترشيح غير مكتملة (نبذة 20–2000 حرف)';
  END IF;

  SELECT * INTO v_agency FROM public.agencies WHERE id = p_agency_id FOR UPDATE;
  IF NOT FOUND OR v_agency.owner_user_id <> v_actor OR v_agency.status <> 'active' THEN
    RAISE EXCEPTION 'لا تملك صلاحية الترشيح في هذه الوكالة';
  END IF;
  IF NOT v_agency.can_approve_hosts THEN
    RAISE EXCEPTION 'هذه الوكالة غير مصرح لها باعتماد المضيفات';
  END IF;

  SELECT * INTO v_user FROM public.users WHERE id = p_user_id FOR UPDATE;
  IF NOT FOUND OR v_user.status <> 'active' OR v_user.role <> 'user'
     OR v_user.adult_confirmed_at IS NULL OR v_user.onboarding_completed_at IS NULL THEN
    RAISE EXCEPTION 'الحساب المرشح غير مؤهل';
  END IF;
  IF EXISTS (SELECT 1 FROM public.verified_hosts h WHERE h.user_id = p_user_id AND h.status = 'active') THEN
    RAISE EXCEPTION 'هذا الحساب مضيفة نشطة بالفعل';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.host_applications a
    WHERE a.user_id = p_user_id AND a.status IN ('pending', 'info_requested')
  ) THEN
    RAISE EXCEPTION 'لدى هذا الحساب طلب قيد المراجعة';
  END IF;

  SELECT coalesce((s.value #>> '{}')::boolean, false) INTO v_auto
  FROM public.admin_settings s WHERE s.key = 'agency_host_auto_approve';

  INSERT INTO public.host_applications (
    user_id, application_text, source, agency_id, nominated_by,
    status, reviewed_by, reviewed_at
  ) VALUES (
    p_user_id, v_text, 'agency', p_agency_id, v_actor,
    CASE WHEN v_auto THEN 'approved' ELSE 'pending' END,
    CASE WHEN v_auto THEN v_actor ELSE NULL END,
    CASE WHEN v_auto THEN now() ELSE NULL END
  ) RETURNING * INTO v_app;

  INSERT INTO public.host_application_events (application_id, actor_id, event_type, note)
  VALUES (v_app.id, v_actor, 'agency_nominated', v_text);

  IF v_auto THEN
    INSERT INTO public.verified_hosts (
      user_id, status, approved_by, approved_at, source, agency_id, identity_status
    ) VALUES (p_user_id, 'active', v_actor, now(), 'agency', p_agency_id, 'unverified')
    ON CONFLICT (user_id) DO UPDATE
      SET status = 'active', approved_by = EXCLUDED.approved_by, approved_at = EXCLUDED.approved_at,
          source = 'agency', agency_id = EXCLUDED.agency_id,
          revoked_at = NULL, revoked_by = NULL, revoked_reason = NULL,
          suspended_at = NULL, suspended_reason = NULL;

    INSERT INTO public.host_application_events (application_id, actor_id, event_type, note)
    VALUES (v_app.id, v_actor, 'approved', 'اعتماد تلقائي ضمن صلاحيات الوكالة');
  END IF;

  INSERT INTO public.user_notifications (user_id, actor_id, event_type, reference_id, title, body, route)
  VALUES (
    p_user_id, v_actor, 'host_application', v_app.id,
    CASE WHEN v_auto THEN 'تم اعتمادك مضيفة عبر الوكالة' ELSE 'تم ترشيحك مضيفة عبر الوكالة' END,
    CASE WHEN v_auto THEN 'أكمل رفع مستند الهوية لتفعيل السحب.' ELSE 'طلبك بانتظار مراجعة الإدارة.' END,
    '/host-application'
  );

  RETURN jsonb_build_object(
    'application_id', v_app.id, 'status', v_app.status,
    'auto_approved', v_auto, 'agency_id', p_agency_id
  );
END;
$$;
REVOKE ALL ON FUNCTION public.agency_nominate_host(uuid, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.agency_nominate_host(uuid, uuid, text) TO authenticated, service_role;

-- ============================================================
-- 11) حالة المضيفة (للتطبيق) + رفع مستند
-- ============================================================
CREATE OR REPLACE FUNCTION public.get_my_host_status()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_app jsonb;
  v_host jsonb;
  v_docs jsonb;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;

  SELECT to_jsonb(a) INTO v_app
  FROM public.host_applications a
  WHERE a.user_id = v_uid
  ORDER BY a.created_at DESC LIMIT 1;

  SELECT to_jsonb(h) INTO v_host
  FROM public.verified_hosts h
  WHERE h.user_id = v_uid;

  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'id', d.id, 'doc_type', d.doc_type, 'status', d.status,
    'review_note', d.review_note, 'created_at', d.created_at, 'reviewed_at', d.reviewed_at
  ) ORDER BY d.created_at DESC), '[]'::jsonb)
  INTO v_docs
  FROM public.host_documents d
  WHERE d.user_id = v_uid;

  RETURN jsonb_build_object(
    'application', coalesce(v_app, 'null'::jsonb),
    'host', coalesce(v_host, 'null'::jsonb),
    'documents', v_docs,
    'identity_verified', coalesce((v_host ->> 'identity_status') = 'verified', false),
    'can_withdraw', coalesce((v_host ->> 'status') = 'active', false)
      AND coalesce((v_host ->> 'identity_status') = 'verified', false)
  );
END;
$$;
REVOKE ALL ON FUNCTION public.get_my_host_status() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_my_host_status() TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.submit_host_document(
  p_doc_type text,
  p_file_path text,
  p_application_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_app_id uuid;
  v_doc public.host_documents%ROWTYPE;
  v_path text := btrim(coalesce(p_file_path, ''));
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  IF p_doc_type NOT IN ('id_card', 'passport', 'selfie', 'video', 'other')
     OR char_length(v_path) NOT BETWEEN 3 AND 500
     OR left(v_path, length('hostdoc_' || v_uid::text || '_')) <> ('hostdoc_' || v_uid::text || '_') THEN
    RAISE EXCEPTION 'بيانات المستند غير صالحة';
  END IF;

  IF p_application_id IS NOT NULL THEN
    SELECT a.id INTO v_app_id
    FROM public.host_applications a
    WHERE a.id = p_application_id AND a.user_id = v_uid
      AND a.status IN ('pending', 'info_requested');
    IF v_app_id IS NULL THEN
      RAISE EXCEPTION 'الطلب غير موجود أو لم يعد قابلاً لإرفاق المستندات';
    END IF;
  END IF;

  INSERT INTO public.host_documents (user_id, application_id, doc_type, file_path)
  VALUES (v_uid, v_app_id, p_doc_type, v_path)
  RETURNING * INTO v_doc;

  IF v_app_id IS NOT NULL THEN
    INSERT INTO public.host_application_events (application_id, actor_id, event_type, note)
    VALUES (v_app_id, v_uid, 'document_uploaded', p_doc_type);
  END IF;

  UPDATE public.verified_hosts
  SET identity_status = CASE WHEN identity_status = 'rejected' THEN 'pending' ELSE identity_status END
  WHERE user_id = v_uid AND identity_status IN ('unverified', 'rejected');

  RETURN jsonb_build_object('document_id', v_doc.id, 'status', v_doc.status);
END;
$$;
REVOKE ALL ON FUNCTION public.submit_host_document(text, text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.submit_host_document(text, text, uuid) TO authenticated, service_role;

-- ============================================================
-- 12) العقود: حل العقد الفعّال + إدارة إصدارات بلا أثر رجعي
-- ============================================================
CREATE OR REPLACE FUNCTION public.effective_host_contract(
  p_host_user_id uuid,
  p_at timestamptz DEFAULT now()
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_agency_id uuid;
  v_contract public.host_contracts%ROWTYPE;
BEGIN
  IF p_host_user_id IS NULL THEN RETURN NULL; END IF;
  SELECT h.agency_id INTO v_agency_id FROM public.verified_hosts h WHERE h.user_id = p_host_user_id;

  SELECT * INTO v_contract
  FROM public.host_contracts c
  WHERE c.scope = 'host' AND c.host_user_id = p_host_user_id
    AND c.status IN ('active', 'terminated', 'expired')
    AND c.starts_at <= p_at AND (c.ends_at IS NULL OR c.ends_at > p_at)
  ORDER BY c.starts_at DESC LIMIT 1;
  IF FOUND THEN RETURN to_jsonb(v_contract); END IF;

  IF v_agency_id IS NOT NULL THEN
    SELECT * INTO v_contract
    FROM public.host_contracts c
    WHERE c.scope = 'agency' AND c.agency_id = v_agency_id
      AND c.status IN ('active', 'terminated', 'expired')
      AND c.starts_at <= p_at AND (c.ends_at IS NULL OR c.ends_at > p_at)
    ORDER BY c.starts_at DESC LIMIT 1;
    IF FOUND THEN RETURN to_jsonb(v_contract); END IF;
  END IF;

  SELECT * INTO v_contract
  FROM public.host_contracts c
  WHERE c.scope = 'global' AND c.status IN ('active', 'terminated', 'expired')
    AND c.starts_at <= p_at AND (c.ends_at IS NULL OR c.ends_at > p_at)
  ORDER BY c.starts_at DESC LIMIT 1;
  IF FOUND THEN RETURN to_jsonb(v_contract); END IF;

  RETURN NULL;
END;
$$;
REVOKE ALL ON FUNCTION public.effective_host_contract(uuid, timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.effective_host_contract(uuid, timestamptz) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.admin_upsert_host_contract(
  p_admin_id uuid,
  p_contract_id uuid,
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
  v_old public.host_contracts%ROWTYPE;
  v_new public.host_contracts%ROWTYPE;
  v_scope text := nullif(btrim(p_payload->>'scope'), '');
  v_agency_id uuid := nullif(p_payload->>'agency_id', '')::uuid;
  v_host_user_id uuid := nullif(p_payload->>'host_user_id', '')::uuid;
  v_title text := btrim(coalesce(p_payload->>'title', ''));
  v_profit numeric := coalesce((p_payload->>'profit_share_percent')::numeric, 0);
  v_platform numeric := coalesce((p_payload->>'platform_commission_percent')::numeric, 0);
  v_agent numeric := coalesce((p_payload->>'agent_commission_percent')::numeric, 0);
  v_targets jsonb := coalesce(p_payload->'targets', '{}'::jsonb);
  v_rewards jsonb := coalesce(p_payload->'rewards', '{}'::jsonb);
  v_starts_at timestamptz := coalesce(nullif(p_payload->>'starts_at', '')::timestamptz, now());
  v_ends_at timestamptz := nullif(p_payload->>'ends_at', '')::timestamptz;
  v_auto_renew boolean := coalesce((p_payload->>'auto_renew')::boolean, false);
  v_notice integer := coalesce((p_payload->>'renewal_notice_days')::integer, 7);
  v_status text := coalesce(nullif(p_payload->>'status', ''), 'draft');
  v_reason text := nullif(btrim(p_reason), '');
  v_version integer := 1;
  v_parent uuid;
  v_old_status text;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    IF auth.uid() IS NULL OR auth.uid() IS DISTINCT FROM p_admin_id
       OR NOT public.admin_staff_can(p_admin_id, 'hosts.contracts.manage') THEN
      RAISE EXCEPTION 'غير مصرح بإدارة عقود المضيفات';
    END IF;
  END IF;
  IF p_admin_id IS NULL OR p_payload IS NULL OR jsonb_typeof(p_payload) <> 'object'
     OR v_scope NOT IN ('global', 'agency', 'host')
     OR char_length(v_title) NOT BETWEEN 2 AND 120
     OR v_profit NOT BETWEEN 0 AND 100
     OR v_platform NOT BETWEEN 0 AND 100
     OR v_agent NOT BETWEEN 0 AND 100
     OR v_platform + v_agent > 100
     OR v_status NOT IN ('draft', 'active', 'suspended', 'terminated', 'expired')
     OR v_notice NOT BETWEEN 0 AND 90
     OR jsonb_typeof(v_targets) <> 'object'
     OR jsonb_typeof(v_rewards) <> 'object'
     OR (v_ends_at IS NOT NULL AND v_ends_at <= v_starts_at) THEN
    RAISE EXCEPTION 'بيانات العقد غير صالحة';
  END IF;
  IF (v_scope = 'global' AND (v_agency_id IS NOT NULL OR v_host_user_id IS NOT NULL))
     OR (v_scope = 'agency' AND (v_agency_id IS NULL OR v_host_user_id IS NOT NULL))
     OR (v_scope = 'host' AND (v_host_user_id IS NULL OR v_agency_id IS NOT NULL)) THEN
    RAISE EXCEPTION 'نطاق العقد لا يطابق مراجعه';
  END IF;
  IF v_scope = 'agency' AND NOT EXISTS (SELECT 1 FROM public.agencies WHERE id = v_agency_id) THEN
    RAISE EXCEPTION 'الوكالة غير موجودة';
  END IF;
  IF v_scope = 'host' AND NOT EXISTS (
    SELECT 1 FROM public.verified_hosts WHERE user_id = v_host_user_id
  ) THEN
    RAISE EXCEPTION 'المضيفة غير موجودة';
  END IF;

  SELECT * INTO v_admin FROM public.users WHERE id = p_admin_id FOR UPDATE;
  IF NOT FOUND OR v_admin.status <> 'active' OR v_admin.role NOT IN ('admin', 'super_admin') THEN
    RAISE EXCEPTION 'الحساب الإداري غير نشط';
  END IF;

  -- عند التعديل: الإصدار النشط يُغلق ويُنشأ إصدار جديد يبدأ الآن.
  IF p_contract_id IS NOT NULL THEN
    SELECT * INTO v_old FROM public.host_contracts WHERE id = p_contract_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'العقد غير موجود'; END IF;
    IF v_old.status = 'draft' THEN
      UPDATE public.host_contracts
      SET scope = v_scope, agency_id = v_agency_id, host_user_id = v_host_user_id,
          title = v_title, profit_share_percent = v_profit,
          platform_commission_percent = v_platform, agent_commission_percent = v_agent,
          targets = v_targets, rewards = v_rewards,
          starts_at = v_starts_at, ends_at = v_ends_at,
          auto_renew = v_auto_renew, renewal_notice_days = v_notice,
          status = v_status, approved_by = p_admin_id, updated_at = now()
      WHERE id = p_contract_id
      RETURNING * INTO v_new;
      RETURN to_jsonb(v_new);
    END IF;

    v_old_status := v_old.status;
    UPDATE public.host_contracts
    SET status = 'terminated',
        ends_at = least(coalesce(ends_at, now()), now()),
        terminated_at = now(),
        termination_reason = coalesce(v_reason, 'إصدار جديد للعقد'),
        updated_at = now()
    WHERE id = p_contract_id;

    v_version := v_old.version + 1;
    v_parent := v_old.id;
    -- أي عقد جديد يبدأ من الآن فعلياً؛ لا أثر رجعي على العمليات السابقة.
    v_starts_at := greatest(v_starts_at, now());
  END IF;

  IF v_status = 'active' THEN
    -- إن وُجد عقد نشط آخر بنفس النطاق يُغلق تلقائياً قبل الإصدار الجديد.
    UPDATE public.host_contracts c
    SET status = 'terminated',
        ends_at = least(coalesce(c.ends_at, now()), now()),
        terminated_at = now(),
        termination_reason = coalesce(v_reason, 'استُبدل بعقد أحدث'),
        updated_at = now()
    WHERE c.status = 'active'
      AND c.scope = v_scope
      AND ((v_scope = 'global')
        OR (v_scope = 'agency' AND c.agency_id = v_agency_id)
        OR (v_scope = 'host' AND c.host_user_id = v_host_user_id));
  END IF;

  INSERT INTO public.host_contracts (
    scope, agency_id, host_user_id, title,
    profit_share_percent, platform_commission_percent, agent_commission_percent,
    targets, rewards, starts_at, ends_at, auto_renew, renewal_notice_days,
    status, version, parent_contract_id, created_by, approved_by
  ) VALUES (
    v_scope, v_agency_id, v_host_user_id, v_title,
    v_profit, v_platform, v_agent,
    v_targets, v_rewards, v_starts_at, v_ends_at, v_auto_renew, v_notice,
    v_status, v_version, v_parent, p_admin_id,
    CASE WHEN v_status = 'active' THEN p_admin_id ELSE NULL END
  ) RETURNING * INTO v_new;

  INSERT INTO public.admin_audit_log (admin_id, action, target_type, target_id, before, after, metadata)
  VALUES (
    p_admin_id,
    CASE WHEN p_contract_id IS NULL THEN 'create'::public.audit_action_type
         ELSE 'update'::public.audit_action_type END,
    'host_contract', v_new.id,
    CASE WHEN p_contract_id IS NULL THEN NULL ELSE to_jsonb(v_old) END,
    to_jsonb(v_new),
    jsonb_build_object('reason', v_reason, 'previous_status', v_old_status)
  );

  RETURN to_jsonb(v_new);
END;
$$;
REVOKE ALL ON FUNCTION public.admin_upsert_host_contract(uuid, uuid, jsonb, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_upsert_host_contract(uuid, uuid, jsonb, text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.admin_set_host_contract_status(
  p_admin_id uuid,
  p_contract_id uuid,
  p_status text,
  p_reason text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_admin public.users%ROWTYPE;
  v_contract public.host_contracts%ROWTYPE;
  v_reason text := nullif(btrim(p_reason), '');
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    IF auth.uid() IS NULL OR auth.uid() IS DISTINCT FROM p_admin_id
       OR NOT public.admin_staff_can(p_admin_id, 'hosts.contracts.manage') THEN
      RAISE EXCEPTION 'غير مصرح بإدارة عقود المضيفات';
    END IF;
  END IF;
  IF p_admin_id IS NULL OR p_contract_id IS NULL
     OR p_status NOT IN ('active', 'suspended', 'terminated', 'expired')
     OR (p_status IN ('terminated', 'expired') AND v_reason IS NULL) THEN
    RAISE EXCEPTION 'بيانات تغيير حالة العقد غير صالحة';
  END IF;

  SELECT * INTO v_admin FROM public.users WHERE id = p_admin_id FOR UPDATE;
  IF NOT FOUND OR v_admin.status <> 'active' OR v_admin.role NOT IN ('admin', 'super_admin') THEN
    RAISE EXCEPTION 'الحساب الإداري غير نشط';
  END IF;

  SELECT * INTO v_contract FROM public.host_contracts WHERE id = p_contract_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'العقد غير موجود'; END IF;

  IF p_status = 'active' AND v_contract.status <> 'active' THEN
    IF EXISTS (
      SELECT 1 FROM public.host_contracts c
      WHERE c.id <> p_contract_id AND c.status = 'active' AND c.scope = v_contract.scope
        AND ((v_contract.scope = 'global')
          OR (v_contract.scope = 'agency' AND c.agency_id = v_contract.agency_id)
          OR (v_contract.scope = 'host' AND c.host_user_id = v_contract.host_user_id))
    ) THEN
      RAISE EXCEPTION 'يوجد عقد نشط آخر بنفس النطاق؛ أوقفه أولاً';
    END IF;
  END IF;

  UPDATE public.host_contracts
  SET status = p_status,
      starts_at = CASE WHEN p_status = 'active' THEN greatest(starts_at, now()) ELSE starts_at END,
      ends_at = CASE WHEN p_status IN ('terminated', 'expired')
        THEN least(coalesce(ends_at, now()), now()) ELSE ends_at END,
      terminated_at = CASE WHEN p_status = 'terminated' THEN now() ELSE terminated_at END,
      termination_reason = CASE WHEN p_status IN ('terminated', 'expired') THEN v_reason ELSE termination_reason END,
      approved_by = CASE WHEN p_status = 'active' THEN p_admin_id ELSE approved_by END,
      updated_at = now()
  WHERE id = p_contract_id
  RETURNING * INTO v_contract;

  INSERT INTO public.admin_audit_log (admin_id, action, target_type, target_id, before, after, metadata)
  VALUES (
    p_admin_id,
    CASE p_status WHEN 'terminated' THEN 'revoke'::public.audit_action_type
                  WHEN 'suspended' THEN 'suspend'::public.audit_action_type
                  ELSE 'update'::public.audit_action_type END,
    'host_contract', p_contract_id, NULL, to_jsonb(v_contract),
    jsonb_build_object('status', p_status, 'reason', v_reason)
  );

  RETURN to_jsonb(v_contract);
END;
$$;
REVOKE ALL ON FUNCTION public.admin_set_host_contract_status(uuid, uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_set_host_contract_status(uuid, uuid, text, text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.get_my_host_contract()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  RETURN coalesce(public.effective_host_contract(v_uid, now()), 'null'::jsonb);
END;
$$;
REVOKE ALL ON FUNCTION public.get_my_host_contract() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_my_host_contract() TO authenticated, service_role;

-- ============================================================
-- 13) الأهداف: قياس التقدم وصرف المكافآت
-- ============================================================
CREATE OR REPLACE FUNCTION public.host_target_metric_value(
  p_user_id uuid,
  p_metric text,
  p_period_month date
)
RETURNS numeric
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_start timestamptz := p_period_month::timestamptz;
  v_end timestamptz := (p_period_month + interval '1 month')::timestamptz;
  v_min_minutes integer;
  v_value numeric;
BEGIN
  IF p_user_id IS NULL OR p_period_month IS NULL THEN RETURN 0; END IF;
  IF p_metric = 'stream_hours' THEN
    SELECT coalesce(sum(s.minutes), 0) / 60.0 INTO v_value
    FROM public.host_activity_sessions s
    WHERE s.user_id = p_user_id AND s.started_at >= v_start AND s.started_at < v_end;
  ELSIF p_metric = 'active_days' THEN
    SELECT coalesce((s.value #>> '{}')::integer, 60) INTO v_min_minutes
    FROM public.admin_settings s WHERE s.key = 'host_target_active_day_min_minutes';
    SELECT count(DISTINCT date_trunc('day', s.started_at)) INTO v_value
    FROM public.host_activity_sessions s
    WHERE s.user_id = p_user_id AND s.started_at >= v_start AND s.started_at < v_end
      AND coalesce(s.minutes, 0) >= coalesce(v_min_minutes, 60);
  ELSIF p_metric = 'attendance_days' THEN
    SELECT count(DISTINCT date_trunc('day', s.started_at)) INTO v_value
    FROM public.host_activity_sessions s
    WHERE s.user_id = p_user_id AND s.started_at >= v_start AND s.started_at < v_end;
  ELSIF p_metric = 'gift_value' THEN
    SELECT coalesce(sum(g.total_gold), 0) INTO v_value
    FROM public.gift_transactions g
    WHERE g.to_user_id = p_user_id AND g.created_at >= v_start AND g.created_at < v_end;
  ELSE
    v_value := 0;
  END IF;
  RETURN coalesce(v_value, 0);
END;
$$;
REVOKE ALL ON FUNCTION public.host_target_metric_value(uuid, text, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.host_target_metric_value(uuid, text, date) TO service_role;

CREATE OR REPLACE FUNCTION public.host_target_progress(
  p_admin_id uuid,
  p_period_month date
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_rows jsonb;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    IF auth.uid() IS NULL OR auth.uid() IS DISTINCT FROM p_admin_id
       OR NOT (public.admin_staff_can(p_admin_id, 'hosts.targets.view')
               OR public.admin_staff_can(p_admin_id, 'hosts.targets.manage')) THEN
      RAISE EXCEPTION 'غير مصرح بعرض أهداف المضيفات';
    END IF;
  END IF;
  IF p_period_month IS NULL OR p_period_month <> date_trunc('month', p_period_month)::date THEN
    RAISE EXCEPTION 'حدد أول يوم من الشهر';
  END IF;

  SELECT coalesce(jsonb_agg(row_data ORDER BY host_user_id, target_id), '[]'::jsonb)
  INTO v_rows
  FROM (
    SELECT t.id AS target_id, h.user_id AS host_user_id,
      jsonb_build_object(
        'target_id', t.id,
        'period_month', t.period_month,
        'scope', t.scope,
        'metric', t.metric,
        'target_value', t.target_value,
        'reward_type', t.reward_type,
        'reward_amount', t.reward_amount,
        'host_user_id', h.user_id,
        'host_name', coalesce(nullif(u.display_name, ''), u.username),
        'agency_id', h.agency_id,
        'achieved_value', public.host_target_metric_value(h.user_id, t.metric, t.period_month),
        'awarded', EXISTS (
          SELECT 1 FROM public.host_target_awards a
          WHERE a.target_id = t.id AND a.host_user_id = h.user_id AND a.period_month = t.period_month
        )
      ) AS row_data
    FROM public.host_targets t
    JOIN public.verified_hosts h
      ON h.status = 'active'
     AND (
       (t.scope = 'host' AND h.user_id = t.host_user_id)
       OR (t.scope = 'agency' AND h.agency_id = t.agency_id)
       OR (t.scope = 'level' AND EXISTS (
         SELECT 1 FROM public.users lu WHERE lu.id = h.user_id AND lu.level >= t.level
       ))
     )
    JOIN public.users u ON u.id = h.user_id
    WHERE t.period_month = p_period_month AND t.is_active
  ) s;

  RETURN v_rows;
END;
$$;
REVOKE ALL ON FUNCTION public.host_target_progress(uuid, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.host_target_progress(uuid, date) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.admin_upsert_host_target(
  p_admin_id uuid,
  p_target_id uuid,
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
  v_target public.host_targets%ROWTYPE;
  v_scope text := nullif(btrim(p_payload->>'scope'), '');
  v_month date := nullif(p_payload->>'period_month', '')::date;
  v_metric text := nullif(btrim(p_payload->>'metric'), '');
  v_host uuid := nullif(p_payload->>'host_user_id', '')::uuid;
  v_agency uuid := nullif(p_payload->>'agency_id', '')::uuid;
  v_level integer := nullif(p_payload->>'level', '')::integer;
  v_value numeric := (p_payload->>'target_value')::numeric;
  v_reward_type text := coalesce(nullif(p_payload->>'reward_type', ''), 'coin');
  v_reward_amount numeric := coalesce((p_payload->>'reward_amount')::numeric, 0);
  v_meta jsonb := coalesce(p_payload->'reward_metadata', '{}'::jsonb);
  v_active boolean := coalesce((p_payload->>'is_active')::boolean, true);
  v_reason text := nullif(btrim(p_reason), '');
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    IF auth.uid() IS NULL OR auth.uid() IS DISTINCT FROM p_admin_id
       OR NOT public.admin_staff_can(p_admin_id, 'hosts.targets.manage') THEN
      RAISE EXCEPTION 'غير مصرح بإدارة أهداف المضيفات';
    END IF;
  END IF;
  IF p_admin_id IS NULL OR p_payload IS NULL OR jsonb_typeof(p_payload) <> 'object'
     OR v_scope NOT IN ('host', 'agency', 'level')
     OR v_month IS NULL OR v_month <> date_trunc('month', v_month)::date
     OR v_metric NOT IN ('stream_hours', 'active_days', 'gift_value', 'attendance_days', 'other')
     OR v_value IS NULL OR v_value <= 0
     OR v_reward_type NOT IN ('coin', 'diamond', 'cosmetic')
     OR v_reward_amount < 0
     OR jsonb_typeof(v_meta) <> 'object'
     OR (v_scope = 'host' AND (v_host IS NULL OR v_agency IS NOT NULL OR v_level IS NOT NULL))
     OR (v_scope = 'agency' AND (v_agency IS NULL OR v_host IS NOT NULL OR v_level IS NOT NULL))
     OR (v_scope = 'level' AND (v_level IS NULL OR v_level NOT BETWEEN 1 AND 100 OR v_host IS NOT NULL OR v_agency IS NOT NULL)) THEN
    RAISE EXCEPTION 'بيانات الهدف غير صالحة';
  END IF;

  SELECT * INTO v_admin FROM public.users WHERE id = p_admin_id FOR UPDATE;
  IF NOT FOUND OR v_admin.status <> 'active' OR v_admin.role NOT IN ('admin', 'super_admin') THEN
    RAISE EXCEPTION 'الحساب الإداري غير نشط';
  END IF;

  IF p_target_id IS NULL THEN
    INSERT INTO public.host_targets (
      period_month, scope, host_user_id, agency_id, level, metric,
      target_value, reward_type, reward_amount, reward_metadata, is_active, created_by
    ) VALUES (
      v_month, v_scope, v_host, v_agency, v_level, v_metric,
      v_value, v_reward_type, v_reward_amount, v_meta, v_active, p_admin_id
    ) RETURNING * INTO v_target;
  ELSE
    SELECT * INTO v_target FROM public.host_targets WHERE id = p_target_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'الهدف غير موجود'; END IF;
    IF EXISTS (SELECT 1 FROM public.host_target_awards WHERE target_id = p_target_id) THEN
      RAISE EXCEPTION 'لا يمكن تعديل هدف صُرفت مكافآته؛ أنشئ هدفاً جديداً';
    END IF;
    UPDATE public.host_targets
    SET period_month = v_month, scope = v_scope, host_user_id = v_host,
        agency_id = v_agency, level = v_level, metric = v_metric,
        target_value = v_value, reward_type = v_reward_type,
        reward_amount = v_reward_amount, reward_metadata = v_meta,
        is_active = v_active, updated_at = now()
    WHERE id = p_target_id
    RETURNING * INTO v_target;
  END IF;

  INSERT INTO public.admin_audit_log (admin_id, action, target_type, target_id, before, after, metadata)
  VALUES (
    p_admin_id,
    CASE WHEN p_target_id IS NULL THEN 'create'::public.audit_action_type
         ELSE 'update'::public.audit_action_type END,
    'host_target', v_target.id, NULL, to_jsonb(v_target),
    jsonb_build_object('reason', v_reason)
  );

  RETURN to_jsonb(v_target);
END;
$$;
REVOKE ALL ON FUNCTION public.admin_upsert_host_target(uuid, uuid, jsonb, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_upsert_host_target(uuid, uuid, jsonb, text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.admin_evaluate_host_targets(
  p_admin_id uuid,
  p_period_month date
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_admin public.users%ROWTYPE;
  v_row jsonb;
  v_awarded integer := 0;
  v_skipped integer := 0;
  v_tx uuid;
  v_target public.host_targets%ROWTYPE;
  v_achieved numeric;
  v_award public.host_target_awards%ROWTYPE;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    IF auth.uid() IS NULL OR auth.uid() IS DISTINCT FROM p_admin_id
       OR NOT public.admin_staff_can(p_admin_id, 'hosts.targets.manage') THEN
      RAISE EXCEPTION 'غير مصرح بصرف مكافآت الأهداف';
    END IF;
  END IF;
  IF p_admin_id IS NULL OR p_period_month IS NULL THEN
    RAISE EXCEPTION 'بيانات الصرف غير مكتملة';
  END IF;

  SELECT * INTO v_admin FROM public.users WHERE id = p_admin_id FOR UPDATE;
  IF NOT FOUND OR v_admin.status <> 'active' OR v_admin.role NOT IN ('admin', 'super_admin') THEN
    RAISE EXCEPTION 'الحساب الإداري غير نشط';
  END IF;

  FOR v_row IN SELECT * FROM jsonb_array_elements(public.host_target_progress(p_admin_id, p_period_month))
  LOOP
    CONTINUE WHEN coalesce((v_row->>'awarded')::boolean, false);
    CONTINUE WHEN (v_row->>'achieved_value')::numeric < (v_row->>'target_value')::numeric;
    CONTINUE WHEN (v_row->>'reward_type') = 'cosmetic'
              AND coalesce((v_row->>'reward_amount')::numeric, 0) <= 0;

    SELECT * INTO v_target FROM public.host_targets WHERE id = (v_row->>'target_id')::uuid FOR UPDATE;
    v_achieved := (v_row->>'achieved_value')::numeric;
    v_tx := NULL;

    IF v_target.reward_type IN ('coin', 'diamond') AND v_target.reward_amount > 0 THEN
      v_tx := public.record_wallet_transaction(
        (v_row->>'host_user_id')::uuid,
        'host_target_reward'::public.wallet_tx_type,
        round(v_target.reward_amount)::bigint,
        CASE WHEN v_target.reward_type = 'diamond' THEN 'diamond' ELSE 'gold' END,
        NULL,
        'host-target:' || v_target.id::text || ':' || (v_row->>'host_user_id') || ':'
          || to_char(p_period_month, 'YYYYMM'),
        'host_target', v_target.id,
        jsonb_build_object('metric', v_target.metric, 'target_value', v_target.target_value,
          'achieved_value', v_achieved, 'period_month', p_period_month),
        'admin-evaluate-host-targets', 'مكافأة هدف شهري', p_admin_id, 'admin'
      );
    END IF;

    INSERT INTO public.host_target_awards (
      target_id, host_user_id, period_month, metric, target_value, achieved_value,
      reward_type, reward_amount, wallet_transaction_id, awarded_by
    ) VALUES (
      v_target.id, (v_row->>'host_user_id')::uuid, p_period_month, v_target.metric,
      v_target.target_value, v_achieved, v_target.reward_type, v_target.reward_amount,
      v_tx, p_admin_id
    ) RETURNING * INTO v_award;

    INSERT INTO public.user_notifications (user_id, actor_id, event_type, reference_id, title, body, route)
    VALUES (
      v_award.host_user_id, p_admin_id, 'host_target', v_award.id,
      'تحققت من هدفك الشهري',
      'تمت إضافة مكافأة الهدف إلى محفظتك.',
      '/(tabs)/wallet'
    );

    v_awarded := v_awarded + 1;
  END LOOP;

  RETURN jsonb_build_object(
    'period_month', p_period_month,
    'awarded_count', v_awarded,
    'skipped_count', v_skipped
  );
END;
$$;
REVOKE ALL ON FUNCTION public.admin_evaluate_host_targets(uuid, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_evaluate_host_targets(uuid, date) TO authenticated, service_role;

-- ============================================================
-- 14) تتبع جلسات بث المضيفة (يُستدعى من room-join/room-leave)
-- ============================================================
CREATE OR REPLACE FUNCTION public.record_host_activity(
  p_user_id uuid,
  p_room_id uuid,
  p_session_id text,
  p_joining boolean
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_is_host boolean;
  v_row public.host_activity_sessions%ROWTYPE;
  v_minutes integer;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;
  IF p_user_id IS NULL OR p_room_id IS NULL OR p_joining IS NULL
     OR p_session_id !~ '^[A-Za-z0-9._:-]{8,100}$' THEN
    RETURN 0;
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.verified_hosts h
    WHERE h.user_id = p_user_id AND h.status = 'active'
  ) INTO v_is_host;
  IF NOT v_is_host THEN RETURN 0; END IF;

  IF p_joining THEN
    -- إغلاق أي جلسة قديمة متروكة لنفس المستخدم دون إشارة خروج.
    UPDATE public.host_activity_sessions s
    SET ended_at = s.last_seen_at,
        minutes = greatest(0, floor(extract(epoch FROM (s.last_seen_at - s.started_at)) / 60)::integer)
    WHERE s.user_id = p_user_id AND s.ended_at IS NULL
      AND s.last_seen_at < now() - interval '5 minutes';

    INSERT INTO public.host_activity_sessions (user_id, room_id, session_id, started_at, last_seen_at)
    VALUES (p_user_id, p_room_id, p_session_id, now(), now())
    ON CONFLICT (user_id, room_id, session_id)
    DO UPDATE SET last_seen_at = now()
    RETURNING * INTO v_row;

    RETURN coalesce(v_row.minutes, 0);
  END IF;

  UPDATE public.host_activity_sessions s
  SET ended_at = now(),
      minutes = greatest(0, floor(extract(epoch FROM (now() - s.started_at)) / 60)::integer),
      last_seen_at = now()
  WHERE s.user_id = p_user_id AND s.room_id = p_room_id AND s.session_id = p_session_id
    AND s.ended_at IS NULL
  RETURNING * INTO v_row;

  v_minutes := coalesce(v_row.minutes, 0);
  RETURN v_minutes;
END;
$$;
REVOKE ALL ON FUNCTION public.record_host_activity(uuid, uuid, text, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_host_activity(uuid, uuid, text, boolean) TO service_role;

-- ============================================================
-- 15) بوابة الهوية قبل السحب: تحديث دالة السحب القائمة
-- ============================================================
CREATE OR REPLACE FUNCTION public.create_my_diamond_withdrawal(
  p_user_id uuid,
  p_amount_diamond bigint,
  p_method public.deposit_method,
  p_payout_details jsonb,
  p_idempotency_key text
)
RETURNS public.diamond_withdrawals
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user public.users%ROWTYPE;
  v_existing public.diamond_withdrawals%ROWTYPE;
  v_agent_id uuid;
  v_rate numeric(14,6);
  v_minimum bigint;
  v_fee_percent numeric(8,4);
  v_gross numeric(14,2);
  v_fee numeric(14,2);
  v_max_daily numeric(14,2);
  v_daily_total numeric(14,2);
  v_withdrawal public.diamond_withdrawals%ROWTYPE;
  v_is_host boolean;
  v_is_agent boolean;
  v_host_identity text;
BEGIN
  IF p_user_id IS NULL
     OR (auth.role() <> 'service_role' AND auth.uid() IS DISTINCT FROM p_user_id)
     OR p_amount_diamond IS NULL OR p_amount_diamond <= 0
     OR p_method IS NULL OR jsonb_typeof(coalesce(p_payout_details, '{}'::jsonb)) <> 'object'
     OR length(trim(coalesce(p_idempotency_key, ''))) NOT BETWEEN 10 AND 100 THEN
    RAISE EXCEPTION 'Invalid withdrawal request';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtext('diamond-withdrawal:' || p_idempotency_key));
  SELECT * INTO v_existing FROM public.diamond_withdrawals
  WHERE idempotency_key = p_idempotency_key FOR UPDATE;
  IF FOUND THEN
    IF v_existing.user_id <> p_user_id OR v_existing.amount_diamond <> p_amount_diamond
       OR v_existing.method <> p_method
       OR v_existing.payout_details IS DISTINCT FROM coalesce(p_payout_details, '{}'::jsonb) THEN
      RAISE EXCEPTION 'Idempotency key already used with different withdrawal data';
    END IF;
    RETURN v_existing;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.admin_settings s
    WHERE s.key = 'withdrawals_enabled' AND s.value = 'true'::jsonb
  ) THEN RAISE EXCEPTION 'Diamond withdrawals are currently disabled'; END IF;

  SELECT
    EXISTS (SELECT 1 FROM public.verified_hosts vh WHERE vh.user_id = p_user_id AND vh.status = 'active'),
    EXISTS (SELECT 1 FROM public.agents a WHERE a.user_id = p_user_id AND a.status = 'active')
  INTO v_is_host, v_is_agent;
  IF NOT coalesce(v_is_host, false) AND NOT coalesce(v_is_agent, false) THEN
    RAISE EXCEPTION 'Withdrawals are available to verified hosts and agents only; regular users can convert Diamonds to Coins';
  END IF;

  -- M8.1: التحقق من الهوية إلزامي للمضيفة قبل تفعيل السحب.
  IF coalesce(v_is_host, false) THEN
    SELECT vh.identity_status INTO v_host_identity
    FROM public.verified_hosts vh WHERE vh.user_id = p_user_id;
    IF v_host_identity IS DISTINCT FROM 'verified' THEN
      RAISE EXCEPTION 'Host identity verification is required before withdrawal';
    END IF;
  END IF;

  IF p_method NOT IN ('usdt'::public.deposit_method, 'agent'::public.deposit_method) THEN
    RAISE EXCEPTION 'Withdrawals support USDT or assigned agent only';
  END IF;

  SELECT (s.value #>> '{}')::numeric INTO v_rate
  FROM public.admin_settings s WHERE s.key = 'diamonds_per_usd';
  IF coalesce(v_rate, 0) <= 0 THEN RAISE EXCEPTION 'Withdrawal rate is not configured'; END IF;
  SELECT coalesce((s.value #>> '{}')::bigint, 30000) INTO v_minimum
  FROM public.admin_settings s WHERE s.key = 'min_withdrawal_diamonds';
  SELECT coalesce((s.value #>> '{}')::numeric, 0) INTO v_fee_percent
  FROM public.admin_settings s WHERE s.key = 'withdrawal_fee_percent';
  IF v_fee_percent < 0 OR v_fee_percent >= 100 THEN RAISE EXCEPTION 'Invalid withdrawal fee setting'; END IF;
  IF p_amount_diamond < coalesce(v_minimum, 30000) THEN RAISE EXCEPTION 'Withdrawal amount is below the minimum'; END IF;

  IF p_method = 'agent'::public.deposit_method THEN
    SELECT a.id INTO v_agent_id
    FROM public.agent_group_memberships m
    JOIN public.agent_groups g ON g.id = m.group_id
    JOIN public.agents a ON a.id = g.agent_id AND a.status = 'active' AND a.can_approve_withdrawals
    WHERE m.user_id = p_user_id AND m.status = 'active'
    ORDER BY m.decided_at DESC NULLS LAST LIMIT 1;
    IF v_agent_id IS NULL THEN RAISE EXCEPTION 'No active withdrawal agent is assigned'; END IF;
  ELSE
    IF coalesce(p_payout_details->>'network', '') NOT IN ('trc20', 'bep20') THEN
      RAISE EXCEPTION 'USDT withdrawals require network trc20 or bep20';
    END IF;
    IF (p_payout_details->>'network') = 'trc20' THEN
      IF coalesce(p_payout_details->>'address', '') !~ '^T[1-9A-HJ-NP-Za-km-z]{33}$' THEN
        RAISE EXCEPTION 'Invalid TRC20 payout address';
      END IF;
    ELSE
      IF coalesce(p_payout_details->>'address', '') !~ '^0x[0-9a-fA-F]{40}$' THEN
        RAISE EXCEPTION 'Invalid BEP20 payout address';
      END IF;
    END IF;
  END IF;

  SELECT * INTO v_user FROM public.users WHERE id = p_user_id FOR UPDATE;
  IF NOT FOUND OR v_user.status <> 'active' OR v_user.adult_confirmed_at IS NULL THEN
    RAISE EXCEPTION 'Account is unavailable';
  END IF;
  IF v_user.balance_diamond < p_amount_diamond THEN RAISE EXCEPTION 'Insufficient withdrawable Diamonds'; END IF;
  v_gross := round(p_amount_diamond / v_rate, 2);
  v_fee := round(v_gross * v_fee_percent / 100, 2);
  IF v_gross <= v_fee OR v_gross - v_fee <= 0 THEN RAISE EXCEPTION 'Withdrawal amount is too small after fees'; END IF;

  SELECT coalesce((s.value #>> '{}')::numeric, 500) INTO v_max_daily
  FROM public.admin_settings s WHERE s.key = 'max_withdrawal_usd_per_day';
  v_max_daily := coalesce(v_max_daily, 500);
  SELECT coalesce(sum(w.amount_usd), 0) INTO v_daily_total
  FROM public.diamond_withdrawals w
  WHERE w.user_id = p_user_id AND w.created_at >= date_trunc('day', now())
    AND w.status IN ('pending', 'reviewing', 'approved', 'processing', 'completed');
  IF v_daily_total + v_gross > v_max_daily THEN
    RAISE EXCEPTION 'Daily withdrawal limit exceeded';
  END IF;

  INSERT INTO public.diamond_withdrawals (
    user_id, agent_id, method, payout_details, amount_diamond, amount_usd,
    fee_usd, net_usd, diamonds_per_usd, idempotency_key
  ) VALUES (
    p_user_id, v_agent_id, p_method, coalesce(p_payout_details, '{}'::jsonb),
    p_amount_diamond, v_gross, v_fee, v_gross - v_fee, v_rate, p_idempotency_key
  ) RETURNING * INTO v_withdrawal;
  PERFORM public.record_wallet_transaction(
    p_user_id, 'withdraw'::public.wallet_tx_type, -p_amount_diamond,
    'diamond', v_agent_id, 'diamond-withdrawal:' || v_withdrawal.id::text,
    'diamond_withdrawal', v_withdrawal.id,
    jsonb_build_object('amount_usd', v_gross, 'fee_usd', v_fee, 'net_usd', v_gross - v_fee),
    'withdrawal-request'
  );
  RETURN v_withdrawal;
END;
$$;
REVOKE ALL ON FUNCTION public.create_my_diamond_withdrawal(uuid, bigint, public.deposit_method, jsonb, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_my_diamond_withdrawal(uuid, bigint, public.deposit_method, jsonb, text) TO authenticated, service_role;

-- ============================================================
-- 16) حاوية مستندات الهوية
-- ============================================================
INSERT INTO storage.buckets (id, name, public)
VALUES ('host-documents', 'host-documents', false)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS wattar_host_documents_owner_insert ON storage.objects;
CREATE POLICY wattar_host_documents_owner_insert ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'host-documents'
    AND left(name, length('hostdoc_' || auth.uid()::text || '_')) = ('hostdoc_' || auth.uid()::text || '_')
  );

DROP POLICY IF EXISTS wattar_host_documents_owner_admin_select ON storage.objects;
CREATE POLICY wattar_host_documents_owner_admin_select ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'host-documents'
    AND (
      public.is_admin()
      OR left(name, length('hostdoc_' || auth.uid()::text || '_')) = ('hostdoc_' || auth.uid()::text || '_')
    )
  );

DROP POLICY IF EXISTS wattar_host_documents_owner_delete ON storage.objects;
CREATE POLICY wattar_host_documents_owner_delete ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'host-documents'
    AND left(name, length('hostdoc_' || auth.uid()::text || '_')) = ('hostdoc_' || auth.uid()::text || '_')
  );

COMMIT;
