/**
 * Wattar Admin — صفحة التحويلات بين المستخدمين
 */
import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';

interface Transfer {
  id: string;
  amount_gold: number;
  fee_gold: number;
  net_gold: number;
  note: string | null;
  status: string;
  created_at: string;
  from_user: { username: string; display_name: string | null } | null;
  to_user: { username: string; display_name: string | null } | null;
}

export function TransfersPage() {
  const [transfers, setTransfers] = useState<Transfer[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    load();
  }, []);

  const load = async () => {
    setLoading(true);
    const { data } = await supabase
      .from('transfers')
      .select(`
        id, amount_gold, fee_gold, net_gold, note, status, created_at,
        from_user:users!transfers_from_user_id_fkey(username, display_name),
        to_user:users!transfers_to_user_id_fkey(username, display_name)
      `)
      .order('created_at', { ascending: false })
      .limit(100);
    setTransfers(((data ?? []) as any[]).map(t => ({
      ...t,
      from_user: Array.isArray(t.from_user) ? t.from_user[0] ?? null : t.from_user,
      to_user: Array.isArray(t.to_user) ? t.to_user[0] ?? null : t.to_user,
    })));
    setLoading(false);
  };

  return (
    <div className="space-y-6" dir="rtl">
      <div>
        <h1 className="text-2xl font-bold text-white">التحويلات بين المستخدمين</h1>
        <p className="text-gray-400 mt-1">مراقبة تحويلات الذهب بين المستخدمين</p>
      </div>

      <div className="bg-dark-surface rounded-xl border border-wattar-900 overflow-hidden overflow-x-auto">
        <table className="w-full">
          <thead className="bg-dark-elevated border-b border-wattar-900">
            <tr>
              <th className="text-right p-4 text-sm font-medium text-gray-400">المُرسِل</th>
              <th className="text-right p-4 text-sm font-medium text-gray-400">المُستلِم</th>
              <th className="text-right p-4 text-sm font-medium text-gray-400">المبلغ</th>
              <th className="text-right p-4 text-sm font-medium text-gray-400">الرسوم</th>
              <th className="text-right p-4 text-sm font-medium text-gray-400">الصافي</th>
              <th className="text-right p-4 text-sm font-medium text-gray-400">ملاحظة</th>
              <th className="text-right p-4 text-sm font-medium text-gray-400">التاريخ</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={7} className="text-center p-8 text-gray-400">جاري التحميل...</td></tr>
            ) : transfers.length === 0 ? (
              <tr><td colSpan={7} className="text-center p-8 text-gray-500">لا توجد تحويلات</td></tr>
            ) : transfers.map(t => (
              <tr key={t.id} className="border-b border-wattar-900/50">
                <td className="p-4 text-sm text-white">{t.from_user?.display_name ?? t.from_user?.username}</td>
                <td className="p-4 text-sm text-white">{t.to_user?.display_name ?? t.to_user?.username}</td>
                <td className="p-4 text-sm font-semibold text-gold-500">{t.amount_gold}</td>
                <td className="p-4 text-sm text-gray-400">{t.fee_gold}</td>
                <td className="p-4 text-sm text-green-400">{t.net_gold}</td>
                <td className="p-4 text-sm text-gray-400">{t.note ?? '—'}</td>
                <td className="p-4 text-sm text-gray-400">{new Date(t.created_at).toLocaleString('ar-EG')}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
