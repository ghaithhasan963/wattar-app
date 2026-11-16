import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';
import {
  checkDbRateLimit,
  errorResponse,
  getClientIp,
  getSupabaseAdmin,
  HttpError,
  jsonResponse,
  parseBody,
} from '../_shared/supabase.ts';

interface LoginBody {
  phone: string;
  password: string;
}

const invalidCredentials = () =>
  jsonResponse(
    { error: 'INVALID_CREDENTIALS', message: 'بيانات الدخول غير صحيحة أو الحساب غير نشط.' },
    401,
  );

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return jsonResponse({}, 200);
  if (req.method !== 'POST') return jsonResponse({ error: 'METHOD_NOT_ALLOWED' }, 405);

  try {
    const clientIp = req.headers.get('CF-Connecting-IP')?.trim() || getClientIp(req) || null;
    const rl = await checkDbRateLimit('agent_phone_login', 'ip', clientIp, 20, 15 * 60);
    if (!rl.allowed) {
      throw new HttpError(429, 'RATE_LIMITED', 'محاولات كثيرة. حاول مجددًا بعد قليل.');
    }

    const body = await parseBody<LoginBody>(req);
    if (
      typeof body !== 'object'
      || body === null
      || Array.isArray(body)
      || typeof body.phone !== 'string'
      || typeof body.password !== 'string'
    ) {
      throw new HttpError(400, 'INVALID_BODY', 'رقم الهاتف وكلمة المرور مطلوبان.');
    }

    const phone = body.phone.trim().replace(/[()\s-]/g, '');
    if (!/^\+[1-9]\d{6,14}$/.test(phone) || body.password.length === 0 || body.password.length > 1024) {
      throw new HttpError(400, 'INVALID_CREDENTIALS_FORMAT', 'تحقق من رقم الهاتف وكلمة المرور.');
    }

    const admin = getSupabaseAdmin();
    const { data: agent, error: agentError } = await admin
      .from('users')
      .select('id, email')
      .eq('phone', phone)
      .eq('role', 'agent')
      .eq('status', 'active')
      .maybeSingle();

    if (agentError) throw agentError;
    if (!agent?.email) return invalidCredentials();

    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
    if (!supabaseUrl || !anonKey) {
      throw new Error('Missing SUPABASE_URL or SUPABASE_ANON_KEY');
    }

    const authClient = createClient(supabaseUrl, anonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data, error } = await authClient.auth.signInWithPassword({
      email: agent.email,
      password: body.password,
    });

    if (error) {
      if (error.status === 400 || error.status === 401) return invalidCredentials();
      if (error.status === 429) {
        throw new HttpError(429, 'RATE_LIMITED', 'محاولات كثيرة. حاول مجددًا بعد قليل.');
      }
      throw error;
    }
    if (!data.session || data.user.id !== agent.id) return invalidCredentials();

    return jsonResponse({
      access_token: data.session.access_token,
      refresh_token: data.session.refresh_token,
    });
  } catch (error) {
    return errorResponse(error);
  }
});
