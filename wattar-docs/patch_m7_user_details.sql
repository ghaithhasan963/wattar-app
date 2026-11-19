-- ============================================================
-- patch_m7_user_details.sql — migration #72 (M7.3 تفاصيل المستخدم)
--
-- 1) صلاحية جديدة wallets.manage (تعديل أرصدة المستخدمين) — مالية.
-- 2) admin_get_user_detail(p_admin_id, p_user_id): قراءة شاملة لملف
--    المستخدم + المحفظة + آخر الحركات + جلسات الأجهزة + العقوبات +
--    البلاغات + الغرف.
-- 3) admin_adjust_user_balance(p_admin_id, p_user_id, ...): تعديل رصيد
--    بسبب إلزامي (10–500 حرف)، عبر record_wallet_transaction
--    (نوع admin_adjustment، entry_kind=adjustment)، مع تدقيق قبل/بعد
--    في admin_audit_log.
-- 4) admin_reverse_user_transaction(p_admin_id, p_transaction_id, ...):
--    قيد عكسي موثّق لحركة سابقة، بسبب إلزامي، يمنع عكس العكس ويمنع
--    تكرار العكس.
--
-- كل الدوال: SECURITY DEFINER + تأخذ p_admin_id كمعامل أول (مثل
-- admin_set_user_status / admin_room_action) + تُستدعى من Edge
-- بمفتاح service_role أو مباشرة من المستخدم نفسه إذا كان أدمن/
-- موظف وله الصلاحية. منح authenticated وservice_role فقط.
-- ============================================================
BEGIN;

SELECT set_config('request.jwt.claims', jsonb_build_object('role', 'service_role')::text, false);
SET search_path = public, extensions;

-- ------------------------------------------------------------
-- 1) الصلاحية الجديدة
-- ------------------------------------------------------------
INSERT INTO public.admin_permission_catalog (permission, category, description)
VALUES ('wallets.manage', 'المالية', 'تعديل أرصدة المستخدمين بقيد عكسي وسبب إلزامي')
ON CONFLICT (permission) DO UPDATE
  SET category = excluded.category,
      description = excluded.description;

INSERT INTO public.admin_role_permissions (staff_role, permission, allowed)
VALUES ('super_admin'::public.admin_staff_role, 'wallets.manage', true)
ON CONFLICT (staff_role, permission) DO NOTHING;

INSERT INTO public.admin_role_permissions (staff_role, permission, allowed)
VALUES ('finance'::public.admin_staff_role, 'wallets.manage', true)
ON CONFLICT (staff_role, permission) DO NOTHING;

