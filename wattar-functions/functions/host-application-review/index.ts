import {
  authenticate,
  errorResponse,
  getSupabaseAdmin,
  HttpError,
  jsonResponse,
  parseBody,
  requireStaffPermissionOr,
  validateBody,
} from '../_shared/supabase.ts';

interface ReviewHostApplicationBody {
  application_id: string;
  approve: boolean;
  review_note?: string;
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return jsonResponse({}, 200);
  if (req.method !== 'POST') return jsonResponse({ error: 'METHOD_NOT_ALLOWED' }, 405);

  try {
    const admin = await authenticate(req, { allowStaffWithoutAdultConfirmation: true });
    await requireStaffPermissionOr(admin, 'hosts.applications.manage', 'admin', 'super_admin');
    const body = validateBody<ReviewHostApplicationBody>(
      await parseBody<ReviewHostApplicationBody>(req),
      ['application_id', 'approve'],
    );
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(body.application_id)) {
      throw new HttpError(400, 'INVALID_APPLICATION_ID', 'A valid application_id is required');
    }
    if (typeof body.approve !== 'boolean') {
      throw new HttpError(400, 'INVALID_DECISION', 'approve must be a boolean');
    }
    const reviewNote = body.review_note?.trim() ?? '';
    if ((!body.approve && !reviewNote) || reviewNote.length > 500) {
      throw new HttpError(400, 'INVALID_REVIEW_NOTE', 'A rejection reason of 1 to 500 characters is required');
    }

    const { data, error } = await getSupabaseAdmin().rpc('admin_review_host_application', {
      p_admin_id: admin.user_id,
      p_application_id: body.application_id,
      p_approve: body.approve,
      p_review_note: reviewNote || null,
    });
    if (error) {
      console.error('[Wattar] Host application review failed:', error.message);
      throw new HttpError(400, 'HOST_REVIEW_FAILED', error.message);
    }
    return jsonResponse({ success: true, result: data });
  } catch (error) {
    return errorResponse(error);
  }
});
