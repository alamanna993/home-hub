import { createContext, useContext, useState, useEffect, ReactNode } from 'react'
import axios from 'axios'

interface AuthState { username: string | null; token: string | null; role: string | null }
interface AuthContext extends AuthState {
  login: (username: string, password: string) => Promise<void>
  logout: () => void
  isAuthenticated: boolean
  isAdmin: boolean
}

const Ctx = createContext<AuthContext | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [auth, setAuth] = useState<AuthState>(() => ({
    token: localStorage.getItem('hh_token'),
    username: localStorage.getItem('hh_user'),
    role: localStorage.getItem('hh_role'),
  }))

  useEffect(() => {
    if (auth.token) {
      axios.defaults.headers.common['Authorization'] = `Bearer ${auth.token}`
    } else {
      delete axios.defaults.headers.common['Authorization']
    }
  }, [auth.token])

  async function login(username: string, password: string) {
    const form = new URLSearchParams()
    form.append('username', username)
    form.append('password', password)
    const { data } = await axios.post('/api/auth/login', form, {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    })
    localStorage.setItem('hh_token', data.access_token)
    localStorage.setItem('hh_user', data.username)
    localStorage.setItem('hh_role', data.role || 'admin')
    axios.defaults.headers.common['Authorization'] = `Bearer ${data.access_token}`
    setAuth({ token: data.access_token, username: data.username, role: data.role || 'admin' })
  }

  function logout() {
    localStorage.removeItem('hh_token')
    localStorage.removeItem('hh_user')
    localStorage.removeItem('hh_role')
    delete axios.defaults.headers.common['Authorization']
    setAuth({ token: null, username: null, role: null })
  }

  return (
    <Ctx.Provider value={{ ...auth, login, logout, isAuthenticated: !!auth.token, isAdmin: (auth.role || 'admin') === 'admin' }}>
      {children}
    </Ctx.Provider>
  )
}

export function useAuth() {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error('useAuth must be inside AuthProvider')
  return ctx
}
