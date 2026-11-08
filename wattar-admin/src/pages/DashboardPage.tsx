/**
 * Wattar Admin — لوحة المعلومات (Dashboard)
 * إحصائيات سريعة + قوائم الطلبات الأخيرة
 */
import { useEffect, useState } from 'react';
import {
  Users,
  DollarSign,
  TrendingUp,
  ArrowDownToLine,
  ArrowUpFromLine,
  Activity,
} from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { StatCard } from '@/components/StatCard';

interface DashboardStats {
  total_users: number;
  active_users_today: number;
  total_agents: number;
  pending_deposits: number;
  pending_withdrawals: number;
  total_deposits_today_usd: number;
  total_withdrawals_today_usd: number;
  house_profit_today_usd: number;
  active_rooms: number;
}

export function DashboardPage() {
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [recentDeposits, setRecentDeposits] = useState<any[]>([]);
  const [recentWithdrawals, setRecentWithdrawals] = useState<any[]>([]);

  useEffect(() => {
    loadDashboard();
  }, []);

  const loadDashboard = async () => {
    setLoading(true);
    try {
      // إحصائيات المستخدمين
      const { count: totalUsers } = await supabase
        .from('users')
        .select('*', { count: 'exact', head: true })
        .eq('role', 'user');

      const { count: activeToday } = await supabase
        .from('users')
        .select('*', { count: 'exact', head: true })
        .gte('last_seen_at', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString());

      const { count: totalAgents } = await supabase
        .from('agents')
        .select('*', { count: 'exact', head: true })
        .eq('status', 'active');

      const { count: pendingDep } = await supabase
        .from('deposits')
        .select('*', { count: 'exact', head: true })
        .eq('status', 'pending');

      const { count: pendingWd } = await supabase
        .from('withdrawals')
        .select('*', { count: 'exact', head: true })
        .eq('status', 'pending');

      const { count: activeRooms } = await supabase
        .from('rooms')
        .select('*', { count: 'exact', head: true })
        .eq('status', 'live');

      setStats({
        total_users: totalUsers ?? 0,
        active_users_today: activeToday ?? 0,
        total_agents: totalAgents ?? 0,
        pending_deposits: pendingDep ?? 0,
        pending_withdrawals: pendingWd ?? 0,
        total_deposits_today_usd: 0,
        total_withdrawals_today_usd: 0,
        house_profit_today_usd: 0,
        active_rooms: activeRooms ?? 0,
      });

      // آخر طلبات الشحن
      const { data: recentDep } = await supabase
        .from('deposits')
        .select(`
          id, amount_usd, amount_gold, method, status, created_at,
          user:users(username, display_name)
        `)
        .order('created_at', { ascending: false })
        .limit(5);

      setRecentDeposits(recentDep ?? []);

      // آخر طلبات السحب
      const { data: recentWd } = await supabase
        .from('withdrawals')
        .select(`
          id, amount_usd, amount_gold, method, status, created_at,
          user:users(username, display_name)
        `)
        .order('created_at', { ascending: false })
        .limit(5);

      setRecentWithdrawals(recentWd ?? []);
    } catch (err) {
      console.error('Dashboard load error:', err);
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return <div className="text-gray-400">جاري التحميل...</div>;
  }

  return (
    <div className="space-y-6" dir="rtl">
      <div>
        <h1 className="text-2xl font-bold text-white">لوحة المعلومات</h1>
        <p className="text-gray-400 mt-1">نظرة عامة على نشاط التطبيق</p>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          title="إجمالي المستخدمين"
          value={stats?.total_users ?? 0}
          icon={Users}
          color="wattar"
        />
        <StatCard
          title="نشط اليوم"
          value={stats?.active_users_today ?? 0}
          icon={Activity}
          color="green"
        />
        <StatCard
          title="الوكلاء"
          value={stats?.total_agents ?? 0}
          icon={Users}
          color="blue"
        />
        <StatCard
          title="غرف نشطة"
          value={stats?.active_rooms ?? 0}
          icon={TrendingUp}
          color="gold"
        />
      </div>

      {/* Pending Requests */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <StatCard
          title="طلبات شحن معلّقة"
          value={stats?.pending_deposits ?? 0}
          icon={ArrowDownToLine}
          color="gold"
          link="/deposits"
        />
        <StatCard
          title="طلبات سحب معلّقة"
          value={stats?.pending_withdrawals ?? 0}
          icon={ArrowUpFromLine}
          color="red"
          link="/withdrawals"
        />
      </div>

      {/* Recent Activity */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-dark-surface rounded-xl border border-wattar-900 p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold text-white">آخر طلبات الشحن</h2>
            <a href="/deposits" className="text-sm text-wattar-400 hover:text-wattar-300">عرض الكل</a>
          </div>
          <div className="space-y-3">
            {recentDeposits.map((dep) => (
              <div key={dep.id} className="flex items-center justify-between py-2 border-b border-wattar-900/50">
                <div>
                  <p className="text-sm font-medium text-white">{dep.user?.display_name ?? dep.user?.username}</p>
                  <p className="text-xs text-gray-500">{dep.method} · {new Date(dep.created_at).toLocaleString('ar-EG')}</p>
                </div>
                <div className="text-left">
                  <p className="text-sm font-semibold text-gold-500">${dep.amount_usd}</p>
                  <p className="text-xs text-gray-500">{dep.amount_gold} ذهب</p>
                </div>
              </div>
            ))}
            {recentDeposits.length === 0 && (
              <p className="text-sm text-gray-500 text-center py-4">لا توجد طلبات</p>
            )}
          </div>
        </div>

        <div className="bg-dark-surface rounded-xl border border-wattar-900 p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold text-white">آخر طلبات السحب</h2>
            <a href="/withdrawals" className="text-sm text-wattar-400 hover:text-wattar-300">عرض الكل</a>
          </div>
          <div className="space-y-3">
            {recentWithdrawals.map((wd) => (
              <div key={wd.id} className="flex items-center justify-between py-2 border-b border-wattar-900/50">
                <div>
                  <p className="text-sm font-medium text-white">{wd.user?.display_name ?? wd.user?.username}</p>
                  <p className="text-xs text-gray-500">{wd.method} · {new Date(wd.created_at).toLocaleString('ar-EG')}</p>
                </div>
                <div className="text-left">
                  <p className="text-sm font-semibold text-red-400">${wd.amount_usd}</p>
                  <p className="text-xs text-gray-500">{wd.amount_gold} ذهب</p>
                </div>
              </div>
            ))}
            {recentWithdrawals.length === 0 && (
              <p className="text-sm text-gray-500 text-center py-4">لا توجد طلبات</p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
