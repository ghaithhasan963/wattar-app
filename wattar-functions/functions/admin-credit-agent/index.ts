import {
  authenticate,
  errorResponse,
  jsonResponse,
  getSupabaseAdmin,
  HttpError,
  parseBody,
  requireIdempotencyKey,
  requireStaffPermissionOr,
  validateBody,
} from '../_shared/supabase.ts';

interface CreditAgentBody {
  agent_id: string;
  amount_usd: number;
  notes?: string;
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return jsonResponse({}, 200);
  if (req.method !== 'POST') return jsonResponse({ error: 'METHOD_NOT_ALLOWED' }, 405);

  try {
    const ctx = await authenticate(req, { allowStaffWithoutAdultConfirmation: true });
    await requireStaffPermissionOr(ctx, 'agents.manage', 'admin', 'super_admin');

    const body = await parseBody<CreditAgentBody>(req);
    validateBody(body, ['agent_id', 'amount_usd']);
    if (!Number.isFinite(body.amount_usd) || body.amount_usd <= 0) {
      throw new HttpError(400, 'INVALID_AMOUNT', 'amount_usd must be greater than zero');
    }
    if (body.notes !== undefined && body.notes.length > 500) {
      throw new HttpError(400, 'NOTES_TOO_LONG', 'Notes cannot exceed 500 characters');
    }
    const idempotencyKey = requireIdempotencyKey(req);
    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase.rpc('admin_credit_agent_inventory', {
      p_agent_id: body.agent_id,
      p_amount_usd: body.amount_usd,
      p_admin_id: ctx.user_id,
      p_idempotency_key: idempotencyKey,
      p_notes: body.notes?.trim() || null,
    });

    if (error) {
      if (error.code === 'P0001') {
        throw new HttpError(400, 'AGENT_TOPUP_REJECTED', error.message);
      }
      console.error('[Wattar] Atomic agent inventory top-up failed:', error);
      throw new HttpError(500, 'AGENT_TOPUP_FAILED', 'Failed to credit prepaid Coins inventory');
    }
    if (!data || typeof data !== 'object') {
      throw new HttpError(500, 'AGENT_TOPUP_FAILED', 'Inventory top-up result was not returned');
    }

    const result = data as Record<string, unknown>;
    return jsonResponse({
      success: true,
      credited_coins: result.credited_coins,
      balance: result.balance,
      already_processed: result.already_processed === true,
    });
  } catch (err) {
    return errorResponse(err);
  }
});
