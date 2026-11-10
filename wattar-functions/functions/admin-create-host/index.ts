import {
  authenticate,
  audit,
  errorResponse,
  getSupabaseAdmin,
  HttpError,
  jsonResponse,
  parseBody,
  rateLimitByUser,
  requireRole,
  validateBody,
} from '../_shared/supabase.ts';

interface CreateHostBody {
  username: string;
  display_name: string;
  email: string;
  phone: string;
  password: string;
}

const USERNAME_PATTERN = /^[a-zA-Z0-9._-]{3,50}$/;

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return jsonResponse({}, 200);
  if (req.method !== 'POST') return jsonResponse({ error: 'METHOD_NOT_ALLOWED' }, 405);

  try {
    const admin = await authenticate(req, { allowStaffWithoutAdultConfirmation: true });
    requireRole(admin, 'admin', 'super_admin');
    rateLimitByUser(admin, 'create_host_account', 10, 60_000);

    const body = validateBody<CreateHostBody>(
      await parseBody<CreateHostBody>(req),
      ['username', 'display_name', 'email', 'phone', 'password'],
    );
    const username = body.username.trim();
    const displayName = body.display_name.trim();
    const email = body.email.trim().toLowerCase();
    const phone = body.phone.trim().replace(/[()\s-]/g, '');

    if (!USERNAME_PATTERN.test(username)) {
      throw new HttpError(400, 'INVALID_USERNAME', 'اسم المستخدم يجب أن يتكون من 3 إلى 50 حرفًا لاتينيًا أو رقمًا.');
    }
    if (displayName.length < 2 || displayName.length > 80) {
      throw new HttpError(400, 'INVALID_DISPLAY_NAME', 'الاسم الظاهر مطلوب ويجب ألا يتجاوز 80 حرفًا.');
    }
    if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      throw new HttpError(400, 'INVALID_EMAIL', 'أدخل بريدًا إلكترونيًا صحيحًا.');
    }
    if (!/^\+[1-9]\d{6,14}$/.test(phone)) {
      throw new HttpError(400, 'INVALID_PHONE', 'أدخل رقم هاتف دوليًا، مثل +963...');
    }
    if (body.password.length < 8 || body.password.length > 128) {
      throw new HttpError(400, 'INVALID_PASSWORD', 'كلمة المرور الأولية يجب أن تتكون من 8 إلى 128 حرفًا.');
    }

    const supabase = getSupabaseAdmin();
    const [usernameResult, emailResult, phoneResult] = await Promise.all([
      supabase.from('users').select('id').eq('username', username).maybeSingle(),
      supabase.from('users').select('id').eq('email', email).maybeSingle(),
      supabase.from('users').select('id').eq('phone', phone).maybeSingle(),
    ]);
    if (usernameResult.error || emailResult.error || phoneResult.error) {
      console.error('[Wattar] Host account uniqueness check failed');
      throw new HttpError(500, 'ACCOUNT_CHECK_FAILED', 'تعذر التحقق من بيانات الحساب، حاول مجددًا.');
    }
    if (usernameResult.data) throw new HttpError(409, 'USERNAME_TAKEN', 'اسم المستخدم مستخدم بالفعل.');
    if (emailResult.data) throw new HttpError(409, 'EMAIL_TAKEN', 'البريد الإلكتروني مرتبط بحساب آخر.');
    if (phoneResult.data) throw new HttpError(409, 'PHONE_TAKEN', 'رقم الهاتف مرتبط بحساب آخر.');

    const { data: authResult, error: authError } = await supabase.auth.admin.createUser({
      email,
      password: body.password,
      phone,
      email_confirm: true,
      phone_confirm: false,
      user_metadata: { username, display_name: displayName },
    });
    if (authError || !authResult.user) {
      if (authError?.code === 'email_exists') {
        throw new HttpError(409, 'EMAIL_TAKEN', 'البريد الإلكتروني مرتبط بحساب Auth موجود.');
      }
      if (authError?.code === 'phone_exists') {
        throw new HttpError(409, 'PHONE_TAKEN', 'رقم الهاتف مرتبط بحساب Auth موجود.');
      }
      console.error('[Wattar] Host Auth account creation failed:', authError?.message);
      throw new HttpError(500, 'ACCOUNT_CREATE_FAILED', 'تعذر إنشاء حساب الدخول.');
    }

    const { data: profile, error: profileError } = await supabase
      .from('users')
      .update({
        username,
        display_name: displayName,
        email,
        phone,
        role: 'user',
        status: 'active',
      })
      .eq('id', authResult.user.id)
      .select('id')
      .maybeSingle();

    if (profileError || !profile) {
      const { error: cleanupError } = await supabase.auth.admin.deleteUser(authResult.user.id);
      if (cleanupError) {
        console.error('[Wattar] Failed to roll back incomplete host Auth account:', cleanupError.message);
        throw new HttpError(
          502,
          'ACCOUNT_CLEANUP_FAILED',
          'تعذر إكمال ملف الحساب وتعذر حذف حساب الدخول الجزئي. راجع الحساب قبل إعادة المحاولة.',
        );
      }
      console.error('[Wattar] Host profile update failed:', profileError?.message ?? 'No user profile row found');
      throw new HttpError(500, 'PROFILE_CREATE_FAILED', 'تعذر حفظ ملف الحساب؛ لم يكتمل إنشاء الحساب.');
    }

    const { error: hostError } = await supabase.from('verified_hosts').insert({
      user_id: authResult.user.id,
      status: 'pending',
      approved_by: null,
      approved_at: null,
    });
    if (hostError) {
      const { error: cleanupError } = await supabase.auth.admin.deleteUser(authResult.user.id);
      if (cleanupError) {
        console.error('[Wattar] Failed to roll back host account without pending host record:', cleanupError.message);
        throw new HttpError(
          502,
          'HOST_CLEANUP_FAILED',
          'تعذر حفظ حالة المضيفة الأولية وتعذر حذف الحساب الجزئي. راجع الحساب قبل إعادة المحاولة.',
        );
      }
      console.error('[Wattar] Failed to create pending host record:', hostError.message);
      throw new HttpError(500, 'HOST_RECORD_CREATE_FAILED', 'تعذر إنشاء سجل المضيفة الأولي.');
    }

    try {
      await audit(
        admin,
        'create',
        'host_account',
        authResult.user.id,
        null,
        { username, role: 'user', status: 'active' },
        { onboarding_required: true, host_assignment_pending: true, verified_host_status: 'pending' },
        req,
      );
    } catch (error) {
      console.error('[Wattar] Host account was created but the audit entry failed:', error);
      throw new HttpError(
        502,
        'HOST_AUDIT_FAILED',
        'أُنشئ الحساب لكن تعذر حفظ سجل التدقيق. لا تعاود الإنشاء؛ راجع الحساب وسجل الإدارة.',
      );
    }

    return jsonResponse({
      success: true,
      user: { id: authResult.user.id, username, email },
      host_assignment_pending: true,
    });
  } catch (error) {
    return errorResponse(error);
  }
});
