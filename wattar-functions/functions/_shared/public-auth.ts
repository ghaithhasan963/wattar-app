import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';
import { getSupabaseAdmin, HttpError } from './supabase.ts';

export interface PublicAuthAuditContext {
  ipHash: string;
  identityHash: string;
}

export async function enforcePublicAuthRateLimit(
  req: Request,
  event: 'phone_otp' | 'email_signup',
  identity: string,
): Promise<PublicAuthAuditContext> {
  const projectUrl = Deno.env.get('SUPABASE_URL');
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
  const hmacSecret = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!projectUrl || !anonKey || !hmacSecret) {
    throw new Error('Public authentication is not configured');
  }

  const forwardedIp = req.headers.get('cf-connecting-ip')
    ?? req.headers.get('x-real-ip')
    ?? req.headers.get('x-forwarded-for')?.split(',')[0]?.trim();
  if (!forwardedIp || forwardedIp.length > 128) {
    throw new HttpError(503, 'AUTH_RATE_LIMIT_UNAVAILABLE', 'تعذر التحقق من طلب التسجيل. حاول بعد قليل.');
  }

  const [ipHash, identityHash] = await Promise.all([
    hashBucket(hmacSecret, `${event}:ip:${forwardedIp}`),
    hashBucket(hmacSecret, `${event}:identity:${identity}`),
  ]);
  const bucketHashes = [ipHash, identityHash];
  const isPhoneOtp = event === 'phone_otp';
  const { data, error } = await getSupabaseAdmin().rpc('consume_public_auth_rate_limits', {
    p_bucket_hashes: bucketHashes,
    p_limits: isPhoneOtp ? [5, 3] : [5, 3],
    p_window_seconds: isPhoneOtp ? [900, 86400] : [900, 86400],
  });
  if (error) {
    console.error('[Wattar] Public auth rate-limit check failed:', error.message);
    throw new HttpError(503, 'AUTH_RATE_LIMIT_UNAVAILABLE', 'تعذر التحقق من طلب التسجيل. حاول بعد قليل.');
  }
  if (data !== true) {
    await recordPublicAuthActivity(
      event === 'phone_otp' ? 'phone_otp_rate_limited' : 'email_signup_rate_limited',
      { ipHash, identityHash },
    );
    throw new HttpError(429, 'AUTH_RATE_LIMITED', 'تم تجاوز عدد المحاولات المسموح. انتظر قليلًا ثم حاول مجددًا.');
  }

  return { ipHash, identityHash };
}

export async function recordPublicAuthActivity(
  eventType:
    | 'phone_otp_requested'
    | 'phone_otp_rate_limited'
    | 'phone_otp_rejected'
    | 'email_signup_succeeded'
    | 'email_signup_rate_limited'
    | 'email_signup_rejected',
  context: PublicAuthAuditContext,
  actorUserId?: string,
): Promise<void> {
  const { error } = await getSupabaseAdmin().rpc('record_public_auth_activity', {
    p_event_type: eventType,
    p_ip_hash: context.ipHash,
    p_identity_hash: context.identityHash,
    p_actor_user_id: actorUserId ?? null,
  });
  if (error) {
    console.error('[Wattar] Public authentication activity log failed:', error.message);
    throw new HttpError(503, 'AUTH_ACTIVITY_LOG_FAILED', 'تعذر تسجيل طلب المصادقة. حاول بعد قليل.');
  }
}

export function getPublicAuthClient() {
  const projectUrl = Deno.env.get('SUPABASE_URL');
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
  if (!projectUrl || !anonKey) throw new Error('Public authentication is not configured');
  return createClient(projectUrl, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

async function hashBucket(secret: string, value: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(value));
  return Array.from(new Uint8Array(signature), (byte) => byte.toString(16).padStart(2, '0')).join('');
}
