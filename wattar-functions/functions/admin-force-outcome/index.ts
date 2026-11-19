/**
 * Wattar Edge Function — admin-force-outcome
 *
 * إجبار مستخدم على الفوز/الخسارة في الجولة القادمة
 *   - status='force_win': سيفوز في الجولة القادمة من أي لعبة
 *   - status='force_lose': سيخسر في الجولة القادمة
 *   - بعد الجولة، يُصفّر تلقائيًا (تم تنفيذه في game-engine)
 *
 * POST /functions/v1/admin-force-outcome
 * Body:
 *   {
 *     "user_id": string,
 *     "outcome": "win" | "lose" | "clear",
 *     "count"?: number  // عدد الجولات (default=1)
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
  requireStaffPermissionOr,
  audit,
  validateBody,
} from '../_shared/supabase.ts';

interface ForceOutcomeBody {
  user_id: string;
  outcome: 'win' | 'lose' | 'clear';
  count?: number;
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return jsonResponse({}, 200);
  if (req.method !== 'POST') return jsonResponse({ error: 'METHOD_NOT_ALLOWED' }, 405);

  try {
    const ctx = await authenticate(req, { allowStaffWithoutAdultConfirmation: true });
    await requireStaffPermissionOr(ctx, 'games.manage', 'admin', 'super_admin', 'agent');

    const body = await parseBody<ForceOutcomeBody>(req);
    validateBody(body, ['user_id', 'outcome']);

    const supabase = getSupabaseAdmin();

    // التحقق من صلاحية الوكيل
    if (ctx.role === 'agent') {
      const { data: agent } = await supabase
        .from('agents')
        .select('id, can_force_outcome')
        .eq('user_id', ctx.user_id)
        .single();

      if (!agent || !agent.can_force_outcome) {
        throw new HttpError(403, 'NO_PERMISSION', 'Agent cannot force outcomes');
      }

      const { data: targetUser } = await supabase
        .from('users')
        .select('referred_by_agent_id')
        .eq('id', body.user_id)
        .single();

      if (!targetUser || targetUser.referred_by_agent_id !== agent.id) {
        throw new HttpError(403, 'NOT_YOUR_USER', 'User does not belong to this agent');
      }
    }

    // جلب الحالة القديمة
    const { data: before } = await supabase
      .from('users')
      .select('id, username, is_force_win, is_force_lose, force_outcome_count')
      .eq('id', body.user_id)
      .single();

    if (!before) {
      throw new HttpError(404, 'USER_NOT_FOUND', 'User not found');
    }

    const count = body.count ?? 1;

    let updateData: Record<string, unknown>;
    let action: string;

    if (body.outcome === 'clear') {
      updateData = {
        is_force_win: false,
        is_force_lose: false,
        force_outcome_count: 0,
      };
      action = 'clear';
    } else if (body.outcome === 'win') {
      updateData = {
        is_force_win: true,
        is_force_lose: false,
        force_outcome_count: count,
      };
      action = 'force_win';
    } else {
      updateData = {
        is_force_win: false,
        is_force_lose: true,
        force_outcome_count: count,
      };
      action = 'force_lose';
    }

    const { data: updated, error } = await supabase
      .from('users')
      .update(updateData)
      .eq('id', body.user_id)
      .select()
      .single();

    if (error) throw new HttpError(500, 'UPDATE_FAILED', error.message);

    await audit(ctx, action, 'user', body.user_id, before, updated, {}, req);

    return jsonResponse({
      success: true,
      message: body.outcome === 'clear'
        ? 'تم إلغاء forced outcome'
        : body.outcome === 'win'
          ? `سيتم إجبار المستخدم على الفوز في الجولة القادمة (${count} مرة)`
          : `سيتم إجبار المستخدم على الخسارة في الجولة القادمة (${count} مرة)`,
    });
  } catch (err) {
    return errorResponse(err);
  }
});
