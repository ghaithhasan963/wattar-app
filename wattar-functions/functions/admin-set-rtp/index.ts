/**
 * Wattar Edge Function — admin-set-rtp
 *
 * ضبط RTP لمستخدم معيّن (override للإعداد الافتراضي للعبة)
 *   - إذا rtp = null → يعود لاستخدام الإعداد الافتراضي للعبة
 *
 * POST /functions/v1/admin-set-rtp
 * Body: { "user_id": string, "rtp_override": number | null }
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

interface SetRtpBody {
  user_id: string;
  rtp_override: number | null;  // 0..100 أو null لإلغاء الـoverride
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return jsonResponse({}, 200);
  if (req.method !== 'POST') return jsonResponse({ error: 'METHOD_NOT_ALLOWED' }, 405);

  try {
    const ctx = await authenticate(req);
    requireRole(ctx, 'admin', 'super_admin', 'agent');

    const body = await parseBody<SetRtpBody>(req);
    validateBody(body, ['user_id']);

    if (body.rtp_override !== null) {
      if (body.rtp_override < 0 || body.rtp_override > 100) {
        throw new HttpError(400, 'INVALID_RTP', 'rtp_override must be 0..100 or null');
      }
    }

    const supabase = getSupabaseAdmin();

    // التحقق من صلاحية الوكيل
    if (ctx.role === 'agent') {
      const { data: agent } = await supabase
        .from('agents')
        .select('id, can_set_user_rtp')
        .eq('user_id', ctx.user_id)
        .single();

      if (!agent || !agent.can_set_user_rtp) {
        throw new HttpError(403, 'NO_PERMISSION', 'Agent cannot set RTP');
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

    // جلب الحالة القديمة للتدقيق
    const { data: before } = await supabase
      .from('users')
      .select('id, username, rtp_override')
      .eq('id', body.user_id)
      .single();

    if (!before) {
      throw new HttpError(404, 'USER_NOT_FOUND', 'User not found');
    }

    // تحديث
    const { data: updated, error } = await supabase
      .from('users')
      .update({ rtp_override: body.rtp_override })
      .eq('id', body.user_id)
      .select()
      .single();

    if (error) throw new HttpError(500, 'UPDATE_FAILED', error.message);

    await audit(ctx, 'set_rtp', 'user', body.user_id, before, updated, {}, req);

    return jsonResponse({
      success: true,
      message: body.rtp_override === null
        ? 'تم إلغاء override الـRTP، سيعود للإعداد الافتراضي'
        : `تم ضبط RTP للمستخدم على ${body.rtp_override}%`,
      rtp_override: body.rtp_override,
    });
  } catch (err) {
    return errorResponse(err);
  }
});
