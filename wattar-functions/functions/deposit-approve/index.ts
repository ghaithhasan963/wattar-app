import {
  authenticate,
  errorResponse,
  jsonResponse,
  getSupabaseAdmin,
  HttpError,
  parseBody,
  requireStaffPermissionOr,
  validateBody,
} from '../_shared/supabase.ts';

type DepositAction = 'approve' | 'reject' | 'review' | 'request_info' | 'fail';

interface ApproveBody {
  deposit_id: string;
  action: DepositAction;
  reason?: string;
  notes?: string;
}

const DEPOSIT_ACTIONS: DepositAction[] = ['approve', 'reject', 'review', 'request_info', 'fail'];

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return jsonResponse({}, 200);
  if (req.method !== 'POST') return jsonResponse({ error: 'METHOD_NOT_ALLOWED' }, 405);

  try {
    const ctx = await authenticate(req, { allowStaffWithoutAdultConfirmation: true });
    await requireStaffPermissionOr(ctx, 'deposits.manage', 'admin', 'super_admin', 'agent');

    const body = await parseBody<ApproveBody>(req);
    validateBody(body, ['deposit_id', 'action']);
    if (!DEPOSIT_ACTIONS.includes(body.action)) {
      throw new HttpError(400, 'INVALID_ACTION', 'Action must be one of approve, reject, review, request_info, fail');
    }

    const supabase = getSupabaseAdmin();
    const { data: deposit, error: depositError } = await supabase
      .from('deposits')
      .select('id, agent_id')
      .eq('id', body.deposit_id)
      .maybeSingle();
    if (depositError) {
      console.error('[Wattar] Failed to load deposit for review:', depositError);
      throw new HttpError(500, 'DEPOSIT_LOOKUP_FAILED', 'Could not load deposit request');
    }
    if (!deposit) throw new HttpError(404, 'DEPOSIT_NOT_FOUND', 'Deposit request not found');

    if (ctx.role === 'agent') {
      const { data: agent, error: agentError } = await supabase
        .from('agents')
        .select('id, status, can_approve_deposits')
        .eq('user_id', ctx.user_id)
        .maybeSingle();
      if (agentError) {
        console.error('[Wattar] Failed to verify agent permissions:', agentError);
        throw new HttpError(500, 'PERMISSION_LOOKUP_FAILED', 'Could not verify agent permissions');
      }
      if (!agent || agent.status !== 'active' || !agent.can_approve_deposits) {
        throw new HttpError(403, 'NO_PERMISSION', 'Agent cannot approve deposits');
      }
      if (deposit.agent_id !== agent.id) {
        throw new HttpError(403, 'NOT_YOUR_USER', 'This deposit does not belong to your users');
      }
    }

    const { data, error } = await supabase.rpc('settle_deposit_request', {
      p_deposit_id: body.deposit_id,
      p_action: body.action,
      p_reviewer_id: ctx.user_id,
      p_reason: body.reason ?? null,
      p_notes: body.notes ?? null,
    });
    if (error) {
      if (error.code === 'P0001') {
        throw new HttpError(409, 'DEPOSIT_REVIEW_CONFLICT', error.message);
      }
      console.error('[Wattar] Atomic deposit settlement failed:', error);
      throw new HttpError(500, 'DEPOSIT_SETTLEMENT_FAILED', 'Failed to settle deposit request');
    }

    return jsonResponse({
      success: true,
      result: data,
      message: body.action === 'approve'
        ? 'تم اعتماد الشحن وتحديث الرصيد.'
        : body.action === 'reject' || body.action === 'fail'
          ? 'تم رفض طلب الشحن.'
          : 'تم تحديث حالة طلب الشحن.',
    });
  } catch (err) {
    return errorResponse(err);
  }
});
