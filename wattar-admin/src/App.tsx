/**
 * Wattar Admin — تطبيق React الرئيسي
 */
import { useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Toaster } from 'sonner';

import { StaffRole, useAuthStore } from '@/store/auth';
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
import { MessagingPage } from '@/pages/MessagingPage';
import { SupportPage } from '@/pages/SupportPage';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      retry: 1,
    },
  },
});

function ProtectedRoute({
  children,
  roles = ['admin', 'super_admin'],
  withLayout = true,
}: {
  children: React.ReactNode;
  roles?: StaffRole[];
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
  if (!roles.includes(profile.role)) {
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
    : profile.role === 'support'
      ? <Navigate to="/support" replace />
    : <ProtectedRoute><DashboardPage /></ProtectedRoute>;
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
              <ProtectedRoute roles={['admin', 'super_admin', 'support']}>
                <SupportPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/deposits"
            element={
              <ProtectedRoute>
                <DepositsPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/withdrawals"
            element={
              <ProtectedRoute>
                <WithdrawalsPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/users"
            element={
              <ProtectedRoute>
                <UsersPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/agents"
            element={
              <ProtectedRoute>
                <AgentsPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/agencies"
            element={
              <ProtectedRoute>
                <AgenciesPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/hosts"
            element={
              <ProtectedRoute>
                <HostApplicationsPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/games"
            element={
              <ProtectedRoute>
                <GamesPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/transfers"
            element={
              <ProtectedRoute>
                <TransfersPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/rooms"
            element={
              <ProtectedRoute>
                <RoomsPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/settings"
            element={
              <ProtectedRoute>
                <SettingsPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/audit"
            element={
              <ProtectedRoute>
                <AuditLogPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/activity"
            element={
              <ProtectedRoute>
                <PlatformActivityPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/reports"
            element={
              <ProtectedRoute>
                <UserReportsPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/moderation"
            element={
              <ProtectedRoute>
                <ModerationPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/missions"
            element={
              <ProtectedRoute>
                <MissionsPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/store"
            element={
              <ProtectedRoute>
                <StoreItemsPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/memberships"
            element={
              <ProtectedRoute>
                <MembershipsPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/messaging"
            element={
              <ProtectedRoute>
                <MessagingPage />
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
