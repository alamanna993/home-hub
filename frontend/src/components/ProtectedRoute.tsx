import { Navigate } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'

export default function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, ready } = useAuth()
  // A device with a stored sign-in can start right away; one without waits to hear whether its cookie still counts
  if (!ready && !isAuthenticated) return null
  return isAuthenticated ? <>{children}</> : <Navigate to="/login" replace />
}
