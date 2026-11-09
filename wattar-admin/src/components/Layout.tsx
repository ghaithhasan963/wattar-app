import { ReactNode, useEffect, useMemo, useState } from 'react';
import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import {
  ArrowDownToLine,
  ArrowLeftRight,
  ArrowUpFromLine,
  ChevronDown,
  ClipboardList,
  Gift,
  Gamepad2,
  LayoutDashboard,
  LogOut,
  Menu,
  Mic,
  Settings,
  ShieldAlert,
  Target,
  UserCheck,
  Users,
  X,
} from 'lucide-react';
import { useAuthStore } from '@/store/auth';
import { clsx } from 'clsx';
import { toast } from 'sonner';

interface NavItem {
  to: string;
  label: string;
  icon: typeof LayoutDashboard;
  roles?: string[];
}

const navGroups: Array<{ label: string; items: NavItem[] }> = [
  {
    label: 'الرئيسية',
    items: [{ to: '/', label: 'نظرة عامة', icon: LayoutDashboard }],
  },
  {
    label: 'الحسابات والمجتمع',
    items: [
      { to: '/users', label: 'المستخدمون', icon: Users },
      { to: '/reports', label: 'بلاغات المستخدمين', icon: ShieldAlert, roles: ['admin', 'super_admin'] },
      { to: '/agents', label: 'الوكلاء', icon: UserCheck, roles: ['admin', 'super_admin'] },
    ],
  },
  {
    label: 'المعاملات',
    items: [
      { to: '/deposits', label: 'طلبات الشحن', icon: ArrowDownToLine },
      { to: '/withdrawals', label: 'طلبات السحب', icon: ArrowUpFromLine },
      { to: '/transfers', label: 'التحويلات', icon: ArrowLeftRight },
    ],
  },
  {
    label: 'إدارة المنصة',
    items: [
      { to: '/rooms', label: 'الغرف الصوتية', icon: Mic },
      { to: '/games', label: 'الألعاب', icon: Gamepad2, roles: ['admin', 'super_admin'] },
      { to: '/missions', label: 'المهمات', icon: Target, roles: ['admin', 'super_admin'] },
      { to: '/store', label: 'كتالوج الهدايا', icon: Gift, roles: ['admin', 'super_admin'] },
      { to: '/settings', label: 'الإعدادات', icon: Settings, roles: ['admin', 'super_admin'] },
    ],
  },
  {
    label: 'الرقابة',
    items: [{ to: '/audit', label: 'سجل الإدارة', icon: ClipboardList, roles: ['admin', 'super_admin'] }],
  },
];

const pageTitles = navGroups.flatMap((group) => group.items).reduce<Record<string, string>>((titles, item) => {
  titles[item.to] = item.label;
  return titles;
}, {});

