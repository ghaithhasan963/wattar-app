/**
 * Wattar Admin — صفحة تسجيل الدخول
 * M7.1: خطوة تحقق بخطوتين بعد كلمة المرور عند تفعيل الإلزام
 * (admin_totp_verify) قبل الدخول إلى اللوحة.
 */
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '@/store/auth';
import { Lock, Mail, Phone, Loader2, ShieldCheck } from 'lucide-react';

export function LoginPage() {
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [resetNotice, setResetNotice] = useState<string | null>(null);
  const [totpStep, setTotpStep] = useState(false);
  const [totpCode, setTotpCode] = useState('');
  const [totpBusy, setTotpBusy] = useState(false);
  const [totpError, setTotpError] = useState<string | null>(null);
  const { signIn, requestPasswordReset, verifyTotp, loading, error } = useAuthStore();
  const navigate = useNavigate();

  const finishNavigation = () => {
    navigate(useAuthStore.getState().profile?.role === 'agent' ? '/agent' : '/');
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await signIn(identifier, password);
      const profile = useAuthStore.getState().profile;
      if (profile?.totpRequired && profile.totp.enabled && !profile.totp.verified_recently) {
        setTotpStep(true);
        return;
      }
      finishNavigation();
    } catch {
      // خطأ موجود في store
    }
  };

  const handleTotpSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const code = totpCode.trim();
    if (!/^\d{6}$/.test(code)) {
      setTotpError('أدخل رمزاً من 6 أرقام.');
      return;
    }
    setTotpBusy(true);
    setTotpError(null);
    try {
      await verifyTotp(code);
      finishNavigation();
    } catch {
      setTotpError('رمز غير صالح أو مستخدم مسبقاً. انتظر رمزاً جديداً من التطبيق وحاول مجدداً.');
    } finally {
      setTotpBusy(false);
    }
  };

  const handlePasswordReset = async () => {
    if (!identifier.trim() || !identifier.includes('@')) return;
    try {
      await requestPasswordReset(identifier);
      setResetNotice('إذا كان البريد مسجلًا، سيصلك رابط استعادة. افتحه من هذا المتصفح لإكمال التغيير.');
    } catch {
      // The store exposes the error to the form.
    }
  };

  return (
    <div className="min-h-screen bg-dark flex items-center justify-center p-4" dir="rtl">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <div className="inline-flex h-16 w-16 rounded-2xl bg-gradient-to-br from-wattar-500 to-wattar-700 items-center justify-center mb-4">
            <span className="text-3xl font-bold text-white">W</span>
          </div>
          <h1 className="text-3xl font-bold text-white">Wattar | وتر</h1>
          <p className="text-gray-400 mt-2">بوابة الموظفين والوكلاء</p>
        </div>

        <div className="bg-dark-surface rounded-2xl border border-wattar-900 p-8">
          {totpStep ? (
            <>
              <h2 className="text-xl font-semibold text-white mb-2">التحقق بخطوتين</h2>
              <p className="text-sm text-gray-400 mb-6">
                الإلزام مفعّل لحسابات الإدارة. أدخل الرمز الحالي من تطبيق المصادقة لإكمال الدخول.
              </p>
              <form onSubmit={handleTotpSubmit} className="space-y-4">
                <div>
                  <label className="block text-sm text-gray-300 mb-2">رمز التحقق (6 أرقام)</label>
                  <div className="relative">
                    <ShieldCheck className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500" size={18} />
                    <input
                      type="text"
                      inputMode="numeric"
                      autoComplete="one-time-code"
                      dir="ltr"
                      value={totpCode}
                      onChange={(e) => setTotpCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                      required
                      placeholder="123456"
                      className="w-full rounded-lg bg-dark-elevated border border-wattar-900 py-3 pr-10 pl-4 text-white placeholder-gray-500 focus:outline-none focus:border-wattar-500 tracking-[0.4em] text-center"
                    />
                  </div>
                </div>

                {totpError && (
                  <div className="rounded-lg bg-red-500/10 border border-red-500/30 px-4 py-3 text-sm text-red-400">
                    {totpError}
                  </div>
                )}

                <button
                  type="submit"
                  disabled={totpBusy || totpCode.length !== 6}
                  className="w-full rounded-lg bg-wattar-600 hover:bg-wattar-700 disabled:opacity-50 py-3 font-medium text-white transition-colors flex items-center justify-center gap-2"
                >
                  {totpBusy ? <Loader2 size={18} className="animate-spin" /> : <ShieldCheck size={18} />}
                  تأكيد الدخول
                </button>
              </form>
            </>
          ) : (
            <>
              <h2 className="text-xl font-semibold text-white mb-6">تسجيل الدخول</h2>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-sm text-gray-300 mb-2">البريد الإلكتروني أو رقم الهاتف</label>
              <div className="relative">
                {identifier.includes('@')
                  ? <Mail className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500" size={18} />
                  : <Phone className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500" size={18} />}
                <input
                  type="text"
                  autoComplete="username"
                  value={identifier}
                  onChange={(e) => { setIdentifier(e.target.value); setResetNotice(null); }}
                  required
                  placeholder="admin@wattar.app أو ‎+963..."
                  className="w-full rounded-lg bg-dark-elevated border border-wattar-900 py-3 pr-10 pl-4 text-white placeholder-gray-500 focus:outline-none focus:border-wattar-500"
                />
              </div>
              {identifier.trim() && !identifier.includes('@') && (
                <p className="mt-2 text-xs leading-5 text-gray-400">
                  استخدم الرقم الدولي المسجل للوكيل مع كلمة المرور نفسها؛ لا يتطلب تسجيل الدخول إرسال SMS.
                </p>
              )}
            </div>

            <div>
              <label className="block text-sm text-gray-300 mb-2">كلمة المرور</label>
              <div className="relative">
                <Lock className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500" size={18} />
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  placeholder="••••••••"
                  className="w-full rounded-lg bg-dark-elevated border border-wattar-900 py-3 pr-10 pl-4 text-white placeholder-gray-500 focus:outline-none focus:border-wattar-500"
                />
              </div>
            </div>

            <button
              type="button"
              onClick={handlePasswordReset}
              disabled={loading || !identifier.trim().includes('@')}
              className="text-sm text-wattar-400 hover:text-wattar-300 disabled:opacity-50"
            >
              إرسال رابط استعادة كلمة المرور إلى البريد
            </button>

            {resetNotice && (
              <div role="status" className="rounded-lg border border-green-500/30 bg-green-500/10 px-4 py-3 text-sm text-green-300">
                {resetNotice}
              </div>
            )}

            {error && (
              <div className="rounded-lg bg-red-500/10 border border-red-500/30 px-4 py-3 text-sm text-red-400">
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full rounded-lg bg-wattar-600 hover:bg-wattar-700 disabled:opacity-50 py-3 font-medium text-white transition-colors flex items-center justify-center gap-2"
            >
              {loading && <Loader2 size={18} className="animate-spin" />}
              دخول
            </button>
          </form>
            </>
          )}
        </div>

        <p className="text-center text-gray-500 text-xs mt-6">
          © 2025 Wattar — جميع الحقوق محفوظة
        </p>
      </div>
    </div>
  );
}
