import {
  authenticate,
  audit,
  errorResponse,
  getSupabaseAdmin,
  HttpError,
  jsonResponse,
  parseBody,
  requireRole,
  validateBody,
} from '../_shared/supabase.ts';

interface ResetPasswordBody {
  user_id: string;
  reason: string;
}

const USER_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return jsonResponse({}, 200);
  if (req.method !== 'POST') return jsonResponse({ error: 'METHOD_NOT_ALLOWED' }, 405);

  try {
    const admin = await authenticate(req, { allowStaffWithoutAdultConfirmation: true });
    requireRole(admin, 'admin', 'super_admin');

    const body = validateBody<ResetPasswordBody>(
      await parseBody<ResetPasswordBody>(req),
      ['user_id', 'reason'],
    );
    if (!USER_ID_PATTERN.test(body.user_id)) {
      throw new HttpError(400, 'INVALID_USER_ID', 'A valid user_id is required');
    }
    if (body.user_id === admin.user_id) {
      throw new HttpError(400, 'SELF_ACTION_FORBIDDEN', 'Use the self-service password recovery flow for your own account');
    }
    const reason = body.reason.trim();
    if (!reason || reason.length > 500) {
      throw new HttpError(400, 'INVALID_REASON', 'A reason of 1 to 500 characters is required');
    }

    const supabase = getSupabaseAdmin();
    const { data: target, error: targetError } = await supabase
      .from('users')
      .select('id, role')
      .eq('id', body.user_id)
      .maybeSingle();
    if (targetError) throw new HttpError(500, 'TARGET_LOOKUP_FAILED', 'Could not verify the target account');
    if (!target) throw new HttpError(404, 'USER_NOT_FOUND', 'Target account not found');
    if (!['user', 'guest'].includes(target.role)) {
      throw new HttpError(403, 'STAFF_PROTECTED', 'Password recovery for staff and agents is not available here');
    }

    const { data: authRecord, error: authLookupError } = await supabase.auth.admin.getUserById(body.user_id);
    if (authLookupError || !authRecord.user?.email) {
      throw new HttpError(409, 'EMAIL_UNAVAILABLE', 'This account has no email address available for recovery');
    }

    const redirectTo = Deno.env.get('ADMIN_PASSWORD_RESET_REDIRECT_URL');
    const { error: resetError } = await supabase.auth.resetPasswordForEmail(authRecord.user.email, {
      ...(redirectTo ? { redirectTo } : {}),
    });
    if (resetError) {
      throw new HttpError(502, 'RESET_EMAIL_FAILED', 'Could not send the password recovery email');
    }

    try {
      await audit(
        admin,
        'reset_password',
        'user',
        body.user_id,
        null,
        null,
        { reason, method: 'recovery_email' },
        req,
      );
    } catch {
      throw new HttpError(500, 'AUDIT_FAILED', 'The recovery email was sent, but the action could not be audited');
    }

    const { error: sessionError } = await supabase
      .from('user_sessions')
      .update({ is_active: false })
      .eq('user_id', body.user_id)
      .eq('is_active', true);
    if (sessionError) {
      throw new HttpError(
        502,
        'SESSION_REVOCATION_FAILED',
        'The recovery email was sent and audited, but tracked app sessions could not be revoked',
      );
    }

    return jsonResponse({
      success: true,
      user_id: body.user_id,
      recovery_email_sent: true,
      tracked_sessions_revoked: true,
    });
  } catch (error) {
    return errorResponse(error);
  }
});
