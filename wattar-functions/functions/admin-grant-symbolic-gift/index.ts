import {
  authenticate,
  errorResponse,
  getSupabaseAdmin,
  HttpError,
  jsonResponse,
  parseBody,
  rateLimitByUser,
  requireIdempotencyKey,
  requireStaffPermissionOr,
  validateBody,
} from '../_shared/supabase.ts';

interface GrantSymbolicGiftBody {
  user_id: string;
  gift_id: string;
  quantity: number;
  source?: string;
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return jsonResponse({}, 200);
  if (req.method !== 'POST') return jsonResponse({ error: 'METHOD_NOT_ALLOWED' }, 405);

  try {
    const admin = await authenticate(req, { allowStaffWithoutAdultConfirmation: true });
    await requireStaffPermissionOr(admin, 'users.manage', 'gifts.manage', 'admin', 'super_admin');
    await rateLimitByUser(admin, 'admin_grant_symbolic_gift', 20, 60_000);

    const body = validateBody<GrantSymbolicGiftBody>(
      await parseBody<GrantSymbolicGiftBody>(req),
      ['user_id', 'gift_id', 'quantity'],
    );

    if (!Number.isInteger(body.quantity) || body.quantity < 1 || body.quantity > 1000) {
      throw new HttpError(400, 'INVALID_QUANTITY', 'quantity must be an integer from 1 to 1000');
    }
    const source = body.source?.trim() || 'admin';
    if (source.length > 64) {
      throw new HttpError(400, 'INVALID_SOURCE', 'source is too long');
    }

    const idempotencyKey = requireIdempotencyKey(req);
    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase.rpc('grant_symbolic_gift', {
      p_user_id: body.user_id,
      p_gift_id: body.gift_id,
      p_quantity: body.quantity,
      p_source: source,
      p_granted_by: admin.user_id,
      p_idempotency_key: idempotencyKey,
    });

    if (error) {
      console.error('[Wattar] grant_symbolic_gift RPC error:', error.message);
      throw new HttpError(400, 'SYMBOLIC_GRANT_FAILED', error.message || 'Failed to grant symbolic gift');
    }

    return jsonResponse({ success: true, result: data });
  } catch (error) {
    return errorResponse(error);
  }
});
