import { useState, FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { Eye, EyeOff } from 'lucide-react'
import { useAuth } from '../hooks/useAuth'
import { Button, Field, IconButton, Input } from '../components/ui'
import { HomeHubMark } from '../components/EmeraldMark'

export default function Login() {
  const { login } = useAuth()
  const navigate = useNavigate()
  const [username, setUsername] = useState('admin')
  const [password, setPassword] = useState('')
  const [showPw, setShowPw] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (!password) return
    setLoading(true); setError(null)
    try {
      await login(username, password)
      navigate('/', { replace: true })
    } catch {
      setError('That username and password don’t match. Check them and try again.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex min-h-app items-center justify-center bg-canvas px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex items-center gap-3">
          <HomeHubMark size={36} />
          <div>
            <h1 className="text-xl font-semibold text-ink">HomeHub</h1>
            <p className="text-ui text-muted">Sign in to your family's home</p>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4 rounded-panel border border-line bg-surface p-6">
          <Field label="Username">
            <Input value={username} onChange={e => setUsername(e.target.value)} autoComplete="username" />
          </Field>
          <Field label="Password" error={error}>
            <div className="relative">
              <Input type={showPw ? 'text' : 'password'} value={password} onChange={e => setPassword(e.target.value)}
                autoComplete="current-password" className="pr-10" autoFocus />
              <IconButton icon={showPw ? EyeOff : Eye} label={showPw ? 'Hide password' : 'Show password'} size="sm"
                onClick={() => setShowPw(v => !v)} className="absolute right-0.5 top-1/2 -translate-y-1/2" />
            </div>
          </Field>
          <Button type="submit" variant="primary" loading={loading} disabled={!password} className="w-full">Sign in</Button>
        </form>

        <p className="mt-4 text-ui text-muted">
          First time here? Sign in with admin and the password admin, and setup walks you through the rest.
        </p>
      </div>
    </div>
  )
}
