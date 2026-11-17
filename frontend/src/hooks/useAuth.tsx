import { createContext, useContext, useState, useEffect, ReactNode } from 'react'
import axios from 'axios'
import { clearSession, resumeSession, storeSession, type SignedIn } from '../lib/session'

interface AuthState { username: string | null; token: string | null; role: string | null }
interface AuthContext extends AuthState {
  login: (username: string, password: string) => Promise<void>
  /** Signs this device out on the server too, so it can't come back from its cookie */
  logout: () => void
  isAuthenticated: boolean
  isAdmin: boolean
  /** False until the server has said whether this device is still signed in */
  ready: boolean
}

const Ctx = createContext<AuthContext | null>(null)

const fromStorage = (): AuthState => ({
  token: localStorage.getItem('hh_token'),
  username: localStorage.getItem('hh_user'),
  role: localStorage.getItem('hh_role'),
})

export function AuthProvider({ children }: { children: ReactNode }) {
  const [auth, setAuth] = useState<AuthState>(fromStorage)
  const [ready, setReady] = useState(false)

  useEffect(() => {
    if (auth.token) axios.defaults.headers.common['Authorization'] = `Bearer ${auth.token}`
    else delete axios.defaults.headers.common['Authorization']
  }, [auth.token])

  // Each start: a fresh token for this device. Brings back a sign-in whose storage was cleared,
  // moves old 7-day sign-ins onto a 6-month device session, and keeps the token's expiry current.
  useEffect(() => {
    resumeSession().then(r => {
      if (r === null) { clearSession(); setAuth({ token: null, username: null, role: null }) }
      else if (r !== 'offline') setAuth({ token: r.access_token, username: r.username, role: r.role || 'admin' })
      setReady(true)
    })
  }, [])

  async function login(username: string, password: string) {
    const form = new URLSearchParams()
    form.append('username', username)
    form.append('password', password)
    const { data } = await axios.post<SignedIn>('/api/auth/login', form, {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      withCredentials: true,
    })
    storeSession(data)
    setAuth({ token: data.access_token, username: data.username, role: data.role || 'admin' })
  }

  function logout() {
    const token = localStorage.getItem('hh_token')
    fetch('/api/auth/logout', {
      method: 'POST', credentials: 'same-origin', keepalive: true,
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    }).catch(() => {})
    clearSession()
    setAuth({ token: null, username: null, role: null })
  }

  return (
    <Ctx.Provider value={{ ...auth, login, logout, ready, isAuthenticated: !!auth.token, isAdmin: (auth.role || 'admin') === 'admin' }}>
      {children}
    </Ctx.Provider>
  )
}

export function useAuth() {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error('useAuth must be inside AuthProvider')
  return ctx
}
