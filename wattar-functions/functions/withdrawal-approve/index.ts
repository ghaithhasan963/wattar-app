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

interface ApproveBody {
  withdrawal_id: string;
  action: 'approve' | 'reject';
  external_ref?: string;
  proof_url?: string;
  reason?: string;
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return jsonResponse({}, 200);
  if (req.method !== 'POST') return jsonResponse({ error: 'METHOD_NOT_ALLOWED' }, 405);

  try {
    const ctx = await authenticate(req);
    requireRole(ctx, 'admin', 'super_admin', 'agent');

    const body = await parseBody<ApproveBody>(req);
    validateBody(body, ['withdrawal_id', 'action']);
    if (body.action !== 'approve' && body.action !== 'reject') {
      throw new HttpError(400, 'INVALID_ACTION', 'Action must be approve or reject');
    }
    if (body.action === 'approve' && (!body.external_ref?.trim() || !body.proof_url?.trim())) {
      throw new HttpError(400, 'MISSING_PROOF', 'External reference and proof are required');
    }
    if (body.reason !== undefined && body.reason.length > 500) {
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
    }

    const { data, error } = await supabase.rpc('settle_diamond_withdrawal', {
      p_withdrawal_id: body.withdrawal_id,
      p_action: body.action,
      p_reviewer_id: ctx.user_id,
      p_proof_url: body.proof_url?.trim() || null,
      p_external_ref: body.external_ref?.trim() || null,
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
      message: body.action === 'approve' ? 'تم تأكيد الدفع.' : 'تم رفض الطلب وإعادة Diamonds.',
    });
  } catch (err) {
    return errorResponse(err);
  }
});
