import {
  errorResponse,
  HttpError,
  jsonResponse,
} from '../_shared/supabase.ts';
import {
  enforcePublicAuthRateLimit,
  getPublicAuthClient,
  recordPublicAuthActivity,
} from '../_shared/public-auth.ts';

interface SignUpBody {
  email?: unknown;
  password?: unknown;
  email_redirect_to?: unknown;
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return jsonResponse({}, 200);
  if (req.method !== 'POST') return jsonResponse({ error: 'METHOD_NOT_ALLOWED' }, 405);

  try {
    const body = await parseJson(req) as SignUpBody;
    if (typeof body.email !== 'string' || typeof body.password !== 'string') {
      throw new HttpError(400, 'INVALID_CREDENTIALS', 'أدخل البريد الإلكتروني وكلمة المرور.');
    }
    const email = body.email.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) {
      throw new HttpError(400, 'INVALID_EMAIL', 'أدخل بريدًا إلكترونيًا صحيحًا.');
    }
    if (body.password.length < 8 || body.password.length > 128) {
      throw new HttpError(400, 'INVALID_PASSWORD', 'يجب أن تتكون كلمة المرور من 8 إلى 128 حرفًا.');
    }
    if (typeof body.email_redirect_to !== 'string' || body.email_redirect_to.length > 2048) {
      throw new HttpError(400, 'INVALID_REDIRECT', 'تعذر تجهيز رابط تأكيد الحساب.');
    }

    const auditContext = await enforcePublicAuthRateLimit(req, 'email_signup', email);
    const { data, error } = await getPublicAuthClient().auth.signUp({
      email,
      password: body.password,
      options: { emailRedirectTo: body.email_redirect_to },
    });
    if (error) {
      console.warn('[Wattar] Email signup rejected:', error.code ?? error.name);
      await recordPublicAuthActivity('email_signup_rejected', auditContext);
      throw new HttpError(400, 'SIGNUP_FAILED', 'تعذر إنشاء الحساب. تحقق من البيانات وحاول مجددًا.');
    }

    await recordPublicAuthActivity(
      'email_signup_succeeded',
      auditContext,
      data.user?.id,
    );
    return jsonResponse({
      success: true,
      confirmation_required: !data.session,
      session: data.session,
      user: data.user,
    });
  } catch (error) {
    return errorResponse(error);
  }
});

async function parseJson(req: Request): Promise<Record<string, unknown>> {
  let value: unknown;
  try {
    value = await req.json();
  } catch {
    throw new HttpError(400, 'INVALID_JSON', 'بيانات الطلب غير صالحة.');
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new HttpError(400, 'INVALID_BODY', 'بيانات الطلب غير صالحة.');
  }
  return value as Record<string, unknown>;
}
