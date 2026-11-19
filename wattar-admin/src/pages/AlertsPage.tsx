/**
 * Wattar Admin — صفحة التنبيهات الإدارية (M7.2 دفعة أ)
 * قائمة التنبيهات غير المقروءة مع إمكانية تحديدها كمقروءة أو تجاهلها.
 */
import { useCallback, useEffect, useState } from 'react';
import { Bell, Loader2, RefreshCw, ShieldAlert, X } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/lib/supabase';
import { PageHeader, SectionCard, EmptyState, Badge } from '@/components/ui';

interface AlertRow {
  id: string;
  alert_type: string;
  title: string;
  message: string;
  reference_type: string | null;
  reference_id: string | null;
  is_read: boolean;
  is_dismissed: boolean;
  created_at: string;
  read_at: string | null;
  dismissed_at: string | null;
  created_by_name: string | null;
}

const typeLabels: Record<string, string> = {
  user_report: 'بلاغ مستخدم',
  pending_deposit: 'إيداع معلق',
  pending_withdrawal: 'سحب معلق',
  system: 'نظام',
  security: 'أمان',
};

const typeTone: Record<string, 'success' | 'info' | 'warning' | 'danger' | 'neutral'> = {
  user_report: 'danger',
  pending_deposit: 'warning',
  pending_withdrawal: 'warning',
  system: 'info',
  security: 'danger',
};

export function AlertsPage() {
  const [alerts, setAlerts] = useState<AlertRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadAlerts = useCallback(async (showLoader = true) => {
    if (showLoader) setLoading(true);
    else setRefreshing(true);
    setError(null);
    try {
      const { data, error: queryError } = await supabase.rpc('admin_list_alerts');
      if (queryError) throw queryError;
      setAlerts((data ?? []) as AlertRow[]);
    } catch (loadError: unknown) {
      const message = loadError instanceof Error ? loadError.message : 'تعذر تحميل التنبيهات.';
      setError(message);
      toast.error(message);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void loadAlerts();
  }, [loadAlerts]);

  const unreadCount = alerts.filter((a) => !a.is_read).length;

  const markRead = async (id: string) => {
    try {
      const { error: rpcError } = await supabase.rpc('admin_mark_alert_read', { p_alert_id: id });
      if (rpcError) throw rpcError;
      setAlerts((rows) => rows.map((a) => (a.id === id ? { ...a, is_read: true } : a)));
      toast.success('تم تحديد التنبيه كمقروء.');
    } catch (markError: unknown) {
      toast.error(markError instanceof Error ? markError.message : 'تعذر تحديد التنبيه.');
    }
  };

  const dismiss = async (id: string) => {
    try {
      const { error: rpcError } = await supabase.rpc('admin_dismiss_alert', { p_alert_id: id });
      if (rpcError) throw rpcError;
      setAlerts((rows) => rows.filter((a) => a.id !== id));
      toast.success('تم تجاهل التنبيه.');
    } catch (dismissError: unknown) {
      toast.error(dismissError instanceof Error ? dismissError.message : 'تعذر تجاهل التنبيه.');
    }
  };

  return (
    <div className="space-y-6" dir="rtl">
      <PageHeader
        title="تنبيهات الإدارة"
        subtitle={`تنبيهات فورية عن البلاغات والإيداعات والسحوبات المعلّقة — ${unreadCount} غير مقروءة.`}
        actions={
          <button
            type="button"
            onClick={() => void loadAlerts(false)}
            disabled={refreshing}
            className="flex items-center gap-2 rounded-xl border border-white/10 bg-white/[0.03] px-4 py-2 text-sm text-gray-300 transition hover:border-white/20 disabled:opacity-50"
          >
            <RefreshCw size={15} className={refreshing ? 'animate-spin' : ''} />
            تحديث
          </button>
        }
      />

      {loading && alerts.length === 0 ? (
        <div className="flex items-center justify-center gap-2 py-10 text-sm text-gray-400">
          <Loader2 size={16} className="animate-spin" /> جاري التحميل…
        </div>
      ) : error ? (
        <EmptyState title="تعذر تحميل التنبيهات" description={error} />
      ) : alerts.length === 0 ? (
        <EmptyState title="لا توجد تنبيهات" description="كل التنبيهات تم عرضها أو تجاهلها." />
      ) : (
        <div className="divide-y divide-white/[0.04] rounded-xl border border-white/[0.06] bg-white/[0.02]">
          {alerts.map((alert) => (
            <div
              key={alert.id}
              className={`p-4 ${!alert.is_read ? 'bg-white/[0.03]' : ''} transition`}
            >
              <div className="flex flex-wrap items-start justify-between gap-3 mb-2">
                <div className="flex items-center gap-2">
                  <Badge tone={typeTone[alert.alert_type] ?? 'neutral'}>
                    {typeLabels[alert.alert_type] ?? alert.alert_type}
                  </Badge>
                  {!alert.is_read && (
                    <span className="h-2 w-2 rounded-full bg-wattar-500" />
                  )}
                </div>
                <span className="text-[11px] text-gray-500">
                  {new Date(alert.created_at).toLocaleString('ar')}
                </span>
              </div>
              <p className="text-sm font-medium text-gray-200 mb-1">{alert.title}</p>
              <p className="text-sm text-gray-400 mb-3">{alert.message}</p>
              {alert.reference_type && alert.reference_id && (
                <p className="text-[11px] text-gray-500">
                  المرجع: {alert.reference_type} · {alert.reference_id.slice(0, 8)}
                </p>
              )}
              <div className="flex items-center gap-3">
                {!alert.is_read ? (
                  <button
                    type="button"
                    onClick={() => void markRead(alert.id)}
                    className="rounded-lg border border-white/[0.08] px-3 py-1.5 text-xs text-wattar-300 transition hover:bg-white/5"
                  >
                    تحديد كمقروء
                  </button>
                ) : (
                  <span className="text-[11px] text-gray-600">مقروء</span>
                )}
                <button
                  type="button"
                  onClick={() => void dismiss(alert.id)}
                  className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-1.5 text-xs text-red-300 transition hover:bg-red-500/20"
                >
                  تجاهل
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
