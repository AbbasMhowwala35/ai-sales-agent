import { Navigate, Route, Routes } from 'react-router-dom';
import { lazy, Suspense, useEffect } from 'react';
import { useAuth } from './store/auth';
import { Layout } from './components/Layout';
import { Toaster, Spinner } from './components/ui';
import { get } from './lib/api';
import { AuthPage, AcceptInvitePage } from './pages/Auth';

const Dashboard = lazy(() => import('./pages/Dashboard'));
const Agents = lazy(() => import('./pages/Agents'));
const LeadGeneration = lazy(() => import('./pages/LeadGeneration'));
const Leads = lazy(() => import('./pages/Leads'));
const LeadDetail = lazy(() => import('./pages/LeadDetail'));
const Campaigns = lazy(() => import('./pages/Campaigns'));
const CampaignDetail = lazy(() => import('./pages/CampaignDetail'));
const Calls = lazy(() => import('./pages/Calls'));
const CallDetail = lazy(() => import('./pages/CallDetail'));
const Analytics = lazy(() => import('./pages/Analytics'));
const Knowledge = lazy(() => import('./pages/Knowledge'));
const Settings = lazy(() => import('./pages/Settings'));
const Team = lazy(() => import('./pages/Team'));
const Calendar = lazy(() => import('./pages/Calendar'));
const Talk = lazy(() => import('./pages/Talk'));

const Loading = () => <div className="flex justify-center py-24 text-muted"><Spinner className="h-6 w-6" /></div>;

export function App() {
  const token = useAuth((s) => s.token);
  const refreshProfile = useAuth((s) => s.refreshProfile);
  // Load the profile once per sign-in. (It used to save the token /auth/me returns, which changed the token,
  // which called /auth/me again — about once a second, clearing every page's cache each time.)
  const loggedIn = !!token;
  useEffect(() => { if (loggedIn) get('/auth/me').then(refreshProfile).catch(() => undefined); }, [loggedIn, refreshProfile]);
  return (
    <>
      <Suspense fallback={<Loading />}>
        <Routes>
          <Route path="/login" element={token ? <Navigate to="/" replace /> : <AuthPage mode="login" />} />
          <Route path="/register" element={token ? <Navigate to="/settings?welcome=1" replace /> : <AuthPage mode="register" />} />
          <Route path="/accept-invite" element={<AcceptInvitePage />} />
          <Route path="/talk/:token" element={<Talk />} />
          <Route element={token ? <Layout /> : <Navigate to="/login" replace />}>
            <Route index element={<Dashboard />} />
            <Route path="agents" element={<Agents />} />
            <Route path="lead-generation" element={<LeadGeneration />} />
            <Route path="leads" element={<Leads />} />
            <Route path="leads/:id" element={<LeadDetail />} />
            <Route path="campaigns" element={<Campaigns />} />
            <Route path="campaigns/:id" element={<CampaignDetail />} />
            <Route path="calls" element={<Calls />} />
            <Route path="calls/:id" element={<CallDetail />} />
            <Route path="analytics" element={<Analytics />} />
            <Route path="knowledge" element={<Knowledge />} />
            <Route path="settings" element={<Settings />} />
            <Route path="team" element={<Team />} />
            <Route path="calendar" element={<Calendar />} />
            <Route path="*" element={<div className="py-24 text-center"><h1 className="text-2xl font-[650]">Page not found</h1><p className="text-muted mt-1">This page doesn’t exist. Use the menu to find your way.</p></div>} />
          </Route>
        </Routes>
      </Suspense>
      <Toaster />
    </>
  );
}