-- ------------------------------------------------------------
-- 2) قراءة تفاصيل المستخدم
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_get_user_detail(
  p_admin_id uuid,
  p_user_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_user public.users%ROWTYPE;
BEGIN
  IF p_admin_id IS NULL THEN
    RAISE EXCEPTION 'معرّف المسؤول مطلوب';
  END IF;
  IF auth.role() <> 'service_role' AND auth.uid() IS DISTINCT FROM p_admin_id THEN
    RAISE EXCEPTION 'لا يمكنك الاطلاع على تفاصيل مستخدم نيابة عن مسؤول آخر';
  END IF;
  IF NOT (public.is_admin()
          OR public.admin_staff_can(p_admin_id, 'users.view')
          OR public.admin_staff_can(p_admin_id, 'wallets.view')) THEN
    RAISE EXCEPTION 'لا تملك صلاحية عرض تفاصيل المستخدم';
  END IF;
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'معرّف المستخدم مطلوب';
  END IF;

  SELECT * INTO v_user FROM public.users WHERE id = p_user_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'المستخدم غير موجود';
  END IF;

  RETURN jsonb_build_object(
    'profile', jsonb_build_object(
      'id', v_user.id,
      'username', v_user.username,
      'display_name', v_user.display_name,
      'avatar_url', v_user.avatar_url,
      'bio', v_user.bio,
      'phone', v_user.phone,
      'email', v_user.email,
      'role', v_user.role,
      'status', v_user.status,
      'banned_reason', v_user.banned_reason,
      'banned_until', v_user.banned_until,
      'gender', v_user.gender,
      'profile_visibility', v_user.profile_visibility,
      'adult_confirmed_at', v_user.adult_confirmed_at,
      'onboarding_completed_at', v_user.onboarding_completed_at,
      'created_at', v_user.created_at,
      'last_login_at', v_user.last_login_at,
      'last_seen_at', v_user.last_seen_at,
      'platform', v_user.platform,
      'app_version', v_user.app_version,
      'preferred_language', v_user.preferred_language,
      'level', v_user.level,
      'experience_points', v_user.experience_points,
      'referral_code', v_user.referral_code,
      'referred_by_user_id', v_user.referred_by_user_id,
      'referred_by_agent_id', v_user.referred_by_agent_id,
      'rtp_override', v_user.rtp_override,
      'is_force_win', v_user.is_force_win,
      'is_force_lose', v_user.is_force_lose,
      'privacy', jsonb_build_object(
        'can_follow', v_user.privacy_can_follow,
        'can_message', v_user.privacy_can_message,
        'can_friend_request', v_user.privacy_can_friend_request,
        'can_view_stories', v_user.privacy_can_view_stories,
        'can_view_info', v_user.privacy_can_view_info,
        'can_enter_rooms', v_user.privacy_can_enter_rooms
      )
    ),
    'wallet', jsonb_build_object(
      'balance_gold', v_user.balance_gold,
      'balance_diamond', v_user.balance_diamond,
      'balance_converted_coins', v_user.balance_converted_coins,
      'balance_diamond_promo', v_user.balance_diamond_promo,
      'total_deposited', v_user.total_deposited,
      'total_withdrawn', v_user.total_withdrawn,
      'total_wagered', v_user.total_wagered,
      'total_won', v_user.total_won,
      'total_gifts_sent', v_user.total_gifts_sent,
      'total_gifts_received', v_user.total_gifts_received
    ),
    'stats', jsonb_build_object(
      'wallet_transactions', (SELECT count(*) FROM public.wallet_transactions WHERE user_id = p_user_id),
      'deposits_total', (SELECT count(*) FROM public.deposits WHERE user_id = p_user_id),
      'deposits_pending', (SELECT count(*) FROM public.deposits WHERE user_id = p_user_id AND status IN ('pending', 'reviewing')),
      'withdrawals_total', (SELECT count(*) FROM public.withdrawals WHERE user_id = p_user_id),
      'withdrawals_pending', (SELECT count(*) FROM public.withdrawals WHERE user_id = p_user_id AND status IN ('pending', 'reviewing', 'processing')),
      'gifts_sent', (SELECT count(*) FROM public.gift_transactions WHERE from_user_id = p_user_id),
      'gifts_received', (SELECT count(*) FROM public.gift_transactions WHERE to_user_id = p_user_id),
      'rooms_owned', (SELECT count(*) FROM public.rooms WHERE owner_id = p_user_id),
      'active_sessions', (SELECT count(*) FROM public.user_sessions WHERE user_id = p_user_id AND is_active),
      'pending_reports', (SELECT count(*) FROM public.user_reports WHERE reported_id = p_user_id AND status = 'pending'),
      'active_penalties', (SELECT count(*) FROM public.user_penalties
                           WHERE user_id = p_user_id AND revoked_at IS NULL
                             AND (ends_at IS NULL OR ends_at > now()))
    ),
    'host', (
      SELECT jsonb_build_object(
        'status', h.status,
        'approved_at', h.approved_at,
        'platform_commission_percent', h.platform_commission_percent,
        'agent_commission_percent', h.agent_commission_percent
      )
      FROM public.verified_hosts h WHERE h.user_id = p_user_id
    ),
    'transactions', coalesce((
      SELECT jsonb_agg(t ORDER BY t.created_at DESC)
      FROM (
        SELECT wt.id, wt.type, wt.amount, wt.currency,
               wt.balance_before, wt.balance_after,
               wt.reason, wt.created_by_function, wt.entry_kind,
               wt.reversal_of, wt.executed_by_role, wt.created_at,
               (SELECT r.id FROM public.wallet_transactions r
                 WHERE r.reversal_of = wt.id LIMIT 1) AS reversed_by
        FROM public.wallet_transactions wt
        WHERE wt.user_id = p_user_id
        ORDER BY wt.created_at DESC
        LIMIT 50
      ) t
    ), '[]'::jsonb),
    'sessions', coalesce((
      SELECT jsonb_agg(s ORDER BY s.last_used_at DESC NULLS LAST, s.created_at DESC)
      FROM (
        SELECT us.id, us.device_info, us.ip_address::text AS ip_address,
               us.user_agent, us.is_active, us.last_used_at,
               us.expires_at, us.created_at, us.device_id
        FROM public.user_sessions us
        WHERE us.user_id = p_user_id
        ORDER BY us.last_used_at DESC NULLS LAST, us.created_at DESC
        LIMIT 20
      ) s
    ), '[]'::jsonb),
    'penalties', coalesce((
      SELECT jsonb_agg(p ORDER BY p.created_at DESC)
      FROM (
        SELECT up.id, up.penalty_type, up.reason, up.starts_at, up.ends_at,
               up.revoked_at, up.revoke_reason, up.created_at
        FROM public.user_penalties up
        WHERE up.user_id = p_user_id
        ORDER BY up.created_at DESC
        LIMIT 10
      ) p
    ), '[]'::jsonb),
    'reports_against', coalesce((
      SELECT jsonb_agg(r ORDER BY r.created_at DESC)
      FROM (
        SELECT ur.id, ur.reason, ur.status, ur.decision_note, ur.created_at,
               ur.reporter_id,
               (SELECT coalesce(u.display_name, u.username)
                  FROM public.users u WHERE u.id = ur.reporter_id) AS reporter_name
        FROM public.user_reports ur
        WHERE ur.reported_id = p_user_id
        ORDER BY ur.created_at DESC
        LIMIT 10
      ) r
    ), '[]'::jsonb),
    'rooms_owned', coalesce((
      SELECT jsonb_agg(r ORDER BY r.created_at DESC)
      FROM (
        SELECT ro.id, ro.name, ro.status, ro.listeners_count, ro.created_at
        FROM public.rooms ro
        WHERE ro.owner_id = p_user_id
        ORDER BY ro.created_at DESC
        LIMIT 10
      ) r
    ), '[]'::jsonb)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_get_user_detail(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_get_user_detail(uuid, uuid) TO authenticated, service_role;

-- ------------------------------------------------------------
-- 3) تعديل الرصيد بسبب إلزامي
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_adjust_user_balance(
  p_admin_id uuid,
  p_user_id uuid,
  p_currency text,
  p_amount bigint,
  p_reason text,
  p_idempotency_key text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_reason text := nullif(btrim(p_reason), '');
  v_target public.users%ROWTYPE;
  v_before bigint;
  v_after bigint;
  v_tx uuid;
BEGIN
  IF p_admin_id IS NULL THEN
    RAISE EXCEPTION 'معرّف المسؤول مطلوب';
  END IF;
  IF auth.role() <> 'service_role' AND auth.uid() IS DISTINCT FROM p_admin_id THEN
    RAISE EXCEPTION 'لا يمكنك تعديل رصيد مستخدم نيابة عن مسؤول آخر';
  END IF;
  IF NOT (public.is_admin()
          OR public.admin_staff_can(p_admin_id, 'wallets.manage')) THEN
    RAISE EXCEPTION 'تعديل الأرصدة يتطلب صلاحية إدارة المحافظ';
  END IF;
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'معرّف المستخدم مطلوب';
  END IF;
  IF p_currency IS NULL OR p_currency NOT IN ('gold', 'diamond', 'conv_gold', 'promo_dia') THEN
    RAISE EXCEPTION 'العملة غير صالحة';
  END IF;
  IF p_amount IS NULL OR p_amount = 0 OR p_amount > 1000000000 OR p_amount < -1000000000 THEN
    RAISE EXCEPTION 'المبلغ غير صالح (لا صفر، والحد الأقصى مليار)';
  END IF;
  IF v_reason IS NULL OR char_length(v_reason) < 10 OR char_length(v_reason) > 500 THEN
    RAISE EXCEPTION 'أدخل سببًا واضحًا بين 10 و500 حرف';
  END IF;

  SELECT * INTO v_target FROM public.users WHERE id = p_user_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'المستخدم غير موجود';
  END IF;

  v_before := CASE p_currency
    WHEN 'gold' THEN v_target.balance_gold
    WHEN 'diamond' THEN v_target.balance_diamond
    WHEN 'conv_gold' THEN v_target.balance_converted_coins
    ELSE v_target.balance_diamond_promo
  END;
  v_after := v_before + p_amount;
  IF v_after < 0 THEN
    RAISE EXCEPTION 'الرصيد الحالي لا يكفي لخصم هذا المبلغ (المتاح: %)', v_before;
  END IF;

  v_tx := public.record_wallet_transaction(
    p_user_id => p_user_id,
    p_type => 'admin_adjustment'::public.wallet_tx_type,
    p_amount => p_amount,
    p_currency => p_currency,
    p_idempotency_key => nullif(btrim(p_idempotency_key), ''),
    p_reference_type => 'admin_adjustment',
    p_metadata => jsonb_build_object(
      'source', 'admin_panel',
      'admin_id', p_admin_id,
      'reason', v_reason
    ),
    p_function_name => 'admin-adjust-user-balance',
    p_reason => v_reason,
    p_executed_by => p_admin_id,
    p_executed_by_role => 'admin',
    p_entry_kind => 'adjustment'
  );

  INSERT INTO public.admin_audit_log (
    admin_id, action, target_type, target_id, before, after, reason, metadata
  ) VALUES (
    p_admin_id,
    'adjust_balance'::public.audit_action_type,
    'user',
    p_user_id,
    jsonb_build_object(
      'currency', p_currency,
      'balance_before', v_before,
      'balance_gold', v_target.balance_gold,
      'balance_diamond', v_target.balance_diamond
    ),
    jsonb_build_object(
      'currency', p_currency,
      'balance_after', v_after,
      'wallet_transaction_id', v_tx
    ),
    v_reason,
    jsonb_build_object('source', 'admin_panel', 'amount', p_amount)
  );

  RETURN jsonb_build_object(
    'transaction_id', v_tx,
    'user_id', p_user_id,
    'currency', p_currency,
    'amount', p_amount,
    'balance_before', v_before,
    'balance_after', v_after
  );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_adjust_user_balance(uuid, uuid, text, bigint, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_adjust_user_balance(uuid, uuid, text, bigint, text, text) TO authenticated, service_role;

-- ------------------------------------------------------------
-- 4) القيد العكسي (نسخة اللوحة المحمية بالصلاحية)
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_reverse_user_transaction(
  p_admin_id uuid,
  p_transaction_id uuid,
  p_reason text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_reason text := nullif(btrim(p_reason), '');
  v_original public.wallet_transactions%ROWTYPE;
  v_user public.users%ROWTYPE;
  v_after bigint;
  v_existing uuid;
  v_reversal uuid;
BEGIN
  IF p_admin_id IS NULL THEN
    RAISE EXCEPTION 'معرّف المسؤول مطلوب';
  END IF;
  IF auth.role() <> 'service_role' AND auth.uid() IS DISTINCT FROM p_admin_id THEN
    RAISE EXCEPTION 'لا يمكنك عكس قيد نيابة عن مسؤول آخر';
  END IF;
  IF NOT (public.is_admin()
          OR public.admin_staff_can(p_admin_id, 'wallets.manage')) THEN
    RAISE EXCEPTION 'عكس القيود يتطلب صلاحية إدارة المحافظ';
  END IF;
  IF p_transaction_id IS NULL THEN
    RAISE EXCEPTION 'معرّف الحركة مطلوب';
  END IF;
  IF v_reason IS NULL OR char_length(v_reason) < 10 OR char_length(v_reason) > 500 THEN
    RAISE EXCEPTION 'أدخل سببًا واضحًا بين 10 و500 حرف';
  END IF;

  SELECT * INTO v_original
  FROM public.wallet_transactions
  WHERE id = p_transaction_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'الحركة الأصلية غير موجودة';
  END IF;
  IF v_original.entry_kind = 'reversal' THEN
    RAISE EXCEPTION 'لا يمكن عكس قيد عكسي';
  END IF;

  SELECT id INTO v_existing
  FROM public.wallet_transactions
  WHERE reversal_of = p_transaction_id;
  IF FOUND THEN
    RAISE EXCEPTION 'هذه الحركة معكوسة مسبقًا بالقيد %', v_existing;
  END IF;

  SELECT * INTO v_user FROM public.users WHERE id = v_original.user_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'صاحب المحفظة غير موجود';
  END IF;

  v_after := CASE v_original.currency
    WHEN 'gold' THEN v_user.balance_gold
    WHEN 'diamond' THEN v_user.balance_diamond
    WHEN 'conv_gold' THEN v_user.balance_converted_coins
    ELSE v_user.balance_diamond_promo
  END + (-v_original.amount);
  IF v_after < 0 THEN
    RAISE EXCEPTION 'عكس الحركة يجعل الرصيد سالبًا؛ عدّل الرصيد أولًا';
  END IF;

  v_reversal := public.record_wallet_transaction(
    p_user_id => v_original.user_id,
    p_type => v_original.type,
    p_amount => -v_original.amount,
    p_currency => v_original.currency,
    p_agent_id => v_original.agent_id,
    p_reference_type => v_original.reference_type,
    p_reference_id => v_original.reference_id,
    p_metadata => coalesce(v_original.metadata, '{}'::jsonb) || jsonb_build_object('reversal_of', p_transaction_id),
    p_function_name => 'admin-reverse-user-transaction',
    p_reason => v_reason,
    p_executed_by => p_admin_id,
    p_executed_by_role => 'admin',
    p_rates_snapshot => v_original.rates_snapshot,
    p_pair_id => v_original.pair_id,
    p_entry_kind => 'reversal',
    p_reversal_of => p_transaction_id
  );

  INSERT INTO public.admin_audit_log (
    admin_id, action, target_type, target_id, before, after, reason, metadata
  ) VALUES (
    p_admin_id,
    'adjust_balance'::public.audit_action_type,
    'wallet_transaction',
    p_transaction_id,
    to_jsonb(v_original) - 'metadata',
    jsonb_build_object('reversal_transaction_id', v_reversal),
    v_reason,
    jsonb_build_object('source', 'admin_panel', 'reversal', true)
  );

  RETURN jsonb_build_object(
    'success', true,
    'original_transaction_id', p_transaction_id,
    'reversal_transaction_id', v_reversal,
    'user_id', v_original.user_id,
    'amount', -v_original.amount,
    'currency', v_original.currency,
    'balance_after', v_after
  );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_reverse_user_transaction(uuid, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_reverse_user_transaction(uuid, uuid, text) TO authenticated, service_role;

COMMIT;
