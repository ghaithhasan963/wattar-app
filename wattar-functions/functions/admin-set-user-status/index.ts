import {
  authenticate,
  errorResponse,
  getSupabaseAdmin,
  HttpError,
  jsonResponse,
  parseBody,
  rateLimitByUser,
  requireStaffPermissionOr,
  validateBody,
} from '../_shared/supabase.ts';

interface SetUserStatusBody {
  user_id: string;
  status: 'active' | 'suspended' | 'banned';
  reason?: string;
}

const USER_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const LONG_BAN_DURATION = '876000h';

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return jsonResponse({}, 200);
  if (req.method !== 'POST') return jsonResponse({ error: 'METHOD_NOT_ALLOWED' }, 405);

  try {
    const admin = await authenticate(req, { allowStaffWithoutAdultConfirmation: true });
    await requireStaffPermissionOr(admin, 'users.manage', 'admin', 'super_admin');
    await rateLimitByUser(admin, 'admin_set_user_status', 20, 60_000);

    const body = validateBody<SetUserStatusBody>(
      await parseBody<SetUserStatusBody>(req),
      ['user_id', 'status'],
    );
    if (!body.user_id || !USER_ID_PATTERN.test(body.user_id)) {
      throw new HttpError(400, 'INVALID_USER_ID', 'A valid user_id is required');
    }
    if (!['active', 'suspended', 'banned'].includes(body.status)) {
      throw new HttpError(400, 'INVALID_STATUS', 'status must be active, suspended, or banned');
    }
    const reason = body.reason?.trim() ?? '';
    if (body.status !== 'active' && (!reason || reason.length > 500)) {
      throw new HttpError(400, 'INVALID_REASON', 'A reason of 1 to 500 characters is required');
    }

    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase.rpc('admin_set_user_status', {
      p_admin_id: admin.user_id,
      p_target_user_id: body.user_id,
      p_new_status: body.status,
      p_reason: reason || null,
    });
    if (error) {
      console.error('[Wattar] Audited user-status update failed:', error.message);
      throw new HttpError(400, 'STATUS_UPDATE_FAILED', error.message);
    }

    // The database status is authoritative, but an already-issued JWT stays
    // valid until it expires. Ban/unban the Auth user so a suspended account
    // cannot keep using an old token.
    const { error: authError } = await supabase.auth.admin.updateUserById(body.user_id, {
      ban_duration: body.status === 'active' ? 'none' : LONG_BAN_DURATION,
    });
    if (authError) {
      console.error('[Wattar] Auth session revocation failed after user-status change:', authError.message);
      throw new HttpError(
        502,
        'AUTH_STATUS_UPDATE_FAILED',
        'تم تحديث حالة الحساب في القاعدة لكن تعذّر إلغاء جلسة الدخول. أعد المحاولة أو راجع الحساب قبل إعادة التفعيل.',
      );
    }

    if (body.status !== 'active') {
      const { error: sessionError } = await supabase
        .from('user_sessions')
        .update({ is_active: false })
        .eq('user_id', body.user_id)
        .eq('is_active', true);
      if (sessionError) {
        throw new HttpError(
          502,
          'SESSION_REVOCATION_FAILED',
          'تم تعطيل الحساب لكن تعذّر إلغاء الجلسات المسجلة في واتار.',
        );
      }
    }

    return jsonResponse({ success: true, result: data });
  } catch (error) {
    return errorResponse(error);
  }
});
