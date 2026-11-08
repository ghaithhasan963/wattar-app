/**
 * Wattar Admin — التخطيط الرئيسي
 * Sidebar + Header + Content area
 */
import { ReactNode, useState } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import {
  LayoutDashboard,
  Users,
  UserCheck,
  ArrowDownToLine,
  ArrowUpFromLine,
  ArrowLeftRight,
  Gamepad2,
  Mic,
  Settings,
  LogOut,
  Menu,
  X,
  Bell,
  Search,
} from 'lucide-react';
import { useAuthStore } from '@/store/auth';
import { clsx } from 'clsx';

interface NavItem {
  to: string;
  label: string;
  icon: typeof LayoutDashboard;
  roles?: string[];
}

const navItems: NavItem[] = [
  { to: '/', label: 'لوحة المعلومات', icon: LayoutDashboard },
  { to: '/users', label: 'المستخدمون', icon: Users },
  { to: '/agents', label: 'الوكلاء', icon: UserCheck, roles: ['admin', 'super_admin'] },
  { to: '/deposits', label: 'طلبات الشحن', icon: ArrowDownToLine },
  { to: '/withdrawals', label: 'طلبات السحب', icon: ArrowUpFromLine },
  { to: '/transfers', label: 'التحويلات', icon: ArrowLeftRight },
  { to: '/games', label: 'الألعاب', icon: Gamepad2, roles: ['admin', 'super_admin'] },
  { to: '/rooms', label: 'الغرف الصوتية', icon: Mic },
  { to: '/settings', label: 'الإعدادات', icon: Settings, roles: ['admin', 'super_admin'] },
];

export function Layout({ children }: { children: ReactNode }) {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const { profile, signOut } = useAuthStore();
  const navigate = useNavigate();

  const userRole = profile?.role ?? 'admin';
  const filteredNav = navItems.filter(item => !item.roles || item.roles.includes(userRole));

  const handleSignOut = async () => {
    await signOut();
    navigate('/login');
  };

  return (
    <div className="flex h-screen bg-dark text-white" dir="rtl">
      {/* Sidebar */}
      <aside
        className={clsx(
          'fixed inset-y-0 right-0 z-50 w-64 bg-dark-surface border-l border-wattar-900 transition-transform lg:static lg:translate-x-0',
          sidebarOpen ? 'translate-x-0' : 'translate-x-full',
        )}
      >
        <div className="flex h-16 items-center justify-between border-b border-wattar-900 px-6">
          <div className="flex items-center gap-2">
            <div className="h-8 w-8 rounded-lg bg-gradient-to-br from-wattar-500 to-wattar-700 flex items-center justify-center font-bold text-white">
              W
            </div>
            <span className="text-xl font-bold text-wattar-300">Wattar | وتر</span>
          </div>
          <button
            onClick={() => setSidebarOpen(false)}
            className="lg:hidden text-gray-400 hover:text-white"
          >
            <X size={20} />
          </button>
        </div>

        <nav className="flex-1 overflow-y-auto p-4 space-y-1">
          {filteredNav.map(item => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === '/'}
              className={({ isActive }) =>
                clsx(
                  'flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm transition-colors',
                  isActive
                    ? 'bg-wattar-600 text-white'
                    : 'text-gray-300 hover:bg-dark-elevated hover:text-white',
                )
              }
            >
              <item.icon size={18} />
              {item.label}
            </NavLink>
          ))}
        </nav>

        <div className="border-t border-wattar-900 p-4">
          <div className="mb-3 flex items-center gap-3">
            <div className="h-10 w-10 rounded-full bg-wattar-700 flex items-center justify-center">
              {profile?.avatar_url ? (
                <img src={profile.avatar_url} alt="" className="h-full w-full rounded-full object-cover" />
              ) : (
                <span className="text-white font-medium">{profile?.username?.[0]?.toUpperCase() ?? 'A'}</span>
              )}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium truncate">{profile?.display_name ?? profile?.username}</p>
              <p className="text-xs text-gray-400">{getRoleLabel(profile?.role)}</p>
            </div>
          </div>
          <button
            onClick={handleSignOut}
            className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-gray-300 hover:bg-dark-elevated hover:text-white"
          >
            <LogOut size={16} />
            تسجيل خروج
          </button>
        </div>
      </aside>

      {/* Overlay */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/50 lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Main */}
      <div className="flex-1 flex flex-col overflow-hidden">
        <header className="h-16 bg-dark-surface border-b border-wattar-900 flex items-center justify-between px-4 lg:px-6">
          <button
            onClick={() => setSidebarOpen(true)}
            className="lg:hidden text-gray-400 hover:text-white"
          >
            <Menu size={20} />
          </button>

          <div className="flex-1 max-w-md hidden md:block">
            <div className="relative">
              <Search className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400" size={18} />
              <input
                type="text"
                placeholder="بحث..."
                className="w-full rounded-lg bg-dark-elevated border border-wattar-900 py-2 pr-10 pl-4 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-wattar-500"
              />
            </div>
          </div>

          <div className="flex items-center gap-3">
            <button className="relative text-gray-400 hover:text-white">
              <Bell size={20} />
              <span className="absolute -top-1 -right-1 h-4 w-4 rounded-full bg-gold-500 text-[10px] flex items-center justify-center text-white">
                3
              </span>
            </button>
          </div>
        </header>

        <main className="flex-1 overflow-y-auto p-4 lg:p-6">
          {children}
        </main>
      </div>
    </div>
  );
}

function getRoleLabel(role?: string): string {
  const labels: Record<string, string> = {
    admin: 'أدمن',
    super_admin: 'أدمن عام',
    agent: 'وكيل',
  };
  return labels[role ?? 'admin'] ?? role;
}
