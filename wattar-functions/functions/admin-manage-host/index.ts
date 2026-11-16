import {
  authenticate,
  errorResponse,
  getSupabaseAdmin,
  HttpError,
  jsonResponse,
  parseBody,
  rateLimitByUser,
  requireRole,
  validateBody,
} from '../_shared/supabase.ts';

interface ManageHostBody {
  user_id: string;
  action: 'assign' | 'suspend' | 'activate';
  reason: string;
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return jsonResponse({}, 200);
  if (req.method !== 'POST') return jsonResponse({ error: 'METHOD_NOT_ALLOWED' }, 405);

  try {
    const admin = await authenticate(req, { allowStaffWithoutAdultConfirmation: true });
    requireRole(admin, 'admin', 'super_admin');
    await rateLimitByUser(admin, 'manage_verified_host', 20, 60_000);

    const body = validateBody<ManageHostBody>(
      await parseBody<ManageHostBody>(req),
      ['user_id', 'action', 'reason'],
    );
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(body.user_id)) {
      throw new HttpError(400, 'INVALID_USER_ID', 'حدد حسابًا صالحًا.');
    }
    if (!['assign', 'suspend', 'activate'].includes(body.action)) {
      throw new HttpError(400, 'INVALID_ACTION', 'الإجراء الإداري غير صالح.');
    }
    const reason = body.reason.trim();
    if (reason.length < 3 || reason.length > 500) {
      throw new HttpError(400, 'INVALID_REASON', 'اكتب سببًا من 3 إلى 500 حرف.');
    }

    const { data, error } = await getSupabaseAdmin().rpc('admin_manage_verified_host', {
      p_admin_id: admin.user_id,
      p_user_id: body.user_id,
      p_action: body.action,
      p_reason: reason,
    });
    if (error) {
      console.error('[Wattar] Admin host-management action failed:', error.message);
      throw new HttpError(400, 'HOST_MANAGEMENT_FAILED', error.message);
    }
    return jsonResponse({ success: true, result: data });
  } catch (error) {
    return errorResponse(error);
  }
});
