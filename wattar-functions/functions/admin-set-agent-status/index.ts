import {
  authenticate,
  errorResponse,
  getSupabaseAdmin,
  HttpError,
  jsonResponse,
  parseBody,
  requireRole,
  validateBody,
} from '../_shared/supabase.ts';

interface SetAgentStatusBody {
  agent_id: string;
  status: 'active' | 'suspended' | 'banned';
  reason?: string;
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return jsonResponse({}, 200);
  if (req.method !== 'POST') return jsonResponse({ error: 'METHOD_NOT_ALLOWED' }, 405);

  try {
    const admin = await authenticate(req, { allowStaffWithoutAdultConfirmation: true });
    requireRole(admin, 'admin', 'super_admin');

    const body = validateBody<SetAgentStatusBody>(
      await parseBody<SetAgentStatusBody>(req),
      ['agent_id', 'status'],
    );
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(body.agent_id)) {
      throw new HttpError(400, 'INVALID_AGENT_ID', 'A valid agent_id is required');
    }
    if (!['active', 'suspended', 'banned'].includes(body.status)) {
      throw new HttpError(400, 'INVALID_STATUS', 'status must be active, suspended, or banned');
    }
    const reason = body.reason?.trim() ?? '';
    if (body.status !== 'active' && (!reason || reason.length > 500)) {
      throw new HttpError(400, 'INVALID_REASON', 'A reason of 1 to 500 characters is required');
    }

    const { data, error } = await getSupabaseAdmin().rpc('admin_set_agent_status', {
      p_admin_id: admin.user_id,
      p_agent_id: body.agent_id,
      p_new_status: body.status,
      p_reason: reason || null,
    });
    if (error) {
      console.error('[Wattar] Audited agent-status update failed:', error.message);
      throw new HttpError(400, 'AGENT_STATUS_UPDATE_FAILED', error.message);
    }

    return jsonResponse({ success: true, result: data });
  } catch (error) {
    return errorResponse(error);
  }
});
