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

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return jsonResponse({}, 200);
  if (req.method !== 'POST') return jsonResponse({ error: 'METHOD_NOT_ALLOWED' }, 405);

  try {
    const body = await parseJson(req);
    if (typeof body.phone !== 'string') {
      throw new HttpError(400, 'INVALID_PHONE', 'أدخل رقم هاتف بصيغة دولية صحيحة.');
    }
    const phone = body.phone.trim().replace(/[()\s-]/g, '');
    if (!/^\+[1-9]\d{6,14}$/.test(phone)) {
      throw new HttpError(400, 'INVALID_PHONE', 'أدخل رقم هاتف بصيغة دولية صحيحة مثل +963...');
    }

    const auditContext = await enforcePublicAuthRateLimit(req, 'phone_otp', phone);
    const { error } = await getPublicAuthClient().auth.signInWithOtp({
      phone,
      options: { channel: 'sms' },
    });
    if (error) {
      console.warn('[Wattar] Phone OTP request rejected:', error.code ?? error.name);
      await recordPublicAuthActivity('phone_otp_rejected', auditContext);
      throw new HttpError(400, 'OTP_REQUEST_FAILED', 'تعذر إرسال رمز التحقق. تحقق من الرقم وحاول لاحقًا.');
    }
    await recordPublicAuthActivity('phone_otp_requested', auditContext);
    return jsonResponse({ success: true });
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