export function Layout({ children }: { children: ReactNode }) {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const { profile, signOut } = useAuthStore();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const pageTitle = useMemo(() => pageTitles[pathname] ?? 'لوحة الإدارة', [pathname]);
  const [expandedGroup, setExpandedGroup] = useState<string>('الرئيسية');

  useEffect(() => {
    const activeGroup = navGroups.find((group) => group.items.some((item) => item.to === pathname));
    setExpandedGroup(activeGroup?.label ?? 'الرئيسية');
  }, [pathname]);

  const handleSignOut = async () => {
    try {
      await signOut();
      navigate('/login');
    } catch (error: unknown) {
      toast.error(error instanceof Error ? error.message : 'تعذر تسجيل الخروج');
    }
  };

  return (
    <div className="flex h-screen bg-dark text-white" dir="rtl">
      <aside
        className={clsx(
          'fixed inset-y-0 right-0 z-50 flex w-[min(19rem,88vw)] flex-col border-l border-white/[0.07] bg-[#171a2c] transition-transform lg:static lg:w-72 lg:translate-x-0',
          sidebarOpen ? 'translate-x-0' : 'translate-x-full',
        )}
      >
        <div className="flex h-[4.5rem] shrink-0 items-center justify-between border-b border-white/[0.07] px-5">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-wattar-400 to-wattar-700 text-lg font-bold text-white shadow-lg shadow-wattar-900/30">W</div>
            <div>
              <p className="font-bold text-white">Wattar <span className="text-wattar-300">| وتر</span></p>
              <p className="text-[11px] text-gray-500">مركز إدارة المنصة</p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => setSidebarOpen(false)}
            aria-label="إغلاق القائمة"
            className="rounded-lg p-2 text-gray-400 transition hover:bg-white/5 hover:text-white lg:hidden"
          >
            <X size={19} />
          </button>
        </div>

        <nav className="scrollbar-thin flex-1 space-y-5 overflow-y-auto px-3 py-5">
          {navGroups.map((group) => {
            const items = group.items.filter((item) => !item.roles || item.roles.includes(profile?.role ?? ''));
            if (items.length === 0) return null;
            const expanded = expandedGroup === group.label;
            return (
              <section key={group.label}>
                <button
                  type="button"
                  aria-expanded={expanded}
                  onClick={() => setExpandedGroup(expanded ? '' : group.label)}
                  className="mb-1 flex w-full items-center justify-between rounded-lg px-3 py-2 text-[10px] font-semibold tracking-wider text-gray-500 transition hover:bg-white/[0.035] hover:text-gray-300"
                >
                  {group.label}
                  <ChevronDown size={14} className={clsx('transition-transform', expanded && 'rotate-180')} />
                </button>
                {expanded && <div className="space-y-1">
                  {items.map((item) => (
                    <NavLink
                      key={item.to}
                      to={item.to}
                      end={item.to === '/'}
                      onClick={() => setSidebarOpen(false)}
                      className={({ isActive }) => clsx(
                        'group flex items-center gap-3 rounded-xl px-3 py-2.5 text-[13px] transition',
                        isActive
                          ? 'bg-wattar-600/20 font-semibold text-wattar-200 ring-1 ring-inset ring-wattar-500/20'
                          : 'text-gray-400 hover:bg-white/[0.045] hover:text-gray-100',
                      )}
                    >
                      {({ isActive }) => (
                        <>
                          <item.icon size={17} className={isActive ? 'text-wattar-300' : 'text-gray-500 group-hover:text-gray-300'} />
                          <span className="flex-1">{item.label}</span>
                          {isActive && <span className="h-1.5 w-1.5 rounded-full bg-wattar-300" />}
                        </>
                      )}
                    </NavLink>
                  ))}
                </div>}
              </section>
            );
          })}
        </nav>

        <div className="shrink-0 border-t border-white/[0.07] p-4">
          <div className="mb-3 flex items-center gap-3 rounded-xl bg-white/[0.035] p-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-full bg-wattar-700/70">
              {profile?.avatar_url ? (
                <img src={profile.avatar_url} alt="" className="h-full w-full object-cover" />
              ) : (
                <span className="font-semibold text-white">{profile?.username?.[0]?.toUpperCase() ?? 'A'}</span>
              )}
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-gray-100">{profile?.display_name ?? profile?.username ?? 'المسؤول'}</p>
              <p className="mt-0.5 text-xs text-gray-500">{getRoleLabel(profile?.role)}</p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => void handleSignOut()}
            className="flex w-full items-center gap-2 rounded-xl px-3 py-2.5 text-sm text-gray-400 transition hover:bg-red-400/10 hover:text-red-300"
          >
            <LogOut size={16} />
            تسجيل الخروج
          </button>
        </div>
      </aside>

      {sidebarOpen && (
        <button
          type="button"
          aria-label="إغلاق القائمة"
          className="fixed inset-0 z-40 bg-black/60 backdrop-blur-[2px] lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <header className="flex h-[4.5rem] shrink-0 items-center gap-4 border-b border-white/[0.07] bg-[#171a2c]/90 px-4 backdrop-blur lg:px-7">
          <button
            type="button"
            onClick={() => setSidebarOpen(true)}
            aria-label="فتح القائمة"
            className="rounded-xl border border-white/[0.08] p-2 text-gray-300 transition hover:bg-white/5 lg:hidden"
          >
            <Menu size={19} />
          </button>
          <div className="min-w-0 flex-1">
            <p className="text-[11px] text-gray-500">وتر <span className="px-1 text-gray-700">/</span> الإدارة</p>
            <h1 className="mt-0.5 truncate text-sm font-semibold text-white">{pageTitle}</h1>
          </div>
          <div className="hidden items-center gap-2 rounded-full border border-emerald-400/15 bg-emerald-400/[0.06] px-3 py-1.5 text-xs text-emerald-300 sm:flex">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
            لوحة الإدارة
          </div>
        </header>

        <main className="scrollbar-thin flex-1 overflow-y-auto p-4 sm:p-5 lg:p-7">
          <div className="mx-auto w-full max-w-[1600px]">{children}</div>
        </main>
      </div>
    </div>
  );
}

function getRoleLabel(role?: string): string {
  const labels: Record<string, string> = {
    admin: 'مسؤول',
    super_admin: 'مسؤول عام',
    agent: 'وكيل',
  };
  return labels[role ?? ''] ?? 'فريق الإدارة';
}
