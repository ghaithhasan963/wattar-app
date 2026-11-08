import { FormEvent, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Lock, Loader2 } from 'lucide-react';
import { supabase } from '@/lib/supabase';

export function ResetPasswordPage() {
  const navigate = useNavigate();
  const [ready, setReady] = useState(false);
  const [hasRecoverySession, setHasRecoverySession] = useState(false);
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    supabase.auth.getSession().then(({ data, error: sessionError }) => {
      if (!active) return;
      if (sessionError) setError(sessionError.message);
      setHasRecoverySession(Boolean(data.session));
      setReady(true);
    }).catch((sessionError: unknown) => {
      if (!active) return;
      setError(sessionError instanceof Error ? sessionError.message : 'تعذر التحقق من رابط الاستعادة.');
      setReady(true);
    });
    return () => { active = false; };
  }, []);

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    if (password.length < 8) {
      setError('استخدم كلمة مرور من 8 أحرف على الأقل.');
      return;
    }
    if (password !== confirmation) {
      setError('كلمتا المرور غير متطابقتين.');
      return;
    }

    setLoading(true);
    try {
      const { error: updateError } = await supabase.auth.updateUser({ password });
      if (updateError) throw updateError;
      navigate('/', { replace: true });
    } catch (updateError: unknown) {
      setError(updateError instanceof Error ? updateError.message : 'تعذر تحديث كلمة المرور.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-dark flex items-center justify-center p-4" dir="rtl">
      <div className="w-full max-w-md rounded-2xl border border-wattar-900 bg-dark-surface p-8">
        <h1 className="mb-2 text-2xl font-bold text-white">إعادة تعيين كلمة المرور</h1>
        <p className="mb-6 text-sm text-gray-400">
          {hasRecoverySession
            ? 'أدخل كلمة مرور جديدة لحساب الإدارة.'
            : 'افتح رابط الاستعادة الذي أرسلناه إلى بريدك الإلكتروني.'}
        </p>

        {!ready ? (
          <div className="flex justify-center py-6"><Loader2 className="animate-spin text-wattar-400" /></div>
        ) : hasRecoverySession ? (
          <form onSubmit={handleSubmit} className="space-y-4">
            <label className="block text-sm text-gray-300">
              كلمة المرور الجديدة
              <span className="relative mt-2 block">
                <Lock className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500" size={18} />
                <input
                  type="password"
                  autoComplete="new-password"
                  required
                  minLength={8}
                  value={password}
                  onChange={event => setPassword(event.target.value)}
                  className="w-full rounded-lg border border-wattar-900 bg-dark-elevated py-3 pl-4 pr-10 text-white focus:border-wattar-500 focus:outline-none"
                />
              </span>
            </label>
            <label className="block text-sm text-gray-300">
              تأكيد كلمة المرور
              <input
                type="password"
                autoComplete="new-password"
                required
                minLength={8}
                value={confirmation}
                onChange={event => setConfirmation(event.target.value)}
                className="mt-2 w-full rounded-lg border border-wattar-900 bg-dark-elevated px-4 py-3 text-white focus:border-wattar-500 focus:outline-none"
              />
            </label>
            {error && <p role="alert" className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-400">{error}</p>}
            <button
              type="submit"
              disabled={loading}
              className="flex w-full items-center justify-center gap-2 rounded-lg bg-wattar-600 py-3 font-medium text-white hover:bg-wattar-700 disabled:opacity-50"
            >
              {loading && <Loader2 size={18} className="animate-spin" />}
              حفظ كلمة المرور
            </button>
          </form>
        ) : (
          <button
            onClick={() => navigate('/login', { replace: true })}
            className="w-full rounded-lg bg-wattar-600 py-3 font-medium text-white hover:bg-wattar-700"
          >
            العودة لتسجيل الدخول
          </button>
        )}

        {error && !hasRecoverySession && (
          <p role="alert" className="mt-4 rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-400">{error}</p>
        )}
      </div>
    </div>
  );
}
