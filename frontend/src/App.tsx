import { lazy, Suspense, useEffect } from 'react'
import { Routes, Route, Navigate, useNavigate } from 'react-router-dom'
import { Toaster } from 'react-hot-toast'
import { MotionConfig } from 'framer-motion'
import axios from 'axios'
import { AuthProvider, useAuth } from './hooks/useAuth'
import { EmeraldChatProvider } from './hooks/useEmeraldChat'
import ProtectedRoute from './components/ProtectedRoute'
import Sidebar from './components/Sidebar'
import TopBar from './components/TopBar'
import MobileTopBar from './components/MobileTopBar'
import BottomTabs from './components/BottomTabs'
import GroupSwitcher from './components/GroupSwitcher'
import EmeraldPanel from './components/EmeraldPanel'
import Login from './pages/Login'

// Pages load on first visit so the sign-in screen and shell stay small
const Setup = lazy(() => import('./pages/Setup'))
const Dashboard = lazy(() => import('./pages/Dashboard'))
const Inventory = lazy(() => import('./pages/Inventory'))
const Locations = lazy(() => import('./pages/Locations'))
const Categories = lazy(() => import('./pages/Categories'))
const Alerts = lazy(() => import('./pages/Alerts'))
const Chat = lazy(() => import('./pages/Chat'))
const Calendar = lazy(() => import('./pages/Calendar'))
const Meals = lazy(() => import('./pages/Meals'))
const Recipes = lazy(() => import('./pages/Recipes'))
const Chores = lazy(() => import('./pages/Chores'))
const Settings = lazy(() => import('./pages/Settings'))
const Shopping = lazy(() => import('./pages/Shopping'))
const More = lazy(() => import('./pages/More'))
const Display = lazy(() => import('./pages/Display'))

function AppLayout() {
  const navigate = useNavigate()
  const { isAdmin } = useAuth()

  useEffect(() => {
    if (!isAdmin) return  // only admins run (or re-run) the setup wizard
    axios.get('/api/settings/setup/status')
      .then(r => { if (!r.data.setup_complete) navigate('/setup', { replace: true }) })
      .catch(() => {})
  }, [])

  return (
    <EmeraldChatProvider>
      <div className="flex h-app overflow-hidden bg-canvas">
        {/* Tablet and desktop: rail / sidebar */}
        <div className="hidden shrink-0 md:block">
          <Sidebar />
        </div>

        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          <MobileTopBar />
          <TopBar />
          <GroupSwitcher />
          <main className="min-w-0 flex-1 overflow-y-auto">
            <Suspense fallback={null}>
            <Routes>
              <Route path="/" element={<Dashboard />} />
              <Route path="/shopping" element={<Shopping />} />
              <Route path="/inventory" element={<Inventory />} />
              <Route path="/locations" element={<Locations />} />
              <Route path="/categories" element={<Categories />} />
              <Route path="/alerts" element={<Alerts />} />
              <Route path="/calendar" element={<Calendar />} />
              <Route path="/meals" element={<Meals />} />
              <Route path="/recipes/*" element={<Recipes />} />
              <Route path="/chores" element={<Chores />} />
              <Route path="/chat" element={<Chat />} />
              <Route path="/more" element={<More />} />
              <Route path="/settings" element={<Settings />} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
            </Suspense>
          </main>
          <BottomTabs />
        </div>

        <EmeraldPanel />
      </div>
    </EmeraldChatProvider>
  )
}

export default function App() {
  return (
    <MotionConfig reducedMotion="user">
      <AuthProvider>
        <Toaster
          position="top-center"
          toastOptions={{
            style: {
              background: 'rgb(var(--surface))',
              color: 'rgb(var(--ink))',
              border: '1px solid rgb(var(--line))',
              borderRadius: '12px',
              boxShadow: '0 12px 32px -8px rgb(var(--shadow) / 0.28)',
              fontSize: '15px',
            },
            success: { iconTheme: { primary: 'rgb(var(--action))', secondary: 'rgb(var(--surface))' } },
            error: { iconTheme: { primary: 'rgb(var(--danger))', secondary: 'rgb(var(--surface))' } },
          }}
        />
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/setup" element={
            <ProtectedRoute>
              <Suspense fallback={null}><Setup /></Suspense>
            </ProtectedRoute>
          } />
          <Route path="/display" element={
            <ProtectedRoute>
              <Suspense fallback={null}><Display /></Suspense>
            </ProtectedRoute>
          } />
          <Route path="/*" element={
            <ProtectedRoute>
              <AppLayout />
            </ProtectedRoute>
          } />
        </Routes>
      </AuthProvider>
    </MotionConfig>
  )
}
