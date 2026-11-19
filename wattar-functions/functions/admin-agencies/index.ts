/**
 * Wattar — إدارة الوكالات والوكلاء والمحافظ التشغيلية (M5)
 *
 * كل الإجراءات كتابية هنا فقط (القراءة تتم مباشرة عبر RLS لأن الإدارة تراها).
 * كل إجراء يمرّ إلى دالة RPC تتحقق من service_role وتكتب في admin_audit_log.
 *
 * الإجراءات:
 *  create | update | set_status | assign_manager | assign_agent |
 *  update_agent_limits | credit_agency | transfer_to_agent | adjust_agent_wallet |
 *  freeze_wallet | decide_funding
 */
import {
  authenticate,
  errorResponse,
  getSupabaseAdmin,
  HttpError,
  jsonResponse,
  parseBody,
  requireStaffPermissionOr,
} from '../_shared/supabase.ts';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

interface AgencyActionBody {
  action: string;
  agency_id?: string;
  agent_id?: string;
  user_id?: string;
  request_id?: string;
  id?: string;
  kind?: 'agent' | 'agency';
  status?: string;
  decision?: string;
  frozen?: boolean;
  name?: string;
  notes?: string;
  reason?: string;
  note?: string;
  amount_usd?: number;
  commission_rate?: number;
  agent_commission_rate?: number;
  daily_deposit_limit_usd?: number;
  daily_withdrawal_limit_usd?: number;
  min_operation_usd?: number;
  max_operation_usd?: number;
  max_agents?: number;
  max_users?: number;
  credit_limit_usd?: number;
  can_approve_hosts?: boolean;
  can_create_agents?: boolean;
  apply_commission_default?: boolean;
  idempotency_key?: string;
}

function uuid(value: string | undefined, field: string): string {
  if (!value || !UUID_RE.test(value)) {
    throw new HttpError(400, 'INVALID_ID', `${field} must be a valid id`);
  }
  return value;
}

function optionalUuid(value: string | null | undefined, field: string): string | null {
  if (value === undefined || value === null || value === '') return null;
  return uuid(value, field);
}

function money(value: number | undefined, field: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    throw new HttpError(400, 'INVALID_AMOUNT', `${field} must be a positive number`);
  }
  if (value > 1_000_000) {
    throw new HttpError(400, 'INVALID_AMOUNT', `${field} is too large`);
  }
  return Math.round(value * 100) / 100;
}

function signedMoney(value: number | undefined, field: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value === 0) {
    throw new HttpError(400, 'INVALID_AMOUNT', `${field} must be a non-zero number`);
  }
  if (Math.abs(value) > 1_000_000) {
    throw new HttpError(400, 'INVALID_AMOUNT', `${field} is too large`);
  }
  return Math.round(value * 100) / 100;
}

function optionalNumber(value: number | undefined, field: string, max = 1_000_000): number | undefined {
  if (value === undefined || value === null) return undefined;
  if (!Number.isFinite(value) || value < 0 || value > max) {
    throw new HttpError(400, 'INVALID_NUMBER', `${field} must be between 0 and ${max}`);
  }
  return value;
}

function reasonOf(body: AgencyActionBody, required = true, min = 3): string | null {
  const value = (body.reason ?? body.note ?? '').trim();
  if (required && value.length < min) {
    throw new HttpError(400, 'INVALID_REASON', 'A reason is required');
  }
  if (value.length > 500) {
    throw new HttpError(400, 'INVALID_REASON', 'Reason must be at most 500 characters');
  }
  return value || null;
}

