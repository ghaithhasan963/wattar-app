/**
 * Wattar Admin — نافذة دفتر المحفظة (وكيل أو وكالة)
 * قراءة مباشرة عبر RLS (الإدارة ترى كل شيء)، بترحيل «تحميل المزيد»،
 * وكل صف يوضح النوع بمسمّى عربي والرصيد بعده.
 */
import { useCallback, useEffect, useState } from 'react';
import { FileText, Loader2, X } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { Badge } from '@/components/ui';

const PAGE_SIZE = 50;

export const LEDGER_EVENT_LABELS: Record<string, string> = {
  opening: 'رصيد افتتاحي',
  admin_credit: 'شحن إداري',
  agency_transfer: 'تحويل من الوكالة',
  transfer_to_agent: 'تحويل إلى وكيل',
  funding_credit: 'تمويل معتمد',
  deposit_sale: 'اعتماد شحن',
  withdrawal_payout: 'دفع سحب',
  commission: 'احتساب عمولة',
  adjustment: 'تسوية إدارية',
  reversal: 'قيد عكسي',
};

interface LedgerRow {
  id: string;
  event_type: string;
  amount_usd: number;
  balance_before: number;
  balance_after: number;
  notes: string | null;
  created_at: string;
}

export function LedgerModal({
  kind,
  targetId,
  title,
  subtitle,
  onClose,
}: {
  kind: 'agent' | 'agency';
  targetId: string;
  title: string;
  subtitle?: string;
  onClose: () => void;
}) {
  const [rows, setRows] = useState<LedgerRow[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const table = kind === 'agent' ? 'agent_wallet_ledger' : 'agency_wallet_ledger';
  const column = kind === 'agent' ? 'agent_id' : 'agency_id';

  const loadPage = useCallback(async (offset: number) => {
    let query = supabase
      .from(table)
      .select('id, event_type, amount_usd, balance_before, balance_after, notes, created_at', { count: 'exact' })
      .eq(column, targetId)
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
      .range(offset, offset + PAGE_SIZE - 1);
    const { data, error, count } = await query;
    if (error) throw error;
    return { page: (data ?? []) as LedgerRow[], count: count ?? 0 };
  }, [table, column, targetId]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const { page, count } = await loadPage(0);
        if (cancelled) return;
        setRows(page);
        setTotal(count);
      } catch {
        if (!cancelled) setRows([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [loadPage]);

  const loadMore = async () => {
    if (loadingMore || rows.length >= total) return;
    setLoadingMore(true);
    try {
      const { page } = await loadPage(rows.length);
      setRows((current) => [...current, ...page]);
    } finally {
      setLoadingMore(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-2xl border border-white/[0.08] bg-[#171a2c]"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between border-b border-white/[0.07] p-5">
          <div>
            <h2 className="flex items-center gap-2 text-lg font-semibold text-white"><FileText size={18} />{title}</h2>
            {subtitle ? <p className="mt-1 text-xs text-gray-400">{subtitle}</p> : null}
            <p className="mt-1 text-[11px] text-gray-500">{total.toLocaleString('ar')} قيداً — لا يمكن تعديل أي منها أو حذفه</p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-white" aria-label="إغلاق"><X size={20} /></button>
        </div>

        <div className="p-5">
          {loading ? (
            <div className="flex items-center justify-center gap-2 py-10 text-sm text-gray-400">
              <Loader2 size={16} className="animate-spin" /> جارٍ تحميل الدفتر…
            </div>
          ) : rows.length === 0 ? (
            <p className="py-8 text-center text-sm text-gray-500">لا توجد حركات بعد.</p>
          ) : (
            <>
              <div className="divide-y divide-white/[0.06]">
                {rows.map((row) => {
                  const negative = Number(row.amount_usd) < 0;
                  return (
                    <div key={row.id} className="flex flex-wrap items-center gap-3 py-2.5">
                      <Badge tone={negative ? 'danger' : 'success'}>
                        {negative ? '−' : '+'}${Math.abs(Number(row.amount_usd)).toFixed(2)}
                      </Badge>
                      <span className="text-xs text-gray-100">{LEDGER_EVENT_LABELS[row.event_type] ?? row.event_type}</span>
                      <span className="text-[11px] text-gray-500">الرصيد بعدها ${Number(row.balance_after).toFixed(2)}</span>
                      {row.notes ? <span className="min-w-0 flex-1 truncate text-[11px] text-gray-500">{row.notes}</span> : <span className="flex-1" />}
                      <span className="text-[11px] text-gray-500">{new Date(row.created_at).toLocaleString('ar', { dateStyle: 'short', timeStyle: 'short' })}</span>
                    </div>
                  );
                })}
              </div>
              {rows.length < total && (
                <button
                  type="button"
                  onClick={() => void loadMore()}
                  disabled={loadingMore}
                  className="mt-4 w-full rounded-xl border border-white/[0.08] px-4 py-2.5 text-sm text-gray-300 hover:bg-white/[0.04] disabled:opacity-50"
                >
                  {loadingMore ? 'جارٍ التحميل…' : 'تحميل قيود أقدم'}
                </button>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
