/**
 * Wattar — مكتبة مشتركة بين Edge Functions
 * - عميل Supabase مع service_role
 * - التحقق من JWT
 * - Rate limiting
 * - مساعد التدقيق
 *
 * @version 1.0.1
 */
import { createClient, SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';

// ============================================================================
// تهيئة Supabase
// ============================================================================
let adminClient: SupabaseClient | null = null;

export function getSupabaseAdmin(): SupabaseClient {
  if (adminClient) return adminClient;
  const url = Deno.env.get('SUPABASE_URL');
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !key) {
    throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  }
  adminClient = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return adminClient;
}

// ============================================================================
// التحقق من المستخدم
// ============================================================================
export interface AuthContext {
  user_id: string;
  role: string;
  status: string;
  adult_confirmed_at: string | null;
  email?: string;
  phone?: string;
}

export async function authenticate(
  req: Request,
  options: { allowStaffWithoutAdultConfirmation?: boolean } = {},
): Promise<AuthContext> {
  const authHeader = req.headers.get('Authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    throw new HttpError(401, 'UNAUTHORIZED', 'Missing authorization header');
  }
  const token = authHeader.slice(7);
  const supabase = getSupabaseAdmin();

  const { data: { user }, error } = await supabase.auth.getUser(token);
  if (error || !user) {
    throw new HttpError(401, 'INVALID_TOKEN', 'Invalid or expired token');
  }

  const { data: userData, error: userErr } = await supabase
    .from('users')
    .select('id, role, status, email, phone, adult_confirmed_at')
    .eq('id', user.id)
    .single();

  if (userErr || !userData) {
    throw new HttpError(403, 'USER_NOT_FOUND', 'User profile not found');
  }

  if (userData.status !== 'active') {
    throw new HttpError(403, 'ACCOUNT_INACTIVE', 'Account is not active');
  }
  const isStaff = ['admin', 'super_admin', 'agent'].includes(userData.role);
  if (
    !userData.adult_confirmed_at
    && !(options.allowStaffWithoutAdultConfirmation && isStaff)
  ) {
    throw new HttpError(403, 'AGE_CONFIRMATION_REQUIRED', 'Confirm that you are 18 or older to continue');
  }

  return {
    user_id: userData.id,
    role: userData.role,
    status: userData.status,
    adult_confirmed_at: userData.adult_confirmed_at,
    email: userData.email ?? undefined,
    phone: userData.phone ?? undefined,
  };
}

export function requireRole(ctx: AuthContext, ...roles: string[]): void {
  if (!roles.includes(ctx.role)) {
    throw new HttpError(403, 'FORBIDDEN', 'Insufficient permissions');
  }
}

// ============================================================================
// الأخطاء
// ============================================================================
export class HttpError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
    this.name = 'HttpError';
  }
}

export function errorResponse(err: unknown): Response {
  if (err instanceof HttpError) {
    return jsonResponse({ error: err.code, message: err.message }, err.status);
  }
  console.error('[Wattar] Unexpected error:', err);
  return jsonResponse(
    { error: 'INTERNAL_ERROR', message: 'An unexpected error occurred' },
    500,
  );
}

export function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Authorization, X-Client-Info, Apikey, Content-Type, X-Idempotency-Key',
    },
  });
}

// ============================================================================
// Rate Limiting
// ============================================================================
interface RateBucket {
  count: number;
  resetAt: number;
}

const rateBuckets = new Map<string, RateBucket>();

export function rateLimit(key: string, maxRequests: number, windowMs: number): boolean {
  const now = Date.now();
  const bucket = rateBuckets.get(key);
  if (!bucket || bucket.resetAt < now) {
    rateBuckets.set(key, { count: 1, resetAt: now + windowMs });
    return true;
  }
  if (bucket.count >= maxRequests) {
    return false;
  }
  bucket.count++;
  return true;
}

export function rateLimitByUser(ctx: AuthContext, action: string, max: number, windowMs: number): void {
  const key = `rl:${ctx.user_id}:${action}`;
  if (!rateLimit(key, max, windowMs)) {
    throw new HttpError(429, 'RATE_LIMITED', 'Too many requests, please slow down');
  }
}

export function requireIdempotencyKey(req: Request): string {
  const key = req.headers.get('X-Idempotency-Key')?.trim();
  if (!key || !/^[A-Za-z0-9._:-]{10,100}$/.test(key)) {
    throw new HttpError(400, 'IDEMPOTENCY_KEY_REQUIRED', 'A valid X-Idempotency-Key header is required');
  }
  return key;
}

// ============================================================================
// التدقيق (Audit Log)
// ============================================================================
export async function audit(
  ctx: AuthContext,
  action: string,
  target_type: string,
  target_id: string | null,
  before: unknown = null,
  after: unknown = null,
  metadata: Record<string, unknown> = {},
  request?: Request,
): Promise<void> {
  const supabase = getSupabaseAdmin();
  const forwardedIp = request?.headers.get('X-Forwarded-For')?.split(',')[0].trim();
  const ip = request?.headers.get('CF-Connecting-IP') ?? forwardedIp ?? null;
  const ua = request?.headers.get('User-Agent') ?? null;

  const { error } = await supabase.from('admin_audit_log').insert({
    admin_id: ctx.user_id,
    action,
    target_type,
    target_id,
    before: before ? JSON.stringify(before) : null,
    after: after ? JSON.stringify(after) : null,
    ip_address: ip,
    user_agent: ua,
    metadata,
  });
  if (error) {
    console.error('[Wattar] Failed to write admin audit log:', error);
    throw new Error('تعذر حفظ سجل الإجراء الإداري');
  }
}

// ============================================================================
// المساعدات العامة
// ============================================================================
export function getClientIp(req: Request): string | null {
  return req.headers.get('X-Forwarded-For')?.split(',')[0].trim() ?? null;
}

export function validateBody<T>(body: unknown, requiredFields: string[]): T {
  if (typeof body !== 'object' || body === null) {
    throw new HttpError(400, 'INVALID_BODY', 'Request body must be a JSON object');
  }
  const obj = body as Record<string, unknown>;
  for (const field of requiredFields) {
    if (obj[field] === undefined || obj[field] === null) {
      throw new HttpError(400, 'MISSING_FIELD', `Missing required field: ${field}`);
    }
  }
  return obj as T;
}

export async function parseBody<T = unknown>(req: Request): Promise<T> {
  try {
    return await req.json();
  } catch {
    throw new HttpError(400, 'INVALID_JSON', 'Request body is not valid JSON');
  }
}
