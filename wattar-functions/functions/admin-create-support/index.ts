import {
  audit,
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

interface CreateSupportBody {
  username: string;
  display_name?: string;
  email: string;
  password: string;
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return jsonResponse({}, 200);
  if (req.method !== 'POST') return jsonResponse({ error: 'METHOD_NOT_ALLOWED' }, 405);

  try {
    const ctx = await authenticate(req, { allowStaffWithoutAdultConfirmation: true });
    requireRole(ctx, 'admin', 'super_admin');
    await rateLimitByUser(ctx, 'create_support_staff', 10, 60_000);
    const body = await parseBody<CreateSupportBody>(req);
    validateBody(body, ['username', 'email', 'password']);

    const username = body.username.trim().toLowerCase();
    const email = body.email.trim().toLowerCase();
    const displayName = body.display_name?.trim() || username;
    if (!/^[a-z0-9._-]{3,30}$/.test(username)) {
      throw new HttpError(400, 'INVALID_USERNAME', 'اسم المستخدم يجب أن يتكون من 3 إلى 30 حرفًا أو رقمًا');
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      throw new HttpError(400, 'INVALID_EMAIL', 'أدخل بريدًا إلكترونيًا صالحًا');
    }
    if (body.password.length < 12 || body.password.length > 128) {
      throw new HttpError(400, 'INVALID_PASSWORD', 'كلمة المرور يجب أن تتكون من 12 إلى 128 حرفًا');
    }

    const supabase = getSupabaseAdmin();
    const [{ data: existingUser, error: usernameError }, { data: existingEmail, error: emailError }] =
      await Promise.all([
        supabase.from('users').select('id').eq('username', username).maybeSingle(),
        supabase.from('users').select('id').eq('email', email).maybeSingle(),
      ]);
    if (usernameError) throw new HttpError(500, 'USERNAME_CHECK_FAILED', 'تعذر التحقق من اسم المستخدم');
    if (emailError) throw new HttpError(500, 'EMAIL_CHECK_FAILED', 'تعذر التحقق من البريد الإلكتروني');
    if (existingUser) throw new HttpError(409, 'USERNAME_TAKEN', 'اسم المستخدم مستخدم مسبقًا');
    if (existingEmail) throw new HttpError(409, 'EMAIL_TAKEN', 'البريد الإلكتروني مستخدم مسبقًا');

    const { data: authResult, error: authError } = await supabase.auth.admin.createUser({
      email,
      password: body.password,
      email_confirm: true,
      user_metadata: { username, role: 'support' },
    });
    if (authError || !authResult.user) {
      throw new HttpError(500, 'SUPPORT_AUTH_CREATE_FAILED', authError?.message ?? 'تعذر إنشاء حساب الدعم');
    }

    const { data: staff, error: profileError } = await supabase
      .from('users')
      .update({
        username,
        display_name: displayName,
        email,
        role: 'support',
        status: 'active',
      })
      .eq('id', authResult.user.id)
      .select('id, username, display_name, email, role, status')
      .single();
    if (profileError) {
      const { error: cleanupError } = await supabase.auth.admin.deleteUser(authResult.user.id);
      if (cleanupError) console.error('[Wattar] Failed to roll back support account after profile failure:', cleanupError);
      throw new HttpError(500, 'SUPPORT_PROFILE_CREATE_FAILED', profileError.message);
    }

    try {
      await audit(ctx, 'create', 'support_staff', staff.id, null, staff, {}, req);
    } catch (error: unknown) {
      const { error: cleanupError } = await supabase.auth.admin.deleteUser(authResult.user.id);
      if (cleanupError) console.error('[Wattar] Failed to roll back support staff after audit failure:', cleanupError);
      throw error;
    }

    return jsonResponse({ success: true, staff: { id: staff.id, username: staff.username } });
  } catch (error: unknown) {
    return errorResponse(error);
  }
});
