import { useEffect, useState } from 'react'
import toast from 'react-hot-toast'
import { Check, Copy, ExternalLink, LogOut } from 'lucide-react'
import { Badge, Button, ConfirmDialog, IconButton } from './ui'
import { codexLogout, errorText, getCodexLogin, startCodexLogin, type CodexLogin } from '../lib/api'

/** ChatGPT device-code sign-in for the Codex CLI running on the server */
export default function CodexAccount({ onChange }: { onChange: () => void }) {
  const [login, setLogin] = useState<CodexLogin | null>(null)
  const [busy, setBusy] = useState(false)
  const [confirmOut, setConfirmOut] = useState(false)

  useEffect(() => { getCodexLogin().then(setLogin).catch(() => {}) }, [])

  // While a code is showing, poll until the sign-in completes
  useEffect(() => {
    if (login?.status !== 'pending') return
    const t = setInterval(async () => {
      try {
        const next = await getCodexLogin()
        setLogin(next)
        if (next.signed_in) { toast.success('Codex is connected. Emerald will use it from now on.'); onChange() }
      } catch { /* keep polling */ }
    }, 3000)
    return () => clearInterval(t)
  }, [login?.status])

  async function start() {
    setBusy(true)
    try {
      const l = await startCodexLogin()
      setLogin(l)
      if (l.status === 'error') toast.error(l.error || "Codex didn't start the sign-in")
    } catch (e) { toast.error(errorText(e)) } finally { setBusy(false) }
  }

  if (!login) return null
  if (login.signed_in) {
    return (
      <div className="flex flex-wrap items-center gap-3 rounded-control border border-line px-3 py-2.5">
        <Badge tone="emerald" icon={Check}>Connected</Badge>
        <span className="flex-1 text-sm text-ink">{login.detail || 'Signed in with ChatGPT'}</span>
        <Button size="sm" variant="ghost" icon={LogOut} onClick={() => setConfirmOut(true)}>Sign out</Button>
        <ConfirmDialog open={confirmOut} onClose={() => setConfirmOut(false)}
          title="Sign Codex out?" confirmLabel="Sign out"
          description="Emerald switches to the backup brain until you connect Codex again."
          onConfirm={async () => { setLogin({ ...(await getCodexLogin()), ...(await codexLogout()) }); onChange() }} />
      </div>
    )
  }
  if (login.status === 'pending' && login.url && login.code) {
    const minutesLeft = login.expires_at ? Math.max(0, Math.round((login.expires_at * 1000 - Date.now()) / 60000)) : null
    return (
      <div className="rounded-control border border-emerald/40 bg-emerald/[0.05] p-4">
        <ol className="space-y-3 text-sm text-ink">
          <li>
            <span className="text-muted">1.</span> Open{' '}
            <a href={login.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-medium text-action hover:underline">
              {login.url.replace(/^https:\/\//, '')} <ExternalLink size={12} aria-hidden />
            </a>{' '}and sign in with the family's ChatGPT account.
          </li>
          <li>
            <span className="text-muted">2.</span> Enter this code:
            <div className="mt-2 flex items-center gap-2">
              <span className="rounded-control border border-line bg-surface px-3 py-1.5 text-2xl font-semibold tracking-[0.12em] text-ink tnum">{login.code}</span>
              <IconButton icon={Copy} label="Copy code" onClick={() => { navigator.clipboard?.writeText(login.code!); toast.success('Code copied') }} />
            </div>
          </li>
        </ol>
        <p className="mt-3 text-ui text-muted">
          Waiting for you to finish{minutesLeft !== null ? `. The code expires in ${minutesLeft} min` : ''}.
          If ChatGPT says device sign-in is off, turn on device code sign-in for Codex in ChatGPT's security settings, then start again.
        </p>
      </div>
    )
  }
  return (
    <div className="flex flex-col gap-3 rounded-control border border-line px-3 py-3 sm:flex-row sm:items-center">
      <div className="flex-1">
        <p className="text-sm font-medium text-ink">Codex isn't connected</p>
        <p className="text-ui text-muted">
          {login.status === 'error' && login.error ? login.error : "Sign in once with your ChatGPT account. It's used by HomeHub's server, not this browser."}
        </p>
      </div>
      <Button variant="primary" loading={busy} onClick={start}>Connect ChatGPT</Button>
    </div>
  )
}
