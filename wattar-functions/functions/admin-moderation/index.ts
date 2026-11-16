/**
 * admin-moderation — نقطة موحدة لكل إجراءات الإشراف (M2.5 / هجرة #50)
 * الإجراءات:
 *   upsert_word | delete_word | update_settings | add_exception | revoke_exception
 *   apply_penalty | revoke_penalty | review_report | review_appeal
 * كل الإجراءات تمر عبر RPC قاعدية service_role فقط (تدقيق + صلاحيات داخل القاعدة).
 */
import {
  authenticate,
  errorResponse,
  getSupabaseAdmin,
  HttpError,
  jsonResponse,
  parseBody,
  rateLimitByUser,
  requireRole,
  validateBody,
} from '../_shared/supabase.ts';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

interface ModerationBody {
  action: string;
  word_id?: string;
  list_type?: 'forbidden' | 'allowed';
  word?: string;
  severity?: 'low' | 'medium' | 'high';
  room_id?: string | null;
  is_active?: boolean;
  settings?: Record<string, unknown>;
  subject_user_id?: string | null;
  subject_room_id?: string | null;
  reason?: string;
  exception_id?: string;
  target_user_id?: string;
  penalty_type?: 'warning' | 'mute' | 'kick' | 'temp_ban' | 'permanent_ban';
  duration_minutes?: number;
  violation_id?: string | null;
  penalty_id?: string;
  report_id?: string;
  decision?: 'actioned' | 'dismissed' | 'approved' | 'rejected';
  note?: string;
  appeal_id?: string;
}

