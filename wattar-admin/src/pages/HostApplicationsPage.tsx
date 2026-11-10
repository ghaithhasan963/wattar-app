import { useCallback, useEffect, useState } from 'react';
import { BadgeCheck, Check, Loader2, RefreshCw, X } from 'lucide-react';
import { toast } from 'sonner';
import { callFunction, supabase } from '@/lib/supabase';

interface HostApplication {
  id: string;
  user_id: string;
  application_text: string;
  status: string;
  created_at: string;
  user: { username: string; display_name: string | null; phone: string | null } | null;
}

export function HostApplicationsPage() {
  const [applications, setApplications] = useState<HostApplication[]>([]);
  const [loading, setLoading] = useState(true);
  const [processingId, setProcessingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { data, error: queryError } = await supabase
        .from('host_applications')
        .select('id, user_id, application_text, status, created_at, user:users!host_applications_user_id_fkey(username, display_name, phone)')
        .eq('status', 'pending')
        .order('created_at', { ascending: true })
        .limit(200);
      if (queryError) throw queryError;
      const rows = (data ?? []) as Array<HostApplication & {
        user: HostApplication['user'] | HostApplication['user'][];
      }>;
      setApplications(rows.map((row) => ({
        ...row,
        user: Array.isArray(row.user) ? row.user[0] ?? null : row.user,
      })));
    } catch (caught: unknown) {
      const message = caught instanceof Error ? caught.message : 'تعذر تحميل طلبات المضيفات.';
      setError(message);
      toast.error(message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const review = async (application: HostApplication, approve: boolean) => {
    const reviewNote = approve
      ? window.prompt('ملاحظة للمتقدمة (اختياري):') ?? ''
      : window.prompt('اكتب سبب رفض الطلب:') ?? '';
    if (!approve && !reviewNote.trim()) return;

    setProcessingId(application.id);
    try {
      await callFunction('host-application-review', {
        application_id: application.id,
        approve,
        review_note: reviewNote.trim() || undefined,
      });
      toast.success(approve ? 'تم اعتماد المضيفة وإظهار شارة التوثيق.' : 'تم رفض الطلب وتسجيل سبب المراجعة.');
      await load();
    } catch (caught: unknown) {
      toast.error(caught instanceof Error ? caught.message : 'تعذرت مراجعة الطلب.');
    } finally {
      setProcessingId(null);
    }
  };

  return (
    <div className="space-y-6" dir="rtl">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <span className="rounded-xl bg-fuchsia-400/10 p-3 text-fuchsia-300"><BadgeCheck size={22} /></span>
          <div>
            <h1 className="text-2xl font-bold text-white">طلبات المضيفات</h1>
            <p className="mt-1 text-sm text-gray-400">اعتماد حسابات حقيقية بعد مراجعة الطلب؛ لا توجد رسائل منتحلة أو آلية باسم المضيفة.</p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => void load()}
          disabled={loading}
          className="inline-flex items-center gap-2 rounded-xl border border-white/10 bg-dark-surface px-4 py-2.5 text-sm text-gray-200 transition hover:bg-dark-elevated disabled:opacity-50"
        >
          <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
          تحديث
        </button>
      </header>

      {error && (
        <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-200">
          <span>تعذر تحميل الطلبات: {error}</span>
          <button onClick={() => void load()} className="rounded-lg bg-red-500/15 px-3 py-2 font-medium hover:bg-red-500/25">إعادة المحاولة</button>
        </div>
      )}

      <section className="overflow-hidden rounded-2xl border border-white/[0.07] bg-dark-surface">
        {loading && applications.length === 0 ? (
          <p className="p-10 text-center text-sm text-gray-400">جاري تحميل الطلبات...</p>
        ) : applications.length === 0 ? (
          <p className="p-12 text-center text-sm text-gray-500">لا توجد طلبات معلّقة.</p>
        ) : (
          <div className="divide-y divide-white/[0.06]">
            {applications.map((application) => (
              <article key={application.id} className="space-y-4 p-5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="font-semibold text-white">{application.user?.display_name || application.user?.username || 'مستخدمة'}</p>
                    <p className="mt-1 text-xs text-gray-500">
                      @{application.user?.username ?? '—'} · {application.user?.phone ?? 'لا يوجد هاتف'}
                    </p>
                  </div>
                  <time className="text-xs text-gray-500" dateTime={application.created_at}>
                    {new Date(application.created_at).toLocaleString('ar')}
                  </time>
                </div>
                <p className="whitespace-pre-wrap break-words rounded-xl bg-dark-elevated p-4 text-sm leading-7 text-gray-300">
                  {application.application_text}
                </p>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => void review(application, true)}
                    disabled={processingId === application.id}
                    className="inline-flex items-center gap-2 rounded-lg bg-green-600 px-4 py-2 text-sm text-white disabled:opacity-50"
                  >
                    {processingId === application.id ? <Loader2 size={16} className="animate-spin" /> : <Check size={16} />}
                    اعتماد المضيفة
                  </button>
                  <button
                    type="button"
                    onClick={() => void review(application, false)}
                    disabled={processingId === application.id}
                    className="inline-flex items-center gap-2 rounded-lg bg-red-500/10 px-4 py-2 text-sm text-red-300 disabled:opacity-50"
                  >
                    <X size={16} />
                    رفض مع توضيح السبب
                  </button>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
