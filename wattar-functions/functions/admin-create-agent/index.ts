/**
 * Wattar Edge Function — admin-create-agent
 *
 * إنشاء وكيل جديد من الأدمن فقط
 *
 * POST /functions/v1/admin-create-agent
 * Body:
 *   {
 *     "username": string,
 *     "password": string,
 *     "display_name"?: string,
 *     "phone": string,
 *     "email": string,
 *     "commission_rate": number,        // %
 *     "credit_limit_usd": number,
 *     "exchange_rate_usd_to_gold"?: number,
 *     "exchange_rate_gold_to_usd"?: number,
 *     "max_users"?: number,
 *     "daily_deposit_limit_usd"?: number,
 *     "permissions"?: {
 *       "can_create_users"?: boolean,
 *       "can_approve_deposits"?: boolean,
 *       "can_approve_withdrawals"?: boolean,
 *       "can_set_user_rtp"?: boolean,
 *       "can_force_outcome"?: boolean,
 *       "can_suspend_users"?: boolean
 *     }
 *   }
 *
 * @version 1.0.0
 */
import {
  authenticate,
  errorResponse,
  jsonResponse,
  getSupabaseAdmin,
  HttpError,
  parseBody,
  requireRole,
  audit,
  validateBody,
} from '../_shared/supabase.ts';

interface CreateAgentBody {
  username: string;
  password: string;
  display_name?: string;
  phone: string;
  email: string;
  commission_rate: number;
  credit_limit_usd: number;
  exchange_rate_usd_to_gold?: number;
  exchange_rate_gold_to_usd?: number;
  max_users?: number;
  daily_deposit_limit_usd?: number;
  permissions?: {
    can_create_users?: boolean;
    can_approve_deposits?: boolean;
    can_approve_withdrawals?: boolean;
    can_set_user_rtp?: boolean;
    can_force_outcome?: boolean;
    can_suspend_users?: boolean;
  };
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return jsonResponse({}, 200);
  if (req.method !== 'POST') return jsonResponse({ error: 'METHOD_NOT_ALLOWED' }, 405);

  try {
    const ctx = await authenticate(req, { allowStaffWithoutAdultConfirmation: true });
    requireRole(ctx, 'admin', 'super_admin');

    const body = await parseBody<CreateAgentBody>(req);
    validateBody(body, ['username', 'password', 'email', 'phone', 'commission_rate', 'credit_limit_usd']);

    const email = body.email.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      throw new HttpError(400, 'INVALID_EMAIL', 'A valid agent email is required');
    }
    const phone = body.phone.trim().replace(/[()\s-]/g, '');
    if (!/^\+[1-9]\d{6,14}$/.test(phone)) {
      throw new HttpError(400, 'INVALID_PHONE', 'Agent phone must be in international format, such as +963...');
    }

    if (body.commission_rate < 0 || body.commission_rate > 100) {
      throw new HttpError(400, 'INVALID_COMMISSION', 'commission_rate must be 0..100');
    }
    if (body.credit_limit_usd < 0) {
      throw new HttpError(400, 'INVALID_CREDIT', 'credit_limit_usd must be >= 0');
    }

    const supabase = getSupabaseAdmin();

    // 1) التحقق من عدم وجود username مسبقًا
    const { data: existing } = await supabase
      .from('users')
      .select('id')
      .eq('username', body.username)
      .maybeSingle();

    if (existing) {
      throw new HttpError(409, 'USERNAME_TAKEN', 'Username already exists');
    }

    // 2) إنشاء مستخدم في Auth
    const { data: authUser, error: authErr } = await supabase.auth.admin.createUser({
      email,
      password: body.password,
      phone,
      phone_confirm: true,
      email_confirm: true,
      user_metadata: { username: body.username, role: 'agent' },
    });

    if (authErr || !authUser.user) {
      throw new HttpError(500, 'AUTH_CREATE_FAILED', authErr?.message ?? 'Failed to create auth user');
    }

    // 3) إنشاء صف في users مع role=agent
    const { data: userRow, error: userErr } = await supabase
      .from('users')
      .update({
        username: body.username,
        display_name: body.display_name ?? body.username,
        phone,
        email,
        role: 'agent',
        status: 'active',
      })
      .eq('id', authUser.user.id)
      .select()
      .single();

    if (userErr) {
      // تراجع: حذف من auth
      await supabase.auth.admin.deleteUser(authUser.user.id);
      throw new HttpError(500, 'USER_CREATE_FAILED', userErr.message);
    }

    // 4) إنشاء صف في agents
    const { data: agent, error: agentErr } = await supabase
      .from('agents')
      .insert({
        user_id: authUser.user.id,
        created_by_admin_id: ctx.user_id,
        wallet_usd: 0,
        credit_limit_usd: body.credit_limit_usd,
        commission_rate: body.commission_rate,
        exchange_rate_usd_to_gold: body.exchange_rate_usd_to_gold ?? 1000,
        exchange_rate_gold_to_usd: body.exchange_rate_gold_to_usd ?? 0.0009,
        max_users: body.max_users ?? 500,
        daily_deposit_limit_usd: body.daily_deposit_limit_usd ?? 10000,
        can_create_users: body.permissions?.can_create_users ?? true,
        can_approve_deposits: body.permissions?.can_approve_deposits ?? true,
        can_approve_withdrawals: body.permissions?.can_approve_withdrawals ?? true,
        can_set_user_rtp: body.permissions?.can_set_user_rtp ?? false,
        can_force_outcome: body.permissions?.can_force_outcome ?? false,
        can_suspend_users: body.permissions?.can_suspend_users ?? false,
      })
      .select()
      .single();

    if (agentErr) {
      // تراجع
      await supabase.from('users').delete().eq('id', authUser.user.id);
      await supabase.auth.admin.deleteUser(authUser.user.id);
      throw new HttpError(500, 'AGENT_CREATE_FAILED', agentErr.message);
    }

    // 5) تسجيل في audit log
    await audit(ctx, 'create_agent', 'agent', agent.id, null, agent, {}, req);

    return jsonResponse({
      success: true,
      agent,
      user: { id: userRow.id, username: userRow.username },
      message: 'تم إنشاء الوكيل بنجاح',
    });
  } catch (err) {
    return errorResponse(err);
  }
});
