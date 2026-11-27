/**
 * Wattar Admin — تطبيق React الرئيسي
 */
import { useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Toaster } from 'sonner';

import { StaffRole, canAccess, useAuthStore } from '@/store/auth';
import { Layout } from '@/components/Layout';
import { LoginPage } from '@/pages/LoginPage';
import { ResetPasswordPage } from '@/pages/ResetPasswordPage';
import { DashboardPage } from '@/pages/DashboardPage';
import { DepositsPage } from '@/pages/DepositsPage';
import { WithdrawalsPage } from '@/pages/WithdrawalsPage';
import { UsersPage } from '@/pages/UsersPage';
import { AgentsPage } from '@/pages/AgentsPage';
import { AgenciesPage } from '@/pages/AgenciesPage';
import { GamesPage } from '@/pages/GamesPage';
import { SettingsPage } from '@/pages/SettingsPage';
import { TransfersPage } from '@/pages/TransfersPage';
import { RoomsPage } from '@/pages/RoomsPage';
import { AuditLogPage } from '@/pages/AuditLogPage';
import { PlatformActivityPage } from '@/pages/PlatformActivityPage';
import { MissionsPage } from '@/pages/MissionsPage';
import { StoreItemsPage } from '@/pages/StoreItemsPage';
import { UserReportsPage } from '@/pages/UserReportsPage';
import { ModerationPage } from '@/pages/ModerationPage';
import { AgentDashboardPage } from '@/pages/AgentDashboardPage';
import { HostApplicationsPage } from '@/pages/HostApplicationsPage';
import { MembershipsPage } from '@/pages/MembershipsPage';
import { VIPPage } from '@/pages/VIPPage';
import { MessagingPage } from '@/pages/MessagingPage';
import { SupportPage } from '@/pages/SupportPage';
import { AlertsPage } from '@/pages/AlertsPage';
import { StaffPage } from '@/pages/StaffPage';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      retry: 1,
    },
  },
});

/**
 * حماية المسار بمعيارين:
 * - roles: للبوابات ذات الأدوار الخاصة خارج نظام الموظفين (الوكيل).
 * - permission: سلوك RBAC افتراضي — يُسمح لمن يملك صلاحية الصفحة
 *   من مصفوفة الدور، أو الإدارة العليا، أو الأدوار القديمة (توافق).
 */
function ProtectedRoute({
  children,
  roles,
  permission,
  withLayout = true,
}: {
  children: React.ReactNode;
  roles?: StaffRole[];
  permission?: string;
  withLayout?: boolean;
}) {
  const { session, profile, initialized } = useAuthStore();

  if (!initialized) {
    return <div className="flex min-h-screen items-center justify-center text-sm text-gray-400">جاري التحقق من صلاحيات الإدارة...</div>;
  }
  if (!session) {
    return <Navigate to="/login" replace />;
  }

  if (!profile) {
    return <Navigate to="/login" replace />;
  }
  const roleOk = roles ? roles.includes(profile.role) : true;
  const permissionOk = permission ? canAccess(profile, permission) : true;
  if (!roleOk || !permissionOk) {
    return <Navigate to={profile.role === 'agent' || profile.role === 'agency_manager' ? '/agent' : '/'} replace />;
  }

  return withLayout ? <Layout>{children}</Layout> : <>{children}</>;
}

function HomeRoute() {
  const { session, profile, initialized } = useAuthStore();

  if (!initialized) {
    return <div className="flex min-h-screen items-center justify-center text-sm text-gray-400">جاري التحقق من الحساب...</div>;
  }
  if (!session || !profile) return <Navigate to="/login" replace />;
  return profile.role === 'agent' || profile.role === 'agency_manager'
    ? <Navigate to="/agent" replace />
    : profile.role === 'support' && !profile.staffRole
      ? <Navigate to="/support" replace />
    : <ProtectedRoute permission="dashboard.view"><DashboardPage /></ProtectedRoute>;
}

export default function App() {
  const initialize = useAuthStore(state => state.initialize);

  useEffect(() => {
    initialize();
  }, [initialize]);

  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/reset-password" element={<ResetPasswordPage />} />
          <Route
            path="/"
            element={<HomeRoute />}
          />
          <Route
            path="/agent"
            element={
              <ProtectedRoute roles={['agent', 'agency_manager']} withLayout={false}>
                <AgentDashboardPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/support"
            element={
              <ProtectedRoute permission="support.view">
                <SupportPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/deposits"
            element={
              <ProtectedRoute permission="deposits.view">
                <DepositsPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/withdrawals"
            element={
              <ProtectedRoute permission="withdrawals.view">
                <WithdrawalsPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/users"
            element={
              <ProtectedRoute permission="users.view">
                <UsersPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/agents"
            element={
              <ProtectedRoute permission="agents.view">
                <AgentsPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/agencies"
            element={
              <ProtectedRoute permission="agencies.view">
                <AgenciesPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/hosts"
            element={
              <ProtectedRoute permission="hosts.applications.view">
                <HostApplicationsPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/games"
            element={
              <ProtectedRoute permission="games.view">
                <GamesPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/transfers"
            element={
              <ProtectedRoute permission="transfers.view">
                <TransfersPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/rooms"
            element={
              <ProtectedRoute permission="rooms.view">
                <RoomsPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/settings"
            element={
              <ProtectedRoute permission="settings.view">
                <SettingsPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/audit"
            element={
              <ProtectedRoute permission="audit.view">
                <AuditLogPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/activity"
            element={
              <ProtectedRoute permission="reports.platform">
                <PlatformActivityPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/reports"
            element={
              <ProtectedRoute permission="user_reports.view">
                <UserReportsPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/moderation"
            element={
              <ProtectedRoute permission="moderation.view">
                <ModerationPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/missions"
            element={
              <ProtectedRoute permission="missions.view">
                <MissionsPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/store"
            element={
              <ProtectedRoute permission="store.view">
                <StoreItemsPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/memberships"
            element={
              <ProtectedRoute permission="memberships.view">
                <MembershipsPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/vip"
            element={
              <ProtectedRoute permission="vip.view">
                <VIPPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/messaging"
            element={
              <ProtectedRoute permission="messaging.settings.view">
                <MessagingPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/staff"
            element={
              <ProtectedRoute permission="staff.view">
                <StaffPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/alerts"
            element={
              <ProtectedRoute permission="dashboard.view">
                <AlertsPage />
              </ProtectedRoute>
            }
          />
          <Route path="*" element={<HomeRoute />} />
        </Routes>
        <Toaster position="top-center" richColors />
      </BrowserRouter>
    </QueryClientProvider>
  );
}
