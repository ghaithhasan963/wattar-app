/**
 * Wattar — مكتبة مشتركة بين Edge Functions
 * - عميل Supabase مع service_role
 * - التحقق من JWT
 * - Rate limiting (قاعدي: rate_limit_buckets عبر check_rate_limit)
 * - مساعد التدقيق
 * - بوابة صلاحيات موظفي الإدارة RBAC (M7.1)
 *
 * @version 2.2.0
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

  // M2.5: حظر مؤقت منتهي — استعادة تلقائية قبل الرفض (متسقة مع is_account_active في القاعدة)
  if (userData.status === 'banned') {
    const { error: restoreError } = await supabase
      .from('users')
      .update({
        status: 'active',
        banned_reason: null,
        banned_until: null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', user.id)
      .eq('status', 'banned')
      .not('banned_until', 'is', null)
      .lte('banned_until', new Date().toISOString());
    if (!restoreError) {
      const { data: refreshed } = await supabase
        .from('users')
        .select('status')
        .eq('id', user.id)
        .single();
      if (refreshed?.status) {
        userData.status = refreshed.status;
      }
    }
  }

  if (userData.status !== 'active') {
    throw new HttpError(403, 'ACCOUNT_INACTIVE', 'Account is not active');
  }
  const isStaff = ['admin', 'super_admin', 'agent', 'support'].includes(userData.role);
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

/**
 * M7.1 (RBAC): بوابة صلاحيات موحّدة لدوال الإدارة.
 * يُسمح بالمرور لأحد مسارين:
 *   1) دور قديم من users.role مذكور في legacyRoles (توافق كامل)،
 *      باستثناء أن الوكيل (agent) شريك مالي خارج حسابات الإدارة.
 *   2) موظف مفعّل في نظام admin_staff_roles يملك الصلاحية المطلوبة.
 * مع بوابة التحقق بخطوتين الصارمة (admin_2fa_gate_ok) لحسابات الإدارة —
 * لا أثر لها ما دام مفتاح admin_2fa_required مطفأاً (الافتراضي).
 */
export async function requireStaffPermissionOr(
  ctx: AuthContext,
  permission: string,
  ...legacyRoles: string[]
): Promise<void> {
  const supabase = getSupabaseAdmin();

  if (!legacyRoles.includes(ctx.role)) {
    const { data: can, error } = await supabase.rpc('admin_staff_can', {
      p_user_id: ctx.user_id,
      p_permission: permission,
    });
    if (error || !can) {
      throw new HttpError(403, 'FORBIDDEN', 'Insufficient permissions');
    }
  }

  if (ctx.role === 'agent') return;

  const { data: twoFaOk, error: tErr } = await supabase.rpc('admin_2fa_gate_ok', {
    p_user_id: ctx.user_id,
    p_block_unenrolled_super: true,
  });
  if (tErr || !twoFaOk) {
    throw new HttpError(403, 'TWO_FACTOR_REQUIRED', 'Two-factor verification is required for this action');
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
// Rate Limiting — على مستوى القاعدة (M2.4 / migration #48)
// عدّادات نوافذ منزلقة في جدول rate_limit_buckets عبر دالة check_rate_limit.
// ملاحظة: عند فشل الاتصال بالقاعدة نسمح بالمرور (fail-open) مع تسجيل الخطأ —
// استمرارية الخدمة أولى، والحد يُطبَّق فور عودة الاتصال.
// ============================================================================
export interface RateLimitResult {
  allowed: boolean;
  retryAfterMs: number;
}

export async function checkDbRateLimit(
  action: string,
  identifierType: 'user' | 'ip' | 'device' | 'phone' | 'email',
  identifierValue: string | null,
  maxRequests: number,
  windowSeconds: number,
): Promise<RateLimitResult> {
  if (!identifierValue) {
    return { allowed: true, retryAfterMs: 0 };
  }
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase.rpc('check_rate_limit', {
    p_action: action,
    p_identifier_type: identifierType,
    p_identifier_value: identifierValue,
    p_window_seconds: windowSeconds,
    p_max_requests: maxRequests,
  });
  if (error || !data) {
    console.error('[Wattar] rate limit check failed (allowing):', error);
    return { allowed: true, retryAfterMs: 0 };
  }
  return {
    allowed: !!data.allowed,
    retryAfterMs: Number(data.retry_after_ms ?? 0),
  };
}

export async function rateLimitByUser(
  ctx: AuthContext,
  action: string,
  max: number,
  windowMs: number,
): Promise<void> {
  const result = await checkDbRateLimit(action, 'user', ctx.user_id, max, Math.ceil(windowMs / 1000));
  if (!result.allowed) {
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
