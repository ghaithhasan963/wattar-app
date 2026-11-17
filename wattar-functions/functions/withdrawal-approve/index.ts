import {
  authenticate,
  errorResponse,
  jsonResponse,
  getSupabaseAdmin,
  HttpError,
  parseBody,
  requireRole,
  validateBody,
} from '../_shared/supabase.ts';

type WithdrawalAction = 'approve' | 'reject' | 'review' | 'request_info' | 'processing' | 'fail';

interface ApproveBody {
  withdrawal_id: string;
  action: WithdrawalAction;
  external_ref?: string;
  proof_url?: string;
  reason?: string;
}

const WITHDRAWAL_ACTIONS: WithdrawalAction[] = ['approve', 'reject', 'review', 'request_info', 'processing', 'fail'];

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return jsonResponse({}, 200);
  if (req.method !== 'POST') return jsonResponse({ error: 'METHOD_NOT_ALLOWED' }, 405);

  try {
    const ctx = await authenticate(req, { allowStaffWithoutAdultConfirmation: true });
    requireRole(ctx, 'admin', 'super_admin', 'agent');

    const body = await parseBody<ApproveBody>(req);
    validateBody(body, ['withdrawal_id', 'action']);
    if (!WITHDRAWAL_ACTIONS.includes(body.action)) {
      throw new HttpError(400, 'INVALID_ACTION', 'Action must be one of approve, reject, review, request_info, processing, fail');
    }
    const externalRef = body.external_ref?.trim();
    const proofPath = body.proof_url?.trim();
    if (body.action === 'approve' && (!externalRef || !proofPath)) {
      throw new HttpError(400, 'MISSING_PROOF', 'External reference and proof are required');
    }
    if (externalRef && externalRef.length > 200) {
      throw new HttpError(400, 'EXTERNAL_REF_TOO_LONG', 'External reference cannot exceed 200 characters');
    }
    if (body.reason !== undefined && body.reason.trim().length > 500) {
      throw new HttpError(400, 'REASON_TOO_LONG', 'Reason cannot exceed 500 characters');
    }

    const supabase = getSupabaseAdmin();
    const { data: withdrawal, error: fetchError } = await supabase
      .from('diamond_withdrawals')
      .select('id, agent_id')
      .eq('id', body.withdrawal_id)
      .maybeSingle();
    if (fetchError) {
      console.error('[Wattar] Failed to load withdrawal:', fetchError);
      throw new HttpError(500, 'WITHDRAWAL_LOOKUP_FAILED', 'Could not load withdrawal request');
    }
    if (!withdrawal) throw new HttpError(404, 'WITHDRAWAL_NOT_FOUND', 'Withdrawal not found');

    if (ctx.role === 'agent') {
      const { data: agent, error: agentError } = await supabase
        .from('agents')
        .select('id, status, can_approve_withdrawals')
        .eq('user_id', ctx.user_id)
        .maybeSingle();
      if (agentError) {
        console.error('[Wattar] Failed to verify withdrawal agent:', agentError);
        throw new HttpError(500, 'PERMISSION_LOOKUP_FAILED', 'Could not verify agent permissions');
      }
      if (!agent || agent.status !== 'active' || !agent.can_approve_withdrawals) {
        throw new HttpError(403, 'NO_PERMISSION', 'Agent cannot approve withdrawals');
      }
      if (withdrawal.agent_id !== agent.id) {
        throw new HttpError(403, 'NOT_ASSIGNED', 'This withdrawal is not assigned to this agent');
      }
      if (body.action === 'approve') {
        const expectedPrefix = `wd_${ctx.user_id}_`;
        if (!proofPath?.startsWith(expectedPrefix) || proofPath.includes('/')) {
          throw new HttpError(400, 'INVALID_PROOF_PATH', 'Agent proof must be uploaded to the assigned private proof area');
        }
        const { data: proofFiles, error: proofError } = await supabase
          .storage
          .from('deposit-proofs')
          .list('', { search: proofPath, limit: 1 });
        if (proofError) {
          console.error('[Wattar] Failed to verify agent withdrawal proof:', proofError);
          throw new HttpError(500, 'PROOF_LOOKUP_FAILED', 'Could not verify withdrawal proof');
        }
        if (!proofFiles?.some((file) => file.name === proofPath)) {
          throw new HttpError(400, 'PROOF_NOT_FOUND', 'Uploaded withdrawal proof was not found');
        }
      }
    }

    const { data, error } = await supabase.rpc('settle_diamond_withdrawal', {
      p_withdrawal_id: body.withdrawal_id,
      p_action: body.action,
      p_reviewer_id: ctx.user_id,
      p_proof_url: proofPath || null,
      p_external_ref: externalRef || null,
      p_reason: body.reason?.trim() || null,
    });
    if (error) {
      if (error.code === 'P0001') {
        throw new HttpError(409, 'WITHDRAWAL_REVIEW_CONFLICT', error.message);
      }
      console.error('[Wattar] Atomic withdrawal settlement failed:', error);
      throw new HttpError(500, 'WITHDRAWAL_SETTLEMENT_FAILED', 'Failed to settle withdrawal request');
    }
    return jsonResponse({
      success: true,
      result: data,
      message: body.action === 'approve'
        ? 'تم تأكيد الدفع.'
        : body.action === 'reject' || body.action === 'fail'
          ? 'تم رفض الطلب وإعادة Diamonds.'
          : 'تم تحديث حالة طلب السحب.',
    });
  } catch (err) {
    return errorResponse(err);
  }
});
