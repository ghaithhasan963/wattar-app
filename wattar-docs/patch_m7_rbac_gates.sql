-- ============================================================
-- patch_m7_rbac_gates.sql — migration #70 (M7.1 تتمة: بوابات الصلاحيات)
--
-- بعد #69 (الأدوار والمصفوفة وTOTP):
--   1) admin_actor_authorized: فحص موحّد «إداري قديم (users.role)
--      أو موظف مفعّل بصلاحية محددة» تستخدمه الدوال الحساسة.
--   2) is_wattar_support_staff يعتمد نظام RBAC (support.view)
--      مع بقاء مسار users.role القديم للتوافق.
--   3) الدوال المالية الحساسة (تسوية الشحن/السحب) تُستدعى من دوال
--      Edge بمفتاح service_role: RBAC يُفرض في الحافة، وهنا أغلفة
--      دفاعية — service_role يمر، وأي استدعاء عميل مباشر يُرفض
--      برسالة صلاحية عربية واضحة بعد فحص الدور و2FA.
--   4) الدوال الإدارية التي تتحقق داخلياً من users.role فقط
--      (حالة المستخدم، كلمات الإشراف، أفعال الغرف) أصبحت تقبل
--      موظفين بصلاحية مطابقة كي لا تُكسر بعد فتح Edge للموظفين.
--   5) edge_required_permissions: مرجع مركزي (يُقرأ من Edge بمفتاح
--      الخدمة) يوثّق الصلاحية المطلوبة لكل مجموعة إجراءات Edge.
--
-- التراجع: إعادة تعريف الدوال من ترحيلاتها السابقة وإعادة تسمية
-- الدوال *_int إلى أسمائها الأصلية.
-- ============================================================
BEGIN;

SELECT set_config('request.jwt.claims', jsonb_build_object('role', 'service_role')::text, false);
SET search_path = public, extensions;

-- ============================================================
-- 1) الفحص الموحّد للفاعل الإداري
-- ============================================================
CREATE OR REPLACE FUNCTION public.admin_actor_authorized(p_user_id uuid, p_permission text)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.users u
    WHERE u.id = p_user_id
      AND u.status = 'active'
      AND (u.role IN ('admin', 'super_admin')
           OR public.admin_staff_can(u.id, p_permission))
  );
$$;
REVOKE ALL ON FUNCTION public.admin_actor_authorized(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_actor_authorized(uuid, text) TO service_role;

-- ============================================================
-- 2) الدعم: الموظف بصلاحية support.view يُعد طاقم دعم
-- ============================================================
CREATE OR REPLACE FUNCTION public.is_wattar_support_staff()
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.users
    WHERE id = auth.uid()
      AND status = 'active'
      AND (role IN ('support', 'admin', 'super_admin')
           OR public.admin_staff_can(auth.uid(), 'support.view'))
  );
$$;
REVOKE ALL ON FUNCTION public.is_wattar_support_staff() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_wattar_support_staff() TO authenticated;

-- ============================================================
-- 3) مرجع صلاحيات إجراءات Edge (يُقرأ بمفتاح service_role فقط)
-- ============================================================
CREATE OR REPLACE FUNCTION public.edge_required_permissions()
RETURNS TABLE(edge_function text, required_permission text, description text)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
  VALUES
    ('deposit-approve',        'deposits.manage',          'مراجعة وقبول/رفض طلبات الشحن'),
    ('withdrawal-approve',     'withdrawals.manage',       'مراجعة وقبول/رفض طلبات السحب'),
    ('admin-agencies',         'agencies.manage',          'إدارة الوكالات والاعتماد والتمويل'),
    ('admin-create-agent',     'agents.manage',            'إنشاء وكلاء'),
    ('admin-credit-agent',     'agents.manage',            'شحن محافظ الوكلاء'),
    ('admin-set-agent-status', 'agents.manage',            'حالة الوكلاء وتعيين وكالاتهم'),
    ('admin-moderation',       'moderation.manage',        'قواعد الإشراف والكلمات الممنوعة'),
    ('admin-set-user-status',  'users.manage',             'حالة المستخدم والحظر والتعليق'),
    ('admin-delete-user',      'users.manage',             'حذف حسابات المستخدمين'),
    ('admin-reset-user-password', 'users.manage',          'إعادة تعيين كلمات المرور'),
    ('admin-create-support',   'support.manage',           'إنشاء حسابات الدعم'),
    ('admin-create-host',      'hosts.applications.manage','إنشاء حساب مضيفة'),
    ('admin-manage-host',      'hosts.applications.manage','إدارة توثيق المضيفات'),
    ('host-application-review','hosts.applications.manage','مراجعة طلبات توثيق المضيفات'),
    ('admin-set-rtp',          'games.manage',             'ضبط RTP للألعاب'),
    ('admin-force-outcome',    'games.manage',             'فرض نتيجة جولة'),
    ('room-manage-action',     'rooms.manage',             'أفعال إدارية على الغرف')
