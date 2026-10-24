import { useEffect, useState } from 'react'
import { Routes, Route, Navigate, useNavigate, useLocation } from 'react-router-dom'
import { Toaster } from 'react-hot-toast'
import { motion, AnimatePresence, MotionConfig } from 'framer-motion'
import axios from 'axios'
import { AuthProvider, useAuth } from './hooks/useAuth'
import { EmeraldChatProvider } from './hooks/useEmeraldChat'
import Setup from './pages/Setup'
import ProtectedRoute from './components/ProtectedRoute'
import Sidebar from './components/Sidebar'
import TopBar from './components/TopBar'
import MobileTopBar from './components/MobileTopBar'
import EmeraldPanel from './components/EmeraldPanel'
import Login from './pages/Login'
import Dashboard from './pages/Dashboard'
import Inventory from './pages/Inventory'
import Locations from './pages/Locations'
import Categories from './pages/Categories'
import Alerts from './pages/Alerts'
import Chat from './pages/Chat'
import Calendar from './pages/Calendar'
import Meals from './pages/Meals'
import Recipes from './pages/Recipes'
import Chores from './pages/Chores'
import Settings from './pages/Settings'

function AppLayout() {
  const navigate = useNavigate()
  const location = useLocation()
  const { isAdmin } = useAuth()
  const [drawerOpen, setDrawerOpen] = useState(false)

  useEffect(() => {
    if (!isAdmin) return  // only admins run (or re-run) the setup wizard
    axios.get('/api/settings/setup/status')
      .then(r => { if (!r.data.setup_complete) navigate('/setup', { replace: true }) })
      .catch(() => {})
  }, [])

  // Safety net: any navigation closes the drawer (covers programmatic ones like logout)
  useEffect(() => { setDrawerOpen(false) }, [location.pathname])

  return (
    <EmeraldChatProvider>
      <div className="flex h-app overflow-hidden bg-canvas">
        {/* Desktop sidebar */}
        <div className="hidden lg:block shrink-0">
          <Sidebar />
        </div>

        {/* Mobile drawer */}
        <AnimatePresence>
          {drawerOpen && (
            <>
              <motion.div
                key="backdrop"
                className="fixed inset-0 z-40 bg-ink/40 dark:bg-black/60 lg:hidden"
                initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                onClick={() => setDrawerOpen(false)}
              />
              <motion.div
                key="drawer"
                className="fixed inset-y-0 left-0 z-50 shadow-overlay lg:hidden"
                initial={{ x: '-100%' }} animate={{ x: 0 }} exit={{ x: '-100%' }}
                transition={{ type: 'tween', duration: 0.2, ease: 'easeOut' }}
              >
                <Sidebar onNavigate={() => setDrawerOpen(false)} />
              </motion.div>
            </>
          )}
        </AnimatePresence>

        <div className="flex-1 min-w-0 flex flex-col min-h-0">
          <MobileTopBar onMenu={() => setDrawerOpen(true)} />
          <TopBar />
          {/* `legacy` keeps not-yet-rebuilt pages readable in light mode (see index.css) */}
          <main className="legacy flex-1 min-w-0 overflow-y-auto">
            <Routes>
              <Route path="/" element={<Dashboard />} />
              <Route path="/inventory" element={<Inventory />} />
              <Route path="/locations" element={<Locations />} />
              <Route path="/categories" element={<Categories />} />
              <Route path="/alerts" element={<Alerts />} />
              <Route path="/calendar" element={<Calendar />} />
              <Route path="/meals" element={<Meals />} />
              <Route path="/recipes/*" element={<Recipes />} />
              <Route path="/chores" element={<Chores />} />
              <Route path="/chat" element={<Chat />} />
              <Route path="/settings" element={<Settings />} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </main>
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
          position="bottom-right"
          toastOptions={{
            style: {
              background: 'rgb(var(--surface))',
              color: 'rgb(var(--ink))',
              border: '1px solid rgb(var(--line))',
              borderRadius: '10px',
              boxShadow: '0 12px 32px -8px rgb(var(--shadow) / 0.28)',
              fontSize: '14px',
            },
            success: { iconTheme: { primary: 'rgb(var(--action))', secondary: 'rgb(var(--surface))' } },
            error: { iconTheme: { primary: 'rgb(var(--danger))', secondary: 'rgb(var(--surface))' } },
          }}
        />
        <Routes>
          <Route path="/login" element={<div className="legacy"><Login /></div>} />
          <Route path="/setup" element={
            <ProtectedRoute>
              <Setup />
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
