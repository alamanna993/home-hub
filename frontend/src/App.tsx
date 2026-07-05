import { useEffect } from 'react'
import { Routes, Route, Navigate, useNavigate } from 'react-router-dom'
import { Toaster } from 'react-hot-toast'
import axios from 'axios'
import { AuthProvider, useAuth } from './hooks/useAuth'
import Setup from './pages/Setup'
import ProtectedRoute from './components/ProtectedRoute'
import Sidebar from './components/Sidebar'
import Login from './pages/Login'
import Dashboard from './pages/Dashboard'
import Inventory from './pages/Inventory'
import Locations from './pages/Locations'
import Categories from './pages/Categories'
import Alerts from './pages/Alerts'
import Chat from './pages/Chat'
import Calendar from './pages/Calendar'
import Meals from './pages/Meals'
import Chores from './pages/Chores'
import Settings from './pages/Settings'

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
    <div className="flex min-h-screen bg-surface">
      <Sidebar />
      <main className="flex-1 min-w-0 overflow-auto">
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/inventory" element={<Inventory />} />
          <Route path="/locations" element={<Locations />} />
          <Route path="/categories" element={<Categories />} />
          <Route path="/alerts" element={<Alerts />} />
          <Route path="/calendar" element={<Calendar />} />
          <Route path="/meals" element={<Meals />} />
          <Route path="/chores" element={<Chores />} />
          <Route path="/chat" element={<Chat />} />
          <Route path="/settings" element={<Settings />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
    </div>
  )
}

export default function App() {
  return (
    <AuthProvider>
      <Toaster
        position="bottom-right"
        toastOptions={{
          style: { background: '#1a1d27', color: '#fff', border: '1px solid #2a2d3a' },
        }}
      />
      <Routes>
        <Route path="/login" element={<Login />} />
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
  )
}