function idempotency(body: AgencyActionBody): string {
  const key = body.idempotency_key?.trim();
  if (key && key.length <= 120) return key;
  return crypto.randomUUID();
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return jsonResponse({}, 200);
  if (req.method !== 'POST') return jsonResponse({ error: 'METHOD_NOT_ALLOWED' }, 405);

  try {
    const admin = await authenticate(req, { allowStaffWithoutAdultConfirmation: true });
    await requireStaffPermissionOr(admin, 'agencies.manage', 'admin', 'super_admin');

    const body = await parseBody<AgencyActionBody>(req);
    if (!body?.action) throw new HttpError(400, 'INVALID_BODY', 'action is required');

    const db = getSupabaseAdmin();
    let result: unknown = null;

    switch (body.action) {
      case 'create': {
        const name = (body.name ?? '').trim();
        if (name.length < 2 || name.length > 120) {
          throw new HttpError(400, 'INVALID_NAME', 'Agency name must be 2-120 characters');
        }
        const ownerId = optionalUuid(body.user_id, 'user_id');
        const { data, error } = await db.rpc('admin_create_agency', {
          p_name: name,
          p_owner_user_id: ownerId,
          p_commission_rate: optionalNumber(body.commission_rate, 'commission_rate', 100) ?? 0,
          p_agent_commission_rate: optionalNumber(body.agent_commission_rate, 'agent_commission_rate', 100) ?? 0,
          p_daily_deposit_limit_usd: optionalNumber(body.daily_deposit_limit_usd, 'daily_deposit_limit_usd') ?? 0,
          p_daily_withdrawal_limit_usd: optionalNumber(body.daily_withdrawal_limit_usd, 'daily_withdrawal_limit_usd') ?? 0,
          p_max_agents: Math.round(optionalNumber(body.max_agents, 'max_agents', 10000) ?? 0),
          p_can_approve_hosts: body.can_approve_hosts ?? false,
          p_can_create_agents: body.can_create_agents ?? true,
          p_notes: body.notes?.trim() || null,
          p_admin_id: admin.user_id,
          p_reason: reasonOf(body, false),
        });
        if (error) throw new HttpError(400, 'AGENCY_CREATE_FAILED', error.message);
        result = { agency_id: data };
        break;
      }

      case 'update': {
        const agencyId = uuid(body.agency_id, 'agency_id');
        const { data, error } = await db.rpc('admin_update_agency', {
          p_agency_id: agencyId,
          p_name: body.name?.trim() || null,
          p_commission_rate: optionalNumber(body.commission_rate, 'commission_rate', 100) ?? null,
          p_agent_commission_rate: optionalNumber(body.agent_commission_rate, 'agent_commission_rate', 100) ?? null,
          p_daily_deposit_limit_usd: optionalNumber(body.daily_deposit_limit_usd, 'daily_deposit_limit_usd') ?? null,
          p_daily_withdrawal_limit_usd: optionalNumber(body.daily_withdrawal_limit_usd, 'daily_withdrawal_limit_usd') ?? null,
          p_max_agents: optionalNumber(body.max_agents, 'max_agents', 10000) === undefined
            ? null : Math.round(body.max_agents as number),
          p_can_approve_hosts: body.can_approve_hosts ?? null,
          p_can_create_agents: body.can_create_agents ?? null,
          p_notes: body.notes?.trim() || null,
          p_admin_id: admin.user_id,
          p_reason: reasonOf(body, false),
        });
        if (error) throw new HttpError(400, 'AGENCY_UPDATE_FAILED', error.message);
        result = data;
        break;
      }

      case 'set_status': {
        const agencyId = uuid(body.agency_id, 'agency_id');
        const status = body.status ?? '';
        if (!['pending', 'active', 'suspended', 'revoked'].includes(status)) {
          throw new HttpError(400, 'INVALID_STATUS', 'Invalid agency status');
        }
        const { data, error } = await db.rpc('admin_set_agency_status', {
          p_agency_id: agencyId,
          p_status: status,
          p_admin_id: admin.user_id,
          p_reason: reasonOf(body, status === 'suspended' || status === 'revoked'),
        });
        if (error) throw new HttpError(400, 'AGENCY_STATUS_FAILED', error.message);
        result = data;
        break;
      }

      case 'assign_manager': {
        const agencyId = uuid(body.agency_id, 'agency_id');
        const userId = uuid(body.user_id, 'user_id');
        const { data, error } = await db.rpc('admin_assign_agency_manager', {
          p_agency_id: agencyId,
          p_user_id: userId,
          p_admin_id: admin.user_id,
          p_reason: reasonOf(body, false),
        });
        if (error) throw new HttpError(400, 'AGENCY_MANAGER_FAILED', error.message);
        result = data;
        break;
      }

      case 'assign_agent': {
        const agentId = uuid(body.agent_id, 'agent_id');
        const agencyId = optionalUuid(body.agency_id, 'agency_id');
        const { data, error } = await db.rpc('admin_assign_agent_to_agency', {
          p_agent_id: agentId,
          p_agency_id: agencyId,
          p_admin_id: admin.user_id,
          p_reason: reasonOf(body, false),
          p_apply_commission_default: body.apply_commission_default ?? true,
        });
        if (error) throw new HttpError(400, 'AGENT_ASSIGN_FAILED', error.message);
        result = data;
        break;
      }

      case 'update_agent_limits': {
        const agentId = uuid(body.agent_id, 'agent_id');
        const maxUsers = optionalNumber(body.max_users, 'max_users', 100000);
        const { data, error } = await db.rpc('admin_update_agent_limits', {
          p_agent_id: agentId,
          p_commission_rate: optionalNumber(body.commission_rate, 'commission_rate', 100) ?? null,
          p_daily_deposit_limit_usd: optionalNumber(body.daily_deposit_limit_usd, 'daily_deposit_limit_usd') ?? null,
          p_daily_withdrawal_limit_usd: optionalNumber(body.daily_withdrawal_limit_usd, 'daily_withdrawal_limit_usd') ?? null,
          p_min_operation_usd: optionalNumber(body.min_operation_usd, 'min_operation_usd') ?? null,
          p_max_operation_usd: optionalNumber(body.max_operation_usd, 'max_operation_usd') ?? null,
          p_max_users: maxUsers === undefined ? null : Math.round(maxUsers),
          p_credit_limit_usd: optionalNumber(body.credit_limit_usd, 'credit_limit_usd') ?? null,
          p_admin_id: admin.user_id,
          p_reason: reasonOf(body, false),
        });
        if (error) throw new HttpError(400, 'AGENT_LIMITS_FAILED', error.message);
        result = data;
        break;
      }

      case 'credit_agency': {
        const agencyId = uuid(body.agency_id, 'agency_id');
        const { data, error } = await db.rpc('admin_credit_agency_wallet', {
          p_agency_id: agencyId,
          p_amount_usd: money(body.amount_usd, 'amount_usd'),
          p_reason: reasonOf(body, true, 3),
          p_idempotency_key: idempotency(body),
          p_admin_id: admin.user_id,
        });
        if (error) throw new HttpError(400, 'AGENCY_CREDIT_FAILED', error.message);
        result = data;
        break;
      }

      case 'transfer_to_agent': {
        const agencyId = uuid(body.agency_id, 'agency_id');
        const agentId = uuid(body.agent_id, 'agent_id');
        const { data, error } = await db.rpc('admin_transfer_agency_to_agent', {
          p_agency_id: agencyId,
          p_agent_id: agentId,
          p_amount_usd: money(body.amount_usd, 'amount_usd'),
          p_reason: reasonOf(body, true, 3),
          p_idempotency_key: idempotency(body),
          p_admin_id: admin.user_id,
        });
        if (error) throw new HttpError(400, 'AGENCY_TRANSFER_FAILED', error.message);
        result = data;
        break;
      }

      case 'adjust_agent_wallet': {
        const agentId = uuid(body.agent_id, 'agent_id');
        const { data, error } = await db.rpc('admin_adjust_agent_wallet', {
          p_agent_id: agentId,
          p_amount_usd: signedMoney(body.amount_usd, 'amount_usd'),
          p_reason: reasonOf(body, true, 3),
          p_idempotency_key: idempotency(body),
          p_admin_id: admin.user_id,
        });
        if (error) throw new HttpError(400, 'AGENT_WALLET_FAILED', error.message);
        result = data;
        break;
      }

      case 'freeze_wallet': {
        const kind = body.kind;
        if (kind !== 'agent' && kind !== 'agency') {
          throw new HttpError(400, 'INVALID_KIND', 'kind must be agent or agency');
        }
        const { data, error } = await db.rpc('admin_freeze_wallet', {
          p_kind: kind,
          p_id: uuid(body.id, 'id'),
          p_frozen: body.frozen ?? true,
          p_reason: reasonOf(body, body.frozen ?? true),
          p_admin_id: admin.user_id,
        });
        if (error) throw new HttpError(400, 'WALLET_FREEZE_FAILED', error.message);
        result = data;
        break;
      }

      case 'decide_funding': {
        const requestId = uuid(body.request_id, 'request_id');
        const decision = body.decision ?? '';
        if (!['approved', 'rejected'].includes(decision)) {
          throw new HttpError(400, 'INVALID_DECISION', 'decision must be approved or rejected');
        }
        const { data, error } = await db.rpc('admin_decide_funding_request', {
          p_request_id: requestId,
          p_decision: decision,
          p_admin_id: admin.user_id,
          p_note: reasonOf(body, decision === 'rejected'),
        });
        if (error) throw new HttpError(400, 'FUNDING_DECISION_FAILED', error.message);
        result = data;
        break;
      }

      default:
        throw new HttpError(400, 'UNKNOWN_ACTION', `Unknown action: ${body.action}`);
    }

    return jsonResponse({ success: true, result });
  } catch (error) {
    return errorResponse(error);
  }
});