$$;
REVOKE ALL ON FUNCTION public.edge_required_permissions() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.edge_required_permissions() TO service_role;

-- ============================================================
-- 4) أغلفة دفاعية: الشحن والسحب
--    الأصل *_int يبقى للمسار الخدمي (service_role) القائم عبر
--    دوال Edge؛ الاسم الأصلي صار بوابة: service_role يمر،
--    والاستدعاء المباشر من العميل يُرفض بعد فحص الدور و2FA.
-- ============================================================
ALTER FUNCTION public.settle_deposit_request(uuid, text, uuid, text, text)
  RENAME TO settle_deposit_request_int;

CREATE OR REPLACE FUNCTION public.settle_deposit_request(
  p_deposit_id uuid,
  p_action text,
  p_reviewer_id uuid,
  p_reason text DEFAULT NULL,
  p_notes text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF auth.role() = 'service_role' THEN
    RETURN public.settle_deposit_request_int(p_deposit_id, p_action, p_reviewer_id, p_reason, p_notes);
  END IF;
  IF v_uid IS NULL OR p_reviewer_id IS DISTINCT FROM v_uid THEN
    RAISE EXCEPTION 'يجب تنفيذ الإجراء بهوية المستخدم المصادق عليها';
  END IF;
  IF NOT public.admin_staff_can(v_uid, 'deposits.manage') THEN
    RAISE EXCEPTION 'صلاحية إدارة الشحن غير متوفرة لدورك';
  END IF;
  IF NOT public.admin_2fa_gate_ok(v_uid, true) THEN
    RAISE EXCEPTION 'التحقق بخطوتين مطلوب — أدخل رمز التحقق ثم أعد المحاولة';
  END IF;
  RAISE EXCEPTION 'تسويات الشحن تُنفَّذ حصراً عبر قناة الإدارة الآمنة';
END;
$$;
REVOKE ALL ON FUNCTION public.settle_deposit_request(uuid, text, uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.settle_deposit_request(uuid, text, uuid, text, text) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.settle_deposit_request_int(uuid, text, uuid, text, text) FROM PUBLIC, anon, authenticated;

ALTER FUNCTION public.settle_diamond_withdrawal(uuid, text, uuid, text, text, text)
  RENAME TO settle_diamond_withdrawal_int;

CREATE OR REPLACE FUNCTION public.settle_diamond_withdrawal(
  p_withdrawal_id uuid,
  p_action text,
  p_reviewer_id uuid,
  p_proof_url text DEFAULT NULL,
  p_external_ref text DEFAULT NULL,
  p_reason text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF auth.role() = 'service_role' THEN
    RETURN public.settle_diamond_withdrawal_int(p_withdrawal_id, p_action, p_reviewer_id, p_proof_url, p_external_ref, p_reason);
  END IF;
  IF v_uid IS NULL OR p_reviewer_id IS DISTINCT FROM v_uid THEN
    RAISE EXCEPTION 'يجب تنفيذ الإجراء بهوية المستخدم المصادق عليها';
  END IF;
  IF NOT public.admin_staff_can(v_uid, 'withdrawals.manage') THEN
    RAISE EXCEPTION 'صلاحية إدارة السحب غير متوفرة لدورك';
  END IF;
  IF NOT public.admin_2fa_gate_ok(v_uid, true) THEN
    RAISE EXCEPTION 'التحقق بخطوتين مطلوب — أدخل رمز التحقق ثم أعد المحاولة';
  END IF;
  RAISE EXCEPTION 'تسويات السحب تُنفَّذ حصراً عبر قناة الإدارة الآمنة';
END;
$$;
REVOKE ALL ON FUNCTION public.settle_diamond_withdrawal(uuid, text, uuid, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.settle_diamond_withdrawal(uuid, text, uuid, text, text, text) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.settle_diamond_withdrawal_int(uuid, text, uuid, text, text, text) FROM PUBLIC, anon, authenticated;

-- ============================================================
-- 5) أفعال الإدارة على الغرف: موظف بصلاحية rooms.manage يكفي
--    (سابقاً is_admin() فقط — أي users.role).
-- ============================================================
CREATE OR REPLACE FUNCTION public.admin_room_action(
  p_admin_id uuid,
  p_room_id uuid,
  p_action text,
  p_target_user_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_admin uuid := auth.uid();
  v_room public.rooms%ROWTYPE;
  v_rows integer;
BEGIN
  IF v_admin IS NULL OR p_admin_id IS DISTINCT FROM v_admin
     OR NOT (public.is_admin() OR public.admin_staff_can(v_admin, 'rooms.manage')) THEN
    RAISE EXCEPTION 'هذه العملية تتطلب صلاحية إدارة الغرف';
  END IF;
  IF p_action NOT IN ('clear_password', 'unban_user', 'reopen_room', 'force_close') THEN
    RAISE EXCEPTION 'إجراء إداري غير صالح';
  END IF;

  SELECT * INTO v_room FROM public.rooms WHERE id = p_room_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'الغرفة غير موجودة'; END IF;

  IF p_action = 'clear_password' THEN
    DELETE FROM public.room_passwords WHERE room_id = p_room_id;
    GET DIAGNOSTICS v_rows = ROW_COUNT;
    IF v_rows = 0 THEN RAISE EXCEPTION 'لا توجد كلمة مرور على الغرفة'; END IF;
    UPDATE public.rooms SET has_password = false, updated_at = now() WHERE id = p_room_id;

  ELSIF p_action = 'unban_user' THEN
    IF p_target_user_id IS NULL THEN RAISE EXCEPTION 'حدد المستخدم المطلوب رفع حظره'; END IF;
    DELETE FROM public.room_bans WHERE room_id = p_room_id AND user_id = p_target_user_id;
    GET DIAGNOSTICS v_rows = ROW_COUNT;
    IF v_rows = 0 THEN RAISE EXCEPTION 'هذا المستخدم غير محظور من الغرفة'; END IF;

  ELSIF p_action = 'reopen_room' THEN
    IF v_room.status <> 'closed' THEN RAISE EXCEPTION 'الغرفة مفتوحة بالفعل'; END IF;
    UPDATE public.rooms
       SET status = 'live', ended_at = NULL,
           started_at = coalesce(started_at, now()), updated_at = now()
     WHERE id = p_room_id;
    UPDATE public.room_seats
       SET user_id = v_room.owner_id, status = 'occupied', is_mic_on = false,
           joined_at = now(), updated_at = now()
     WHERE room_id = p_room_id AND seat_index = 0
       AND user_id IS NULL AND status = 'empty';

  ELSIF p_action = 'force_close' THEN
    IF v_room.status = 'closed' THEN RAISE EXCEPTION 'الغرفة مغلقة بالفعل'; END IF;
    UPDATE public.room_seats
       SET user_id = NULL, status = 'empty', is_mic_on = false, joined_at = NULL, updated_at = now()
     WHERE room_id = p_room_id;
    DELETE FROM public.room_presence WHERE room_id = p_room_id;
    UPDATE public.room_seat_requests
       SET status = 'cancelled', decided_at = now()
     WHERE room_id = p_room_id AND status = 'pending';
    UPDATE public.rooms
       SET status = 'closed', ended_at = coalesce(ended_at, now()), updated_at = now()
     WHERE id = p_room_id;
  END IF;

  INSERT INTO public.room_moderation_audit (
    room_id, actor_id, target_user_id, action, actor_role, reason
  ) VALUES (
    p_room_id, v_admin, p_target_user_id,
    CASE p_action WHEN 'force_close' THEN 'close_room' ELSE p_action END,
    'admin', 'إجراء إداري أعلى'
  );

  RETURN jsonb_build_object('room_id', p_room_id, 'action', p_action);
END;
$$;
REVOKE ALL ON FUNCTION public.admin_room_action(uuid, uuid, text, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_room_action(uuid, uuid, text, uuid) TO authenticated;

-- ============================================================
-- 6) حالة المستخدم: تقبل موظفاً بصلاحية users.manage
--    (تُستدعى من Edge admin-set-user-status بمفتاح الخدمة)
-- ============================================================
CREATE OR REPLACE FUNCTION public.admin_set_user_status(
  p_admin_id uuid,
  p_target_user_id uuid,
  p_new_status text,
  p_reason text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_admin public.users%ROWTYPE;
  v_target public.users%ROWTYPE;
  v_action public.audit_action_type;
  v_reason text := nullif(btrim(p_reason), '');
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'غير مصرح بتنفيذ الإجراء الإداري';
  END IF;
  IF p_admin_id IS NULL OR p_target_user_id IS NULL OR p_admin_id = p_target_user_id THEN
    RAISE EXCEPTION 'الحساب المستهدف غير صالح';
  END IF;
  IF p_new_status IS NULL OR p_new_status NOT IN ('active', 'suspended', 'banned') THEN
    RAISE EXCEPTION 'حالة الحساب غير صالحة';
  END IF;
  IF (p_new_status <> 'active' AND v_reason IS NULL)
     OR (v_reason IS NOT NULL AND char_length(v_reason) > 500) THEN
    RAISE EXCEPTION 'أدخل سببًا واضحًا لا يتجاوز 500 حرف';
  END IF;

  SELECT * INTO v_admin
  FROM public.users
  WHERE id = p_admin_id
  FOR UPDATE;
  IF NOT FOUND OR v_admin.status <> 'active'
     OR NOT public.admin_actor_authorized(p_admin_id, 'users.manage') THEN
    RAISE EXCEPTION 'لا تملك صلاحية تنفيذ هذا الإجراء';
  END IF;

  SELECT * INTO v_target
  FROM public.users
  WHERE id = p_target_user_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'الحساب المستهدف غير موجود';
  END IF;
  IF v_target.role NOT IN ('user', 'guest') THEN
    RAISE EXCEPTION 'إجراء الحالة متاح لحسابات المستخدمين فقط';
  END IF;
  IF v_target.status::text = p_new_status THEN
    RAISE EXCEPTION 'الحساب موجود بالفعل بهذه الحالة';
  END IF;

  v_action := CASE p_new_status
    WHEN 'suspended' THEN 'suspend'::public.audit_action_type
    WHEN 'banned' THEN 'ban'::public.audit_action_type
    ELSE 'unban'::public.audit_action_type
  END;

  UPDATE public.users
  SET status = p_new_status::public.user_status,
      banned_reason = CASE WHEN p_new_status = 'active' THEN NULL ELSE v_reason END,
      banned_until = NULL,
      updated_at = now()
  WHERE id = p_target_user_id;

  INSERT INTO public.admin_audit_log (
    admin_id, action, target_type, target_id, before, after, metadata
  ) VALUES (
    p_admin_id,
    v_action,
    'user',
    p_target_user_id,
    jsonb_build_object(
      'status', v_target.status,
      'banned_reason', v_target.banned_reason,
      'banned_until', v_target.banned_until
    ),
    jsonb_build_object(
      'status', p_new_status,
      'banned_reason', CASE WHEN p_new_status = 'active' THEN NULL ELSE v_reason END,
      'banned_until', NULL
    ),
    jsonb_build_object(
      'reason', v_reason,
      'permanent', p_new_status = 'banned'
    )
  );

  RETURN jsonb_build_object(
    'user_id', p_target_user_id,
    'status', p_new_status,
    'permanent', p_new_status = 'banned'
  );
END;
$$;
REVOKE ALL ON FUNCTION public.admin_set_user_status(uuid, uuid, text, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_set_user_status(uuid, uuid, text, text)
  TO service_role;

-- ============================================================
-- 7) كلمات الإشراف: تقبل موظفاً بصلاحية moderation.manage
--    (تُستدعيان من Edge admin-moderation بمفتاح الخدمة)
-- ============================================================
CREATE OR REPLACE FUNCTION public.admin_upsert_moderation_word(
  p_admin_id uuid,
  p_list_type text,
  p_word text,
  p_severity text DEFAULT 'medium',
  p_room_id uuid DEFAULT NULL,
  p_is_active boolean DEFAULT true,
  p_reason text DEFAULT NULL
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
  v_reason text := nullif(left(btrim(coalesce(p_reason, '')), 500), '');
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
     OR NOT public.admin_actor_authorized(p_admin_id, 'moderation.manage') THEN
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
    jsonb_build_object('upsert', true, 'reason', v_reason)
  );

  RETURN v_id;
END;
$function$;
REVOKE ALL ON FUNCTION public.admin_upsert_moderation_word(uuid, text, text, text, uuid, boolean, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_upsert_moderation_word(uuid, text, text, text, uuid, boolean, text)
  TO service_role;

CREATE OR REPLACE FUNCTION public.admin_delete_moderation_word(
  p_admin_id uuid,
  p_word_id uuid,
  p_reason text DEFAULT NULL
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
  v_reason text := nullif(left(btrim(coalesce(p_reason, '')), 500), '');
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'غير مصرح بتنفيذ الإجراء الإداري';
  END IF;

  SELECT * INTO v_admin FROM public.users WHERE id = p_admin_id FOR SHARE;
  IF NOT FOUND OR v_admin.status <> 'active'
     OR NOT public.admin_actor_authorized(p_admin_id, 'moderation.manage') THEN
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
    jsonb_build_object('deleted', true, 'reason', v_reason)
  );

  RETURN jsonb_build_object('deleted', true, 'word_id', p_word_id);
END;
$function$;
REVOKE ALL ON FUNCTION public.admin_delete_moderation_word(uuid, uuid, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_delete_moderation_word(uuid, uuid, text)
  TO service_role;

COMMIT;
