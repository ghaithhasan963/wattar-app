import {
  authenticate,
  errorResponse,
  getSupabaseAdmin,
  HttpError,
  jsonResponse,
  parseBody,
  requireStaffPermissionOr,
  validateBody,
} from '../_shared/supabase.ts';

interface SetUserStatusBody {
  user_id: string;
  status: 'active' | 'suspended' | 'banned';
  reason?: string;
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return jsonResponse({}, 200);
  if (req.method !== 'POST') return jsonResponse({ error: 'METHOD_NOT_ALLOWED' }, 405);

  try {
    const admin = await authenticate(req, { allowStaffWithoutAdultConfirmation: true });
    await requireStaffPermissionOr(admin, 'users.manage', 'admin', 'super_admin');

    const body = validateBody<SetUserStatusBody>(
      await parseBody<SetUserStatusBody>(req),
      ['user_id', 'status'],
    );
    if (!body.user_id || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(body.user_id)) {
      throw new HttpError(400, 'INVALID_USER_ID', 'A valid user_id is required');
    }
    if (!['active', 'suspended', 'banned'].includes(body.status)) {
      throw new HttpError(400, 'INVALID_STATUS', 'status must be active, suspended, or banned');
    }
    const reason = body.reason?.trim() ?? '';
    if (body.status !== 'active' && (!reason || reason.length > 500)) {
      throw new HttpError(400, 'INVALID_REASON', 'A reason of 1 to 500 characters is required');
    }

    const { data, error } = await getSupabaseAdmin().rpc('admin_set_user_status', {
      p_admin_id: admin.user_id,
      p_target_user_id: body.user_id,
      p_new_status: body.status,
      p_reason: reason || null,
    });
    if (error) {
      console.error('[Wattar] Audited user-status update failed:', error.message);
      throw new HttpError(400, 'STATUS_UPDATE_FAILED', error.message);
    }

    return jsonResponse({ success: true, result: data });
  } catch (error) {
    return errorResponse(error);
  }
});