function requireUuid(value: string | null | undefined, code: string): string {
  if (!value || !UUID_RE.test(value)) {
    throw new HttpError(400, code, 'A valid UUID is required');
  }
  return value;
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return jsonResponse({}, 200);
  if (req.method !== 'POST') return jsonResponse({ error: 'METHOD_NOT_ALLOWED' }, 405);

  try {
    const admin = await authenticate(req, { allowStaffWithoutAdultConfirmation: true });
    requireRole(admin, 'admin', 'super_admin');
    await rateLimitByUser(admin, 'admin_moderation', 60, 60_000);

    const body = validateBody<ModerationBody>(await parseBody<ModerationBody>(req), ['action']);
    const supabase = getSupabaseAdmin();
    const adminId = admin.user_id;

    switch (body.action) {
      case 'upsert_word': {
        if (!body.list_type || !['forbidden', 'allowed'].includes(body.list_type)) {
          throw new HttpError(400, 'INVALID_LIST_TYPE', 'list_type must be forbidden or allowed');
        }
        const word = body.word?.trim() ?? '';
        if (word.length < 1 || word.length > 120) {
          throw new HttpError(400, 'INVALID_WORD', 'word must be 1 to 120 characters');
        }
        if (body.severity && !['low', 'medium', 'high'].includes(body.severity)) {
          throw new HttpError(400, 'INVALID_SEVERITY', 'severity must be low, medium, or high');
        }
        const { data, error } = await supabase.rpc('admin_upsert_moderation_word', {
          p_admin_id: adminId,
          p_list_type: body.list_type,
          p_word: word,
          p_severity: body.severity ?? 'medium',
          p_room_id: body.room_id ?? null,
          p_is_active: body.is_active ?? true,
          p_reason: body.reason?.trim() || null,
        });
        if (error) throw new HttpError(400, 'WORD_UPSERT_FAILED', error.message);
        return jsonResponse({ success: true, word_id: data });
      }

      case 'delete_word': {
        const wordId = requireUuid(body.word_id, 'INVALID_WORD_ID');
        const { data, error } = await supabase.rpc('admin_delete_moderation_word', {
          p_admin_id: adminId,
          p_word_id: wordId,
          p_reason: body.reason?.trim() || null,
        });
        if (error) throw new HttpError(400, 'WORD_DELETE_FAILED', error.message);
        return jsonResponse({ success: true, result: data });
      }

      case 'update_settings': {
        if (!body.settings || typeof body.settings !== 'object' || Array.isArray(body.settings)) {
          throw new HttpError(400, 'INVALID_SETTINGS', 'settings must be a JSON object');
        }
        const { data, error } = await supabase.rpc('admin_update_moderation_settings', {
          p_admin_id: adminId,
          p_settings: body.settings,
          p_reason: body.reason?.trim() || null,
        });
        if (error) throw new HttpError(400, 'SETTINGS_UPDATE_FAILED', error.message);
        return jsonResponse({ success: true, settings: data });
      }

      case 'add_exception': {
        const reason = body.reason?.trim() ?? '';
        if (!reason || reason.length > 500) {
          throw new HttpError(400, 'INVALID_REASON', 'A reason of 1 to 500 characters is required');
        }
        if (body.subject_user_id && body.subject_room_id) {
          throw new HttpError(400, 'INVALID_SUBJECT', 'Specify either a user or a room, not both');
        }
        const { data, error } = await supabase.rpc('admin_add_moderation_exception', {
          p_admin_id: adminId,
          p_reason: reason,
          p_subject_user_id: body.subject_user_id ?? null,
          p_subject_room_id: body.subject_room_id ?? null,
        });
        if (error) throw new HttpError(400, 'EXCEPTION_ADD_FAILED', error.message);
        return jsonResponse({ success: true, exception_id: data });
      }

      case 'revoke_exception': {
        const exceptionId = requireUuid(body.exception_id, 'INVALID_EXCEPTION_ID');
        const { data, error } = await supabase.rpc('admin_revoke_moderation_exception', {
          p_admin_id: adminId,
          p_exception_id: exceptionId,
        });
        if (error) throw new HttpError(400, 'EXCEPTION_REVOKE_FAILED', error.message);
        return jsonResponse({ success: true, result: data });
      }

      case 'apply_penalty': {
        const targetUserId = requireUuid(body.target_user_id, 'INVALID_TARGET_USER_ID');
        if (!body.penalty_type || !['warning', 'mute', 'kick', 'temp_ban', 'permanent_ban'].includes(body.penalty_type)) {
          throw new HttpError(400, 'INVALID_PENALTY_TYPE', 'penalty_type is invalid');
        }
        const reason = body.reason?.trim() ?? '';
        if (!reason || reason.length > 500) {
          throw new HttpError(400, 'INVALID_REASON', 'A reason of 1 to 500 characters is required');
        }
        const { data, error } = await supabase.rpc('apply_moderation_penalty', {
          p_admin_id: adminId,
          p_target_user_id: targetUserId,
          p_penalty_type: body.penalty_type,
          p_reason: reason,
          p_duration_minutes: body.duration_minutes ?? null,
          p_room_id: body.room_id ?? null,
          p_violation_id: body.violation_id ?? null,
        });
        if (error) throw new HttpError(400, 'PENALTY_FAILED', error.message);
        return jsonResponse({ success: true, result: data });
      }

      case 'revoke_penalty': {
        const penaltyId = requireUuid(body.penalty_id, 'INVALID_PENALTY_ID');
        const reason = body.reason?.trim() ?? '';
        if (!reason || reason.length > 500) {
          throw new HttpError(400, 'INVALID_REASON', 'A reason of 1 to 500 characters is required');
        }
        const { data, error } = await supabase.rpc('revoke_moderation_penalty', {
          p_admin_id: adminId,
          p_penalty_id: penaltyId,
          p_reason: reason,
        });
        if (error) throw new HttpError(400, 'PENALTY_REVOKE_FAILED', error.message);
        return jsonResponse({ success: true, result: data });
      }

      case 'review_report': {
        const reportId = requireUuid(body.report_id, 'INVALID_REPORT_ID');
        if (!body.decision || !['actioned', 'dismissed'].includes(body.decision)) {
          throw new HttpError(400, 'INVALID_DECISION', 'decision must be actioned or dismissed');
        }
        if (
          body.decision === 'actioned'
          && body.penalty_type
          && !['warning', 'mute', 'temp_ban', 'permanent_ban'].includes(body.penalty_type)
        ) {
          throw new HttpError(400, 'INVALID_PENALTY_TYPE', 'penalty_type is invalid for report review');
        }
        const { data, error } = await supabase.rpc('admin_review_user_report', {
          p_admin_id: adminId,
          p_report_id: reportId,
          p_decision: body.decision,
          p_note: body.note?.trim() || null,
          p_penalty: body.decision === 'actioned' ? (body.penalty_type ?? null) : null,
          p_duration_minutes: body.duration_minutes ?? null,
        });
        if (error) throw new HttpError(400, 'REPORT_REVIEW_FAILED', error.message);
        return jsonResponse({ success: true, result: data });
      }

      case 'review_appeal': {
        const appealId = requireUuid(body.appeal_id, 'INVALID_APPEAL_ID');
        if (!body.decision || !['approved', 'rejected'].includes(body.decision)) {
          throw new HttpError(400, 'INVALID_DECISION', 'decision must be approved or rejected');
        }
        const { data, error } = await supabase.rpc('admin_review_appeal', {
          p_admin_id: adminId,
          p_appeal_id: appealId,
          p_decision: body.decision,
          p_note: body.note?.trim() || null,
        });
        if (error) throw new HttpError(400, 'APPEAL_REVIEW_FAILED', error.message);
        return jsonResponse({ success: true, result: data });
      }

      default:
        throw new HttpError(400, 'UNKNOWN_ACTION', 'Unknown moderation action');
    }
  } catch (error) {
    return errorResponse(error);
  }
});
