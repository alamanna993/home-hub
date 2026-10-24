import { ReactNode, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import axios from 'axios'
import toast from 'react-hot-toast'
import { ArrowLeft, ArrowRight, Check, CheckCircle2, XCircle } from 'lucide-react'
import { Button, Field, Input, Select } from '../components/ui'
import { EmeraldMark, HomeHubMark } from '../components/EmeraldMark'
import CodexAccount from '../components/CodexAccount'
import ModelSelect from '../components/ModelSelect'
import StoragePathInput from '../components/StoragePathInput'
import { errorText, testBrain } from '../lib/api'
import { cn } from '../lib/utils'

interface SetupStatus {
  setup_complete: boolean
  default_password_in_use: boolean
  data_path: string
  backup_path: string
  data_path_display: string
  backup_path_display: string
  env_file_writable: boolean
  llm_provider: string
  telegram_configured: boolean
}

interface ProviderField { key: string; label: string; placeholder?: string; model?: boolean; secret?: boolean }
const PROVIDERS: { value: string; label: string; sub: string; fields: ProviderField[] }[] = [
  { value: 'codex', label: 'Codex', sub: 'Uses your ChatGPT subscription. Smartest option.', fields: [] },
  { value: 'ollama', label: 'Ollama', sub: 'Free and private, runs on your own machine', fields: [
    { key: 'ollama_host', label: 'Server', placeholder: 'http://host.docker.internal:11434' },
    { key: 'ollama_model', label: 'Model', model: true },
  ]},
  { value: 'lmstudio', label: 'LM Studio', sub: 'Free and private, OpenAI-compatible server', fields: [
    { key: 'lmstudio_host', label: 'Server', placeholder: 'http://host.docker.internal:1234' },
    { key: 'lmstudio_model', label: 'Model', model: true },
  ]},
  { value: 'openai', label: 'OpenAI API', sub: 'Cloud, billed per use with an API key', fields: [
    { key: 'openai_api_key', label: 'API key', placeholder: 'sk-…', secret: true },
    { key: 'openai_model', label: 'Model', model: true },
  ]},
  { value: 'claude', label: 'Claude API', sub: 'Cloud, billed per use with an API key', fields: [
    { key: 'anthropic_api_key', label: 'API key', placeholder: 'sk-ant-…', secret: true },
    { key: 'claude_model', label: 'Model', model: true },
  ]},
  { value: 'none', label: 'No AI for now', sub: 'Everything else works. Turn Emerald on later.', fields: [] },
]

const STEPS = ['Welcome', 'Password', 'Storage', 'Emerald', 'Chat bots', 'Finish']

export default function Setup() {
  const navigate = useNavigate()
  const [step, setStep] = useState(0)
  const [status, setStatus] = useState<SetupStatus | null>(null)
  const [busy, setBusy] = useState(false)

  const [pw, setPw] = useState({ current: 'admin', next: '', confirm: '' })
  const [pwDone, setPwDone] = useState(false)

  const [dataPath, setDataPath] = useState('')
  const [backupPath, setBackupPath] = useState('')
  const [storageCmds, setStorageCmds] = useState<{ commands: string[]; note: string } | null>(null)

  const [provider, setProvider] = useState('codex')
  const [backup, setBackup] = useState('ollama')
  const [fields, setFields] = useState<Record<string, string>>({})
  const [testResult, setTestResult] = useState<{ ok: boolean; text: string } | null>(null)

  const [tgToken, setTgToken] = useState('')
  const [tgChats, setTgChats] = useState('')

  useEffect(() => {
    axios.get<SetupStatus>('/api/settings/setup/status').then(r => {
      setStatus(r.data)
      setProvider(r.data.llm_provider || 'codex')
      setDataPath(r.data.data_path || '')
      setBackupPath(r.data.backup_path || '')
      if (!r.data.default_password_in_use) setPwDone(true)
    }).catch(() => toast.error("Couldn't load the setup status"))
  }, [])

  const next = () => setStep(s => s + 1)
  const back = () => setStep(s => s - 1)

  async function savePassword() {
    if (pw.next !== pw.confirm) { toast.error("The passwords don't match"); return }
    if (pw.next.length < 6) { toast.error('Use at least 6 characters'); return }
    setBusy(true)
    try {
      await axios.post('/api/auth/change-password', { current_password: pw.current, new_password: pw.next })
      toast.success('Password set'); setPwDone(true); next()
    } catch (e) { toast.error(errorText(e, "Couldn't change the password")) } finally { setBusy(false) }
  }

  async function saveStorage() {
    setBusy(true)
    try {
      const { data } = await axios.post('/api/settings/storage', { data_path: dataPath.trim(), backup_path: backupPath.trim() })
      setStorageCmds({ commands: data.commands, note: data.note })
      toast.success('Storage folders saved to .env')
    } catch (e) { toast.error(errorText(e, "Couldn't save the folders")) } finally { setBusy(false) }
  }

  async function saveBrains() {
    await axios.patch('/api/settings/llm_provider', { value: provider })
    if (provider !== 'none') await axios.patch('/api/settings/llm_fallback_provider', { value: provider === 'codex' ? backup : 'none' })
    const keys = [...(PROVIDERS.find(p => p.value === provider)?.fields || []),
                  ...(provider === 'codex' ? PROVIDERS.find(p => p.value === backup)?.fields || [] : [])]
    for (const f of keys) {
      if (fields[f.key]) await axios.patch(`/api/settings/${f.key}`, { value: fields[f.key] })
    }
  }

  async function testPrimary() {
    setTestResult(null); setBusy(true)
    try {
      await saveBrains()
      const r = await testBrain('primary')
      setTestResult(r.ok ? { ok: true, text: `${r.label} replied: “${r.reply?.trim()}”` } : { ok: false, text: r.error || 'No reply' })
    } catch (e) { setTestResult({ ok: false, text: errorText(e) }) } finally { setBusy(false) }
  }

  async function saveBrainsAndNext() {
    setBusy(true)
    try { await saveBrains(); next() } catch (e) { toast.error(errorText(e)) } finally { setBusy(false) }
  }

  async function saveBots() {
    setBusy(true)
    try {
      if (tgToken.trim()) await axios.patch('/api/settings/telegram_bot_token', { value: tgToken.trim() })
      if (tgChats.trim()) await axios.patch('/api/settings/telegram_allowed_chat_ids', { value: tgChats.trim() })
      if (tgToken.trim()) toast.success('Saved. The Telegram bot picks it up within 30 seconds.')
      next()
    } catch (e) { toast.error(errorText(e)) } finally { setBusy(false) }
  }

  async function finish() {
    setBusy(true)
    try {
      await axios.post('/api/settings/setup/complete')
      navigate('/', { replace: true })
    } catch (e) { toast.error(errorText(e)) } finally { setBusy(false) }
  }

  const providerFields = (p: string) => (PROVIDERS.find(x => x.value === p)?.fields || []).map(f => (
    <Field key={f.key} label={f.label}>
      {f.model
        ? <div><ModelSelect provider={p} value={fields[f.key] ?? ''} onChange={v => setFields(s => ({ ...s, [f.key]: v }))} /></div>
        : <Input type={f.secret ? 'password' : 'text'} autoComplete="off" placeholder={f.placeholder} value={fields[f.key] ?? ''}
            onChange={e => setFields(s => ({ ...s, [f.key]: e.target.value }))} />}
    </Field>
  ))

  return (
    <div className="flex min-h-app items-start justify-center bg-canvas px-4 py-8 lg:items-center">
      <div className="grid w-full max-w-4xl overflow-hidden rounded-panel border border-line bg-surface lg:grid-cols-[220px_1fr]">
        {/* Steps */}
        <aside className="border-b border-line bg-canvas/60 p-5 lg:border-b-0 lg:border-r">
          <div className="mb-6 flex items-center gap-2.5">
            <HomeHubMark size={28} />
            <span className="font-semibold text-ink">HomeHub setup</span>
          </div>
          <ol className="flex gap-3 overflow-x-auto lg:flex-col lg:gap-1" aria-label="Setup steps">
            {STEPS.map((s, i) => (
              <li key={s} aria-current={i === step ? 'step' : undefined}
                className={cn('flex shrink-0 items-center gap-2.5 text-sm lg:h-8', i === step ? 'font-medium text-ink' : 'text-muted')}>
                <span className={cn('flex h-6 w-6 items-center justify-center rounded-full border text-xs tnum',
                  i < step ? 'border-action bg-action text-action-on' : i === step ? 'border-action text-action' : 'border-line')}>
                  {i < step ? <Check size={13} strokeWidth={3} aria-hidden /> : i + 1}
                </span>
                <span className={cn(i !== step && 'hidden lg:inline')}>{s}</span>
              </li>
            ))}
          </ol>
        </aside>

        <section className="p-6 lg:p-8">
          {step === 0 && (
            <Step title="Welcome to HomeHub"
              intro="A few minutes of setup: secure your login, check where the data lives, connect Emerald (your family assistant), and optionally hook up Telegram."
              actions={<Button variant="primary" icon={ArrowRight} onClick={next}>Get started</Button>} />
          )}

          {step === 1 && (
            <Step title="Secure your login" onBack={back}
              intro={pwDone ? undefined : "You're signed in with the default password. Choose a real one before anything else."}
              actions={pwDone
                ? <Button variant="primary" onClick={next}>Next</Button>
                : <Button variant="primary" loading={busy} disabled={!pw.next || !pw.confirm} onClick={savePassword}>Set password</Button>}>
              {pwDone ? (
                <p className="flex items-center gap-2 text-sm text-ink"><CheckCircle2 size={16} className="text-action" /> Your password is already set.</p>
              ) : (
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label="New password" hint="6 or more characters">
                    <Input type="password" autoComplete="new-password" value={pw.next} onChange={e => setPw(f => ({ ...f, next: e.target.value }))} />
                  </Field>
                  <Field label="Confirm new password">
                    <Input type="password" autoComplete="new-password" value={pw.confirm} onChange={e => setPw(f => ({ ...f, confirm: e.target.value }))} />
                  </Field>
                </div>
              )}
            </Step>
          )}

          {step === 2 && (
            <Step title="Where your data lives" onBack={back}
              intro={status?.env_file_writable
                ? 'Choose folders for the database and its nightly backups, or keep the defaults. Put backups on a different disk so one drive failure can’t take both.'
                : undefined}
              actions={<Button variant="primary" onClick={next}>{storageCmds || !status?.env_file_writable ? 'Next' : 'Keep defaults'}</Button>}>
              {status?.env_file_writable ? (
                <div className="space-y-3">
                  <StoragePathInput label="Database folder" kind="data" placeholder={status.data_path_display} value={dataPath}
                    onChange={v => { setDataPath(v); setStorageCmds(null) }} />
                  <StoragePathInput label="Backup folder" kind="backup" placeholder={status.backup_path_display} value={backupPath}
                    onChange={v => { setBackupPath(v); setStorageCmds(null) }} />
                  {(dataPath.trim() !== (status.data_path || '') || backupPath.trim() !== (status.backup_path || '')) && !storageCmds && (
                    <Button loading={busy} onClick={saveStorage}>Save folders</Button>
                  )}
                  {storageCmds && (
                    <div className="space-y-2 rounded-control border border-warn/30 bg-warn/[0.06] p-3">
                      <p className="text-ui font-medium text-warn">Saved. It takes effect after a restart. Run this on the Docker host:</p>
                      <pre className="whitespace-pre-wrap break-all rounded bg-ink/[0.06] p-2 text-xs text-ink">{storageCmds.commands.join('\n')}</pre>
                      <p className="text-xs text-muted">{storageCmds.note}</p>
                    </div>
                  )}
                </div>
              ) : (
                <dl className="grid gap-2 text-sm sm:grid-cols-[9rem_1fr]">
                  <dt className="text-muted">Database</dt><dd className="break-all text-ink">{status?.data_path_display}</dd>
                  <dt className="text-muted">Nightly backups</dt><dd className="break-all text-ink">{status?.backup_path_display}</dd>
                  <dd className="text-ui text-muted sm:col-span-2">To change these, set DATA_PATH and BACKUP_PATH in .env and run docker compose up -d.</dd>
                </dl>
              )}
            </Step>
          )}

          {step === 3 && (
            <Step title={<span className="flex items-center gap-2"><EmeraldMark size={22} className="text-emerald" />Connect Emerald</span>} onBack={back}
              intro="Emerald answers family questions, files what you bought, plans meals, and runs the Telegram bot. Pick its brain."
              actions={<Button variant="primary" loading={busy} onClick={saveBrainsAndNext}>{provider === 'none' ? 'Skip for now' : 'Save and continue'}</Button>}>
              <div className="space-y-5">
                <fieldset>
                  <legend className="mb-2 text-ui font-medium text-ink">Primary brain</legend>
                  <div className="grid gap-2 sm:grid-cols-2">
                    {PROVIDERS.map(p => (
                      <label key={p.value} className={cn('flex cursor-pointer gap-3 rounded-control border px-3 py-2.5 transition-colors',
                        provider === p.value ? 'border-action bg-action/[0.06]' : 'border-line hover:border-muted/50')}>
                        <input type="radio" name="provider" value={p.value} checked={provider === p.value}
                          onChange={() => { setProvider(p.value); setTestResult(null) }} className="mt-1 accent-[rgb(var(--action))]" />
                        <span>
                          <span className="block text-sm font-medium text-ink">
                            {p.label}{p.value === 'codex' && <span className="ml-1.5 text-xs font-normal text-emerald">Recommended</span>}
                          </span>
                          <span className="block text-ui text-muted">{p.sub}</span>
                        </span>
                      </label>
                    ))}
                  </div>
                </fieldset>

                {provider === 'codex' ? (
                  <>
                    <CodexAccount onChange={() => setTestResult(null)} />
                    <div className="space-y-3 border-t border-line pt-4">
                      <Field label="Backup brain" hint="Answers whenever Codex can't, such as before it's connected.">
                        <Select value={backup} onChange={e => setBackup(e.target.value)}>
                          {PROVIDERS.filter(p => !['codex', 'none'].includes(p.value)).map(p => <option key={p.value} value={p.value}>{p.label}</option>)}
                          <option value="none">No backup</option>
                        </Select>
                      </Field>
                      {providerFields(backup)}
                    </div>
                  </>
                ) : provider === 'none' ? (
                  <p className="text-ui text-muted">Inventory, calendar, meals, recipes, and chores all work without AI. Simple lookups like “where is my drill” still work in chat.</p>
                ) : (
                  <div className="space-y-3">{providerFields(provider)}</div>
                )}

                {provider !== 'none' && (
                  <div className="flex flex-wrap items-center gap-3">
                    <Button loading={busy} onClick={testPrimary}>Test the primary brain</Button>
                    {testResult && (
                      <p className={cn('flex items-start gap-1.5 text-ui', testResult.ok ? 'text-ink' : 'text-danger')} role="status">
                        {testResult.ok ? <CheckCircle2 size={15} className="mt-0.5 shrink-0 text-action" /> : <XCircle size={15} className="mt-0.5 shrink-0" />}
                        <span className="break-words">{testResult.text}</span>
                      </p>
                    )}
                  </div>
                )}
              </div>
            </Step>
          )}

          {step === 4 && (
            <Step title="Chat bots (optional)" onBack={back}
              intro="Message Emerald from anywhere. “Just bought 2 gallons of milk” from the store updates the inventory. Get a Telegram token from @BotFather by sending it /newbot."
              actions={<Button variant="primary" loading={busy} onClick={saveBots}>{tgToken.trim() ? 'Save and continue' : 'Skip for now'}</Button>}>
              <div className="space-y-3">
                <Field label="Telegram bot token"><Input type="password" autoComplete="off" placeholder="123456:ABC-DEF…" value={tgToken} onChange={e => setTgToken(e.target.value)} /></Field>
                <Field label="Allowed chat IDs" hint="Send /start to your bot to see your ID. Separate family members with commas.">
                  <Input value={tgChats} onChange={e => setTgChats(e.target.value)} />
                </Field>
              </div>
            </Step>
          )}

          {step === 5 && (
            <Step title="You're all set"
              intro="Add your rooms in Locations, start an inventory, save a few recipes, and try asking Emerald what you can make for dinner tonight."
              actions={<Button variant="primary" icon={Check} loading={busy} onClick={finish}>Open HomeHub</Button>} />
          )}
        </section>
      </div>
    </div>
  )
}

function Step({ title, intro, children, actions, onBack }: {
  title: ReactNode; intro?: ReactNode; children?: ReactNode; actions: ReactNode; onBack?: () => void
}) {
  return (
    <div className="flex min-h-[22rem] flex-col">
      <h1 className="text-2xl font-semibold text-ink">{title}</h1>
      {intro && <p className="mt-2 max-w-[60ch] text-sm text-muted">{intro}</p>}
      {children && <div className="mt-6">{children}</div>}
      <div className="mt-auto flex items-center justify-between gap-2 pt-8">
        {onBack ? <Button variant="ghost" icon={ArrowLeft} onClick={onBack}>Back</Button> : <span />}
        {actions}
      </div>
    </div>
  )
}
