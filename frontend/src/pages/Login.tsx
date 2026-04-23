import { useState, FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { motion } from 'framer-motion'
import { LogIn, Eye, EyeOff } from 'lucide-react'
import { useAuth } from '../hooks/useAuth'
import toast from 'react-hot-toast'

export default function Login() {
  const { login } = useAuth()
  const navigate = useNavigate()
  const [username, setUsername] = useState('admin')
  const [password, setPassword] = useState('')
  const [showPw, setShowPw] = useState(false)
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (!password) return
    setLoading(true)
    try {
      await login(username, password)
      navigate('/', { replace: true })
    } catch {
      toast.error('Incorrect username or password')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-surface flex items-center justify-center p-4">
      {/* Background glow */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-1/3 left-1/2 -translate-x-1/2 -translate-y-1/2 w-96 h-96 bg-accent/10 rounded-full blur-3xl" />
      </div>

      <motion.div
        initial={{ opacity: 0, y: 24 }}
        animate={{ opacity: 1, y: 0 }}
        className="relative w-full max-w-sm"
      >
        {/* Logo */}
        <div className="text-center mb-8">
          <div className="text-5xl mb-3">🏠</div>
          <h1 className="text-white text-2xl font-bold">HomeHub</h1>
          <p className="text-surface-muted text-sm mt-1">Sign in to your home inventory</p>
        </div>

        <form
          onSubmit={handleSubmit}
          className="bg-surface-card border border-surface-border rounded-2xl p-6 shadow-card space-y-4"
        >
          <div>
            <label className="text-xs text-surface-muted mb-1.5 block font-medium">Username</label>
            <input
              className="w-full bg-surface border border-surface-border rounded-xl px-4 py-3 text-white text-sm focus:outline-none focus:border-accent transition-colors"
              value={username}
              onChange={e => setUsername(e.target.value)}
              autoComplete="username"
              required
            />
          </div>

          <div>
            <label className="text-xs text-surface-muted mb-1.5 block font-medium">Password</label>
            <div className="relative">
              <input
                type={showPw ? 'text' : 'password'}
                className="w-full bg-surface border border-surface-border rounded-xl px-4 py-3 pr-11 text-white text-sm focus:outline-none focus:border-accent transition-colors"
                value={password}
                onChange={e => setPassword(e.target.value)}
                autoComplete="current-password"
                required
              />
              <button
                type="button"
                onClick={() => setShowPw(v => !v)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-surface-muted hover:text-white transition-colors"
              >
                {showPw ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
          </div>

          <button
            type="submit"
            disabled={loading || !password}
            className="w-full flex items-center justify-center gap-2 bg-accent hover:bg-accent-hover disabled:opacity-50 text-white font-medium py-3 rounded-xl transition-all shadow-glow text-sm"
          >
            {loading ? (
              <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
            ) : (
              <><LogIn size={16} /> Sign In</>
            )}
          </button>
        </form>

        <p className="text-center text-surface-muted text-xs mt-4">
          Default: <span className="text-white font-mono">admin</span> / <span className="text-white font-mono">homehub</span>
          <br />Change your password in Settings after signing in.
        </p>
      </motion.div>
    </div>
  )
}
