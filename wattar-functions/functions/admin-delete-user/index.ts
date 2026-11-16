import {
  authenticate,
  audit,
  errorResponse,
  getSupabaseAdmin,
  HttpError,
  jsonResponse,
  parseBody,
  rateLimitByUser,
  requireRole,
  validateBody,
} from '../_shared/supabase.ts';

type AccountAction = 'status' | 'archive' | 'delete';

interface AccountControlBody {
  user_id: string;
  action: AccountAction;
  status?: 'active' | 'suspended' | 'banned';
  reason: string;
  confirmation?: string;
}

const USER_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const LONG_BAN_DURATION = '876000h';

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return jsonResponse({}, 200);
  if (req.method !== 'POST') return jsonResponse({ error: 'METHOD_NOT_ALLOWED' }, 405);

  try {
    const admin = await authenticate(req, { allowStaffWithoutAdultConfirmation: true });
    requireRole(admin, 'admin', 'super_admin');
    await rateLimitByUser(admin, 'admin_account_control', 20, 60_000);

    const body = validateBody<AccountControlBody>(
      await parseBody<AccountControlBody>(req),
      ['user_id', 'action', 'reason'],
    );
    if (!USER_ID_PATTERN.test(body.user_id)) {
      throw new HttpError(400, 'INVALID_USER_ID', 'A valid user_id is required');
    }
    if (typeof body.reason !== 'string') {
      throw new HttpError(400, 'INVALID_REASON', 'A reason of 1 to 500 characters is required');
    }
    const reason = body.reason.trim();
    if (!reason || reason.length > 500) {
      throw new HttpError(400, 'INVALID_REASON', 'A reason of 1 to 500 characters is required');
    }
    if (!['status', 'archive', 'delete'].includes(body.action)) {
      throw new HttpError(400, 'INVALID_ACTION', 'Unsupported account action');
    }

    const supabase = getSupabaseAdmin();
    const { data: target, error: targetError } = await supabase
      .from('users')
      .select('id, role, status')
      .eq('id', body.user_id)
      .maybeSingle();

    if (targetError) {
      throw new HttpError(500, 'TARGET_LOOKUP_FAILED', 'Could not verify the target account');
    }

    if (target) {
      if (target.id === admin.user_id) {
        throw new HttpError(400, 'SELF_ACTION_FORBIDDEN', 'You cannot change or delete your own account');
      }
      if (!['user', 'guest'].includes(target.role)) {
        throw new HttpError(403, 'STAFF_PROTECTED', 'Staff and agent accounts cannot be archived or deleted here');
      }
    }

    if (body.action === 'status' || body.action === 'archive') {
      if (!target) throw new HttpError(404, 'USER_NOT_FOUND', 'Target account not found');
      const newStatus = body.action === 'archive' ? 'suspended' : body.status;
      if (!newStatus || !['active', 'suspended', 'banned'].includes(newStatus)) {
        throw new HttpError(400, 'INVALID_STATUS', 'A valid account status is required');
      }

      if (target.status !== newStatus) {
        const { error: statusError } = await supabase.rpc('admin_set_user_status', {
          p_admin_id: admin.user_id,
          p_target_user_id: body.user_id,
          p_new_status: newStatus,
          p_reason: reason,
        });
        if (statusError) {
          console.error('[Wattar] Audited account status change failed');
          throw new HttpError(400, 'STATUS_UPDATE_FAILED', 'The account status could not be updated');
        }
      } else {
        const action = newStatus === 'active' ? 'unban' : newStatus === 'banned' ? 'ban' : 'suspend';
        try {
          await audit(
            admin,
            action,
            'user',
            body.user_id,
            { status: target.status },
            { status: newStatus },
            { reason, session_revocation_retry: true },
            req,
          );
        } catch {
          throw new HttpError(500, 'AUDIT_FAILED', 'The repeated status action could not be audited');
        }
      }

      const { error: authError } = await supabase.auth.admin.updateUserById(body.user_id, {
        ban_duration: newStatus === 'active' ? 'none' : LONG_BAN_DURATION,
      });
      if (authError) {
        console.error('[Wattar] Auth session revocation failed after account status change');
        throw new HttpError(
          502,
          'AUTH_STATUS_UPDATE_FAILED',
          'The database status was updated, but Auth session revocation failed. Retry or review the account before reactivation.',
        );
      }

      if (newStatus !== 'active') {
        const { error: sessionError } = await supabase
          .from('user_sessions')
          .update({ is_active: false })
          .eq('user_id', body.user_id)
          .eq('is_active', true);
        if (sessionError) {
          throw new HttpError(
            502,
            'SESSION_REVOCATION_FAILED',
            'The account is disabled, but tracked Wattar sessions could not be revoked',
          );
        }
      }

      return jsonResponse({ success: true, user_id: body.user_id, status: newStatus });
    }

    if (body.confirmation !== 'DELETE') {
      throw new HttpError(400, 'CONFIRMATION_REQUIRED', 'Type DELETE to confirm irreversible deletion');
    }

    if (target) {
      const { data, error: deleteError } = await supabase.rpc('admin_delete_user_profile', {
        p_admin_id: admin.user_id,
        p_target_user_id: body.user_id,
        p_reason: reason,
      });
      if (deleteError) {
        const blocked = deleteError.message.includes('SAFE_DELETE_BLOCKED');
        console.error('[Wattar] Safe account deletion was refused');
        throw new HttpError(
          blocked ? 409 : 400,
          blocked ? 'LINKED_RECORDS_EXIST' : 'DELETE_REFUSED',
          blocked
            ? 'This account has linked records, which may include financial, ledger, or audit history. Permanent deletion is refused; archive or disable the account instead.'
            : 'The account could not be safely deleted. Archive or disable it instead.',
        );
      }
      if (!data?.deleted) {
        throw new HttpError(500, 'DELETE_FAILED', 'The profile could not be safely deleted');
      }
    } else {
      const { data: priorDeletion, error: auditError } = await supabase
        .from('admin_audit_log')
        .select('id')
        .eq('target_type', 'user')
        .eq('target_id', body.user_id)
        .eq('action', 'delete')
        .limit(1);
      if (auditError || !priorDeletion?.length) {
        throw new HttpError(404, 'USER_NOT_FOUND', 'Target account not found');
      }
    }

    const { error: authDeleteError } = await supabase.auth.admin.deleteUser(body.user_id);
    if (authDeleteError && !/not found/i.test(authDeleteError.message)) {
      console.error('[Wattar] Profile was safely removed but Auth account cleanup failed');
      throw new HttpError(
        502,
        'AUTH_DELETE_FAILED',
        'The profile was safely removed and audited, but Auth cleanup failed. Retry the deletion to finish cleanup.',
      );
    }

    return jsonResponse({ success: true, user_id: body.user_id, deleted: true });
  } catch (error) {
    return errorResponse(error);
  }
});
