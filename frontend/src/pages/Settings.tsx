import { ReactNode, useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import axios from 'axios'
import toast from 'react-hot-toast'
import {
  CalendarSync, Check, Copy, Database, Download, Eye, EyeOff, Plus, Send,
  SlidersHorizontal, Trash2, Users, Wrench,
} from 'lucide-react'
import {
  Badge, Button, ConfirmDialog, Field, IconButton, Input, Page, PageHeader, Panel, Select, Tabs,
} from '../components/ui'
import { EmeraldMark } from '../components/EmeraldMark'
import CodexAccount from '../components/CodexAccount'
import ModelSelect from '../components/ModelSelect'
import StoragePathInput from '../components/StoragePathInput'
import { useAuth } from '../hooks/useAuth'
import { useBrainStatus } from '../hooks/useBrainStatus'
import {
  createUser, deleteUser, errorText, getUsers, testBrain,
  type AppUser, type Brain,
} from '../lib/api'
import { cn } from '../lib/utils'

// ---------------------------------------------------------------------------
// Settings data: one list from GET /settings/, saved field by field
// ---------------------------------------------------------------------------
interface Setting { key: string; value: string; description: string; secret: boolean; is_set: boolean }

function useSettings() {
  const [settings, setSettings] = useState<Record<string, Setting>>({})
  const load = () => axios.get<Setting[]>('/api/settings/')
    .then(r => setSettings(Object.fromEntries(r.data.map(s => [s.key, s])))).catch(() => {})
  useEffect(() => { load() }, [])
  async function save(key: string, value: string, quiet = false) {
    await axios.patch(`/api/settings/${key}`, { value })
    if (!quiet) toast.success('Saved')
    await load()
  }
  return { settings, save, reload: load }
}
type SettingsApi = ReturnType<typeof useSettings>

/** One setting with its own Save button. Secrets never come back from the server. */
function SettingField({ api, k, label, placeholder, hint, children }: {
  api: SettingsApi; k: string; label: string; placeholder?: string
  /** Defaults to the server's description; false hides it */
  hint?: ReactNode | false
  /** Custom control; receives the draft value and a setter */
  children?: (value: string, set: (v: string) => void) => ReactNode
}) {
  const s = api.settings[k]
  const [draft, setDraft] = useState<string | null>(null)
  const [reveal, setReveal] = useState(false)
  const [saving, setSaving] = useState(false)
  if (!s) return null
  const value = draft ?? (s.secret ? '' : s.value || '')
  const dirty = draft !== null && (s.secret ? draft !== '' : draft !== (s.value || ''))
  const shownHint = hint === undefined ? s.description : hint || undefined

  async function save() {
    setSaving(true)
    try { await api.save(k, value); setDraft(null) } catch (e) { toast.error(errorText(e, "Couldn't save")) } finally { setSaving(false) }
  }

  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
      <Field className="flex-1" label={<span className="flex items-center gap-2">{label}{s.secret && s.is_set && <Badge>Saved</Badge>}</span>}
        hint={shownHint}>
        {children ? (
          <div>{children(value, v => setDraft(v))}</div>
        ) : s.secret ? (
          <div className="relative">
            <Input type={reveal ? 'text' : 'password'} value={value} onChange={e => setDraft(e.target.value)}
              placeholder={s.is_set ? 'Leave blank to keep the saved value' : placeholder} className="pr-10" autoComplete="off" />
            <IconButton icon={reveal ? EyeOff : Eye} label={reveal ? 'Hide' : 'Show'} size="sm" onClick={() => setReveal(!reveal)}
              className="absolute right-0.5 top-1/2 -translate-y-1/2" />
          </div>
        ) : (
          <Input value={value} onChange={e => setDraft(e.target.value)} placeholder={placeholder} />
        )}
      </Field>
      <Button onClick={save} loading={saving} disabled={!dirty} className={shownHint ? 'sm:mb-[22px]' : undefined}>Save</Button>
    </div>
  )
}

// ---------------------------------------------------------------------------
const SECTIONS = [
  { id: 'emerald', label: 'Emerald', icon: null },
  { id: 'general', label: 'General', icon: SlidersHorizontal },
  { id: 'calendars', label: 'Calendars', icon: CalendarSync },
  { id: 'bots', label: 'Chat bots', icon: Send },
  { id: 'storage', label: 'Storage and backups', icon: Database },
  { id: 'logins', label: 'Logins', icon: Users },
  { id: 'maintenance', label: 'Maintenance', icon: Wrench },
] as const
type SectionId = typeof SECTIONS[number]['id']

export default function Settings() {
  const { username } = useAuth()
  const [params, setParams] = useSearchParams()
  const section = (SECTIONS.find(s => s.id === params.get('section'))?.id ?? 'emerald') as SectionId
  const api = useSettings()
  const go = (id: SectionId) => setParams(id === 'emerald' ? {} : { section: id }, { replace: true })

  return (
    <Page>
      <PageHeader title="Settings" description={`Signed in as ${username}. Only admins can open this page.`} />
      <div className="grid gap-6 lg:grid-cols-[200px_1fr]">
        {/* Section nav: list on desktop, tabs on phones */}
        <nav aria-label="Settings sections" className="hidden lg:block">
          <ul className="sticky top-4 space-y-0.5">
            {SECTIONS.map(s => (
              <li key={s.id}>
                <button type="button" onClick={() => go(s.id)} aria-current={section === s.id ? 'page' : undefined}
                  className={cn('flex h-9 w-full items-center gap-2.5 rounded-control px-2.5 text-sm transition-colors',
                    section === s.id ? 'bg-ink/[0.07] font-medium text-ink' : 'text-muted hover:bg-ink/[0.04] hover:text-ink')}>
                  {s.icon ? <s.icon size={16} aria-hidden /> : <EmeraldMark size={16} className="text-emerald" />}
                  {s.label}
                </button>
              </li>
            ))}
          </ul>
        </nav>
        <Tabs className="lg:hidden" label="Settings sections" value={section} onChange={go}
          tabs={SECTIONS.map(s => ({ id: s.id, label: s.label }))} />

        <div className="min-w-0 max-w-3xl space-y-5">
          {section === 'emerald' && <EmeraldSection api={api} />}
          {section === 'general' && (
            <Panel title="General">
              <SettingField api={api} k="site_title" label="App name" placeholder="HomeHub" />
            </Panel>
          )}
          {section === 'calendars' && <>
            <MicrosoftSection />
            <InboundFeedsSection />
            <CalendarFeedSection />
          </>}
          {section === 'bots' && <>
            <Panel title="Telegram" description="Family members message Emerald from Telegram.">
              <div className="space-y-4">
                <SettingField api={api} k="telegram_bot_token" label="Bot token" placeholder="From @BotFather" />
                <SettingField api={api} k="telegram_allowed_chat_ids" label="Allowed chat IDs" placeholder="12345678, 87654321" />
              </div>
            </Panel>
            <Panel title="Discord" description="Optional. Runs only when the discord profile is enabled in Docker.">
              <div className="space-y-4">
                <SettingField api={api} k="discord_token" label="Bot token" />
                <SettingField api={api} k="discord_channel_id" label="Channel ID" />
                <SettingField api={api} k="low_stock_alert_channel" label="Low-stock alert channel ID" />
              </div>
            </Panel>
            <p className="text-ui text-muted">
              A newly saved token is picked up within about 30 seconds. Changing an existing token needs a bot restart:{' '}
              <code className="rounded bg-ink/[0.06] px-1 py-0.5 text-xs">docker compose restart telegram</code>
            </p>
          </>}
          {section === 'storage' && <StorageSection />}
          {section === 'logins' && <><UsersSection /><PasswordSection /></>}
          {section === 'maintenance' && <MaintenanceSection />}
        </div>
      </div>
    </Page>
  )
}

// ---------------------------------------------------------------------------
// Emerald: primary brain (Codex) + backup brain
// ---------------------------------------------------------------------------
const PRIMARY_OPTIONS = [
  { value: 'codex', label: 'Codex (ChatGPT subscription)' },
  { value: 'ollama', label: 'Ollama (local)' },
  { value: 'lmstudio', label: 'LM Studio (local)' },
  { value: 'openai', label: 'OpenAI API' },
  { value: 'claude', label: 'Claude API' },
  { value: 'none', label: 'Off (no AI)' },
]
const BACKUP_OPTIONS = [
  { value: 'ollama', label: 'Ollama (local)' },
  { value: 'lmstudio', label: 'LM Studio (local)' },
  { value: 'openai', label: 'OpenAI API' },
  { value: 'claude', label: 'Claude API' },
  { value: 'none', label: 'No backup' },
]
const PROVIDER_FIELDS: Record<string, { key: string; label: string; model?: boolean; placeholder?: string }[]> = {
  ollama: [{ key: 'ollama_host', label: 'Ollama server', placeholder: 'http://host.docker.internal:11434' },
           { key: 'ollama_model', label: 'Model', model: true }],
  lmstudio: [{ key: 'lmstudio_host', label: 'LM Studio server', placeholder: 'http://host.docker.internal:1234' },
             { key: 'lmstudio_model', label: 'Model', model: true }],
  openai: [{ key: 'openai_api_key', label: 'API key', placeholder: 'sk-…' }, { key: 'openai_model', label: 'Model', model: true }],
  claude: [{ key: 'anthropic_api_key', label: 'API key', placeholder: 'sk-ant-…' }, { key: 'claude_model', label: 'Model', model: true }],
}

function EmeraldSection({ api }: { api: SettingsApi }) {
  const brain = useBrainStatus()
  const primary = api.settings.llm_provider?.value || 'codex'
  const backup = api.settings.llm_fallback_provider?.value || 'ollama'
  const [modelRefresh, setModelRefresh] = useState(0)

  async function choose(key: 'llm_provider' | 'llm_fallback_provider', value: string, label: string) {
    try {
      await api.save(key, value, true)
      toast.success(`${key === 'llm_provider' ? 'Primary' : 'Backup'} brain: ${label}`)
      brain.refresh()
    } catch (e) { toast.error(errorText(e)) }
  }

  const status = brain.status
  const p = status?.primary, b = status?.backup
  let headline: ReactNode = 'Checking which brain is answering…'
  if (status) {
    if (!p) headline = 'Emerald is off. Choose a primary brain to turn it on.'
    else if (status.active === 'primary') headline = <>Emerald is answering with <b className="font-semibold">{p.label}</b>.</>
    else if (status.active === 'backup' && b) headline = <>{p.label} is unavailable, so the backup, <b className="font-semibold">{b.label}</b>, is answering.</>
    else headline = 'Neither brain is reachable right now. Emerald can only do simple lookups.'
  }

  return (
    <>
      <section className="flex items-start gap-3 rounded-panel border border-emerald/30 bg-emerald/[0.06] p-4">
        <EmeraldMark size={24} className="mt-0.5 text-emerald" />
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-ink">Emerald, your family assistant</h2>
          <p className="mt-0.5 text-sm text-ink/90">{headline}</p>
          <p className="mt-1 text-ui text-muted">
            Every message goes to the primary brain first. If it fails or isn't signed in, the backup answers instead,
            and the primary is skipped for 5 minutes before it's tried again.
          </p>
        </div>
      </section>

      <Panel title="Primary brain" actions={<BrainTest target="primary" onDone={brain.refresh} />}>
        <div className="space-y-4">
          <Field label="Provider">
            <Select value={primary} onChange={e => choose('llm_provider', e.target.value,
              PRIMARY_OPTIONS.find(o => o.value === e.target.value)?.label || e.target.value)}>
              {PRIMARY_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </Select>
          </Field>
          <BrainHealth brain={p} />
          {primary === 'codex' ? (
            <>
              <CodexAccount onChange={brain.refresh} />
              <SettingField api={api} k="codex_model" label="Codex model" hint={false}>
                {(v, set) => <ModelSelect provider="codex" value={v} onChange={set} placeholder="Leave blank for Codex's default" />}
              </SettingField>
              <SettingField api={api} k="codex_reasoning_effort" label="Thinking effort" hint={false}>
                {(v, set) => (
                  <Select value={v || 'low'} onChange={e => set(e.target.value)}>
                    <option value="low">Low: fastest replies (recommended)</option>
                    <option value="medium">Medium</option>
                    <option value="high">High: slowest, most careful</option>
                  </Select>
                )}
              </SettingField>
            </>
          ) : (
            <ProviderFields api={api} provider={primary} modelRefresh={modelRefresh} />
          )}
        </div>
      </Panel>

      <Panel title="Backup brain" description="Answers whenever the primary can't." actions={backup !== 'none' && <BrainTest target="backup" onDone={brain.refresh} />}>
        <div className="space-y-4">
          <Field label="Provider">
            <Select value={backup} onChange={e => choose('llm_fallback_provider', e.target.value,
              BACKUP_OPTIONS.find(o => o.value === e.target.value)?.label || e.target.value)}>
              {BACKUP_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </Select>
          </Field>
          {backup !== 'none' && <BrainHealth brain={b} />}
          {backup === primary && backup !== 'none' && (
            <p className="text-ui text-warn">The backup is the same as the primary, so there's no fallback. Pick a different one.</p>
          )}
          {backup !== primary && <ProviderFields api={api} provider={backup} modelRefresh={modelRefresh} />}
          {(backup === 'ollama' || primary === 'ollama') && <OllamaPullSection onPulled={() => setModelRefresh(n => n + 1)} />}
        </div>
      </Panel>
    </>
  )
}

function ProviderFields({ api, provider, modelRefresh }: { api: SettingsApi; provider: string; modelRefresh: number }) {
  return (
    <>
      {(PROVIDER_FIELDS[provider] || []).map(f => f.model ? (
        <SettingField key={f.key} api={api} k={f.key} label={f.label}>
          {(v, set) => <ModelSelect provider={provider} value={v} onChange={set} refreshKey={modelRefresh} />}
        </SettingField>
      ) : (
        <SettingField key={f.key} api={api} k={f.key} label={f.label} placeholder={f.placeholder} />
      ))}
    </>
  )
}

function BrainHealth({ brain }: { brain?: Brain | null }) {
  if (!brain) return null
  const paused = brain.paused_until && brain.paused_until * 1000 > Date.now()
  if (brain.provider === 'codex' && (!brain.ready || !paused)) return null  // the Codex account row says it
  if (brain.ready && !paused) {
    return <p className="flex items-center gap-1.5 text-ui text-muted"><Check size={14} className="text-action" aria-hidden />
      Ready{brain.detail ? `: ${brain.detail}` : ''}</p>
  }
  return (
    <div className="rounded-control border border-warn/30 bg-warn/[0.06] px-3 py-2 text-ui text-ink">
      <p className="font-medium text-warn">{brain.ready ? 'Paused after a failure' : 'Not ready'}</p>
      <p className="mt-0.5 text-muted">
        {brain.ready && paused
          ? `It failed (${brain.last_error || 'unknown error'}) and will be tried again at ${new Date(brain.paused_until! * 1000).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}. Test it to try now.`
          : brain.detail || brain.last_error || 'Not reachable.'}
      </p>
    </div>
  )
}

function BrainTest({ target, onDone }: { target: 'primary' | 'backup'; onDone: () => void }) {
  const [busy, setBusy] = useState(false)
  async function run() {
    setBusy(true)
    try {
      const r = await testBrain(target)
      if (r.ok) toast.success(`${r.label || 'It'} answered: “${r.reply?.trim()}”`)
      else toast.error(r.error || 'No answer', { duration: 8000 })
    } catch (e) { toast.error(errorText(e)) } finally { setBusy(false); onDone() }
  }
  return <Button size="sm" loading={busy} onClick={run}>{busy ? 'Testing' : 'Test'}</Button>
}

const SUGGESTED_PULLS = ['llama3.2:3b', 'qwen3:8b', 'mistral:7b', 'hermes3:8b']

function OllamaPullSection({ onPulled }: { onPulled: () => void }) {
  const [name, setName] = useState('')
  const [pulling, setPulling] = useState<string | null>(null)
  const [progress, setProgress] = useState<{ status: string; completed: number; total: number } | null>(null)

  useEffect(() => {
    if (!pulling) return
    const t = setInterval(async () => {
      try {
        const { data } = await axios.get(`/api/settings/models/pull-status?model=${encodeURIComponent(pulling)}`)
        setProgress(data)
        if (data.done) {
          setPulling(null); setProgress(null)
          if (data.status === 'success') { toast.success(`${pulling} downloaded. Pick it in the model list.`); onPulled() }
          else toast.error(`Download failed: ${data.error || data.status}`)
        }
      } catch { /* transient — keep polling */ }
    }, 2000)
    return () => clearInterval(t)
  }, [pulling])

  async function pull(model: string) {
    const m = model.trim()
    if (!m) return
    try {
      await axios.post('/api/settings/models/pull', { model: m })
      setPulling(m); setProgress({ status: 'starting', completed: 0, total: 0 })
    } catch (e) { toast.error(errorText(e, "Couldn't start the download")) }
  }

  const pct = progress && progress.total > 0 ? Math.round((progress.completed / progress.total) * 100) : null
  const gb = (n: number) => (n / 1e9).toFixed(1)

  return (
    <div className="border-t border-line pt-4">
      <form className="flex items-end gap-2" onSubmit={e => { e.preventDefault(); if (!pulling) pull(name) }}>
        <Field label="Download an Ollama model" className="flex-1"
          hint={<>Any name from <a className="text-action hover:underline" href="https://ollama.com/library" target="_blank" rel="noreferrer">ollama.com/library</a>. It downloads onto the Ollama machine.</>}>
          <Input placeholder="qwen3:8b" value={name} onChange={e => setName(e.target.value)} disabled={!!pulling} />
        </Field>
        <Button type="submit" icon={Download} loading={!!pulling} disabled={!name.trim()} className="mb-[22px]">Download</Button>
      </form>
      {!pulling && (
        <div className="mt-1 flex flex-wrap gap-1.5">
          {SUGGESTED_PULLS.map(m => (
            <button key={m} type="button" onClick={() => pull(m)}
              className="h-7 rounded-full border border-line px-2.5 text-ui text-muted hover:text-ink">{m}</button>
          ))}
        </div>
      )}
      {pulling && progress && (
        <div className="mt-3 space-y-1.5" role="status">
          <div className="flex justify-between text-ui text-muted tnum">
            <span>{pulling}: {progress.status}</span>
            {pct != null && <span>{gb(progress.completed)} of {gb(progress.total)} GB ({pct}%)</span>}
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-line">
            <div className="h-full bg-action transition-all" style={{ width: `${pct ?? 3}%` }} />
          </div>
          <p className="text-xs text-muted">You can leave this page. The download keeps going.</p>
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Calendars
// ---------------------------------------------------------------------------
function MicrosoftSection() {
  const [status, setStatus] = useState<{ connected: boolean; mode?: string; account: string; client_id_set: boolean } | null>(null)
  const [authMode, setAuthMode] = useState<'secret' | 'device'>('secret')
  const [clientId, setClientId] = useState('')
  const [tenant, setTenant] = useState('')
  const [secret, setSecret] = useState('')
  const [email, setEmail] = useState('')
  const [code, setCode] = useState<{ user_code: string; verification_uri: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const [showHelp, setShowHelp] = useState(false)
  const [confirmOff, setConfirmOff] = useState(false)

  const load = () => axios.get('/api/msgraph/status').then(r => setStatus(r.data)).catch(() => {})
  useEffect(() => { load() }, [])

  async function connectWithSecret() {
    setBusy(true)
    try {
      const { data } = await axios.post('/api/msgraph/credentials', {
        client_id: clientId.trim(), tenant: tenant.trim(), client_secret: secret.trim(), user_email: email.trim(),
      })
      toast.success(`Connected. Syncing ${data.account}'s calendar.`)
      setSecret(''); load()
    } catch (e) { toast.error(errorText(e, "Couldn't connect"), { duration: 9000 }) } finally { setBusy(false) }
  }

  async function saveAndConnect() {
    setBusy(true)
    try {
      await axios.post('/api/msgraph/client-id', { client_id: clientId.trim(), tenant: tenant.trim() })
      setClientId(''); await load()
    } catch (e) { setBusy(false); toast.error(errorText(e, 'That client ID was rejected')); return }
    setBusy(false); connect()
  }

  async function connect() {
    setBusy(true)
    try {
      const { data } = await axios.post('/api/msgraph/device-code')
      setCode(data)
      const timer = setInterval(async () => {
        try {
          const r = await axios.post('/api/msgraph/poll')
          if (r.data.status === 'success') {
            clearInterval(timer); setCode(null); setBusy(false)
            toast.success(`Connected as ${r.data.account}. The calendar is syncing.`); load()
          } else if (r.data.status === 'error') {
            clearInterval(timer); setCode(null); setBusy(false)
            toast.error(r.data.detail || 'Sign-in failed')
          }
        } catch { /* keep polling */ }
      }, 5000)
    } catch (e) { setBusy(false); toast.error(errorText(e, "Couldn't start sign-in")) }
  }

  if (!status) return null

  return (
    <Panel title="Microsoft 365 and Outlook" description="Two-way sync: events added in HomeHub appear in Outlook, and the other way round.">
      {status.connected ? (
        <div className="flex flex-wrap items-center gap-3">
          <Badge tone="action" icon={Check}>Connected</Badge>
          <span className="flex-1 text-sm text-ink">{status.account || 'Microsoft account'}</span>
          <Button size="sm" variant="ghost" onClick={() => setConfirmOff(true)}>Disconnect</Button>
          <ConfirmDialog open={confirmOff} onClose={() => setConfirmOff(false)} title="Disconnect Outlook?"
            description="Synced Outlook events stay on the calendar but stop updating." confirmLabel="Disconnect"
            onConfirm={async () => { await axios.post('/api/msgraph/disconnect'); toast.success('Disconnected'); load() }} />
        </div>
      ) : code ? (
        <div className="space-y-2 text-center">
          <p className="text-sm text-ink">On any device, open{' '}
            <a href={code.verification_uri} target="_blank" rel="noreferrer" className="font-medium text-action hover:underline">{code.verification_uri}</a>{' '}
            and enter this code:</p>
          <p className="text-3xl font-semibold tracking-[0.2em] text-ink tnum">{code.user_code}</p>
          <p className="text-ui text-muted">Waiting for you to finish signing in…</p>
        </div>
      ) : (
        <div className="space-y-4">
          <Tabs label="Connection method" value={authMode} onChange={setAuthMode}
            tabs={[{ id: 'secret', label: 'Client secret' }, { id: 'device', label: 'Sign in on a phone' }]} />
          {authMode === 'secret' ? (
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Application (client) ID"><Input value={clientId} onChange={e => setClientId(e.target.value)} /></Field>
              <Field label="Directory (tenant) ID"><Input value={tenant} onChange={e => setTenant(e.target.value)} /></Field>
              <Field label="Client secret value" hint="The Value column, not the Secret ID">
                <Input type="password" autoComplete="off" value={secret} onChange={e => setSecret(e.target.value)} />
              </Field>
              <Field label="Calendar mailbox" hint="Whose calendar HomeHub syncs">
                <Input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="family@example.com" />
              </Field>
              <div className="sm:col-span-2">
                <Button variant="primary" loading={busy} onClick={connectWithSecret}
                  disabled={!clientId.trim() || !tenant.trim() || !secret.trim() || !email.trim()}>
                  {busy ? 'Checking the credentials' : 'Connect'}
                </Button>
              </div>
            </div>
          ) : status.client_id_set ? (
            <div className="flex flex-wrap items-center gap-3">
              <Button variant="primary" loading={busy} onClick={connect}>Connect Microsoft account</Button>
              <button type="button" className="text-ui text-action hover:underline"
                onClick={() => setStatus(s => s ? { ...s, client_id_set: false } : s)}>Change client ID</button>
            </div>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Application (client) ID"><Input value={clientId} onChange={e => setClientId(e.target.value)} /></Field>
              <Field label="Directory (tenant) ID" hint="Only for single-tenant apps"><Input value={tenant} onChange={e => setTenant(e.target.value)} /></Field>
              <div className="sm:col-span-2">
                <Button variant="primary" loading={busy} disabled={!clientId.trim()} onClick={saveAndConnect}>Save and connect</Button>
              </div>
            </div>
          )}
          <button type="button" onClick={() => setShowHelp(v => !v)} className="text-ui text-action hover:underline">
            {showHelp ? 'Hide the setup steps' : 'How to get these from Azure (about 5 minutes)'}
          </button>
          {showHelp && (authMode === 'secret' ? (
            <ol className="ml-4 list-decimal space-y-1 text-ui text-muted">
              <li>portal.azure.com → Microsoft Entra ID → App registrations → your app, or New registration.</li>
              <li>On Overview, copy the Application (client) ID and Directory (tenant) ID.</li>
              <li>API permissions → Add → Microsoft Graph → Application permissions → Calendars.ReadWrite → Grant admin consent.</li>
              <li>Certificates &amp; secrets → New client secret → copy the Value right away. Secrets expire, so set a reminder.</li>
              <li>Calendar mailbox is the account whose calendar HomeHub syncs.</li>
            </ol>
          ) : (
            <ol className="ml-4 list-decimal space-y-1 text-ui text-muted">
              <li>portal.azure.com → Microsoft Entra ID → App registrations → New registration, named HomeHub.</li>
              <li>Account types: any organizational directory and personal Microsoft accounts. No redirect URI.</li>
              <li>Copy the Application (client) ID into the form.</li>
              <li>Authentication → Allow public client flows: Yes → Save.</li>
              <li>API permissions → Microsoft Graph → Delegated → Calendars.ReadWrite and offline_access → Grant admin consent.</li>
            </ol>
          ))}
        </div>
      )}
    </Panel>
  )
}

function shortenUrl(u: string) {
  try { const p = new URL(u); return p.hostname + '…' + u.slice(-18) } catch { return u.slice(0, 40) + '…' }
}

function InboundFeedsSection() {
  const [feeds, setFeeds] = useState<string[]>([])
  const [newUrl, setNewUrl] = useState('')
  const [busy, setBusy] = useState(false)
  const [removing, setRemoving] = useState<string | null>(null)

  useEffect(() => { axios.get('/api/settings/ics-feeds').then(r => setFeeds(r.data.feeds)).catch(() => {}) }, [])

  async function add() {
    if (!newUrl.trim()) return
    setBusy(true)
    try {
      const { data } = await axios.post('/api/settings/ics-feeds', { url: newUrl.trim() })
      toast.success(`Added${data.name ? ` “${data.name}”` : ''}: ${data.events_found} events found`)
      setNewUrl(''); setFeeds(data.feeds)
    } catch (e) { toast.error(errorText(e, "Couldn't add that calendar")) } finally { setBusy(false) }
  }

  return (
    <Panel title="Calendars shown in HomeHub" description="Read-only Google or Outlook calendars, added by their iCal link." padded={false}>
      {feeds.length > 0 && (
        <ul className="divide-y divide-line border-b border-line">
          {feeds.map(url => (
            <li key={url} className="flex items-center gap-3 px-4 py-2.5">
              <code className="min-w-0 flex-1 truncate text-ui text-ink" title={url}>{shortenUrl(url)}</code>
              <Button size="sm" variant="ghost" onClick={() => setRemoving(url)}>Remove</Button>
            </li>
          ))}
        </ul>
      )}
      <form className="flex items-end gap-2 p-4" onSubmit={e => { e.preventDefault(); add() }}>
        <Field label="Add a calendar link" className="flex-1"
          hint="Google: calendar settings → Secret address in iCal format. Outlook: Settings → Shared calendars → Publish.">
          <Input value={newUrl} onChange={e => setNewUrl(e.target.value)} placeholder="https://… or webcal://…" />
        </Field>
        <Button type="submit" icon={Plus} loading={busy} disabled={!newUrl.trim()} className="mb-[38px] sm:mb-[22px]">Add</Button>
      </form>
      <ConfirmDialog open={!!removing} onClose={() => setRemoving(null)} title="Stop showing this calendar?"
        description="Nothing is deleted in Google or Outlook." confirmLabel="Remove"
        onConfirm={async () => {
          const { data } = await axios.delete('/api/settings/ics-feeds', { params: { url: removing } })
          setFeeds(data.feeds); toast.success('Calendar removed')
        }} />
    </Panel>
  )
}

function CalendarFeedSection() {
  const [path, setPath] = useState<string | null>(null)
  useEffect(() => { axios.get('/api/settings/calendar-feed').then(r => setPath(r.data.path)).catch(() => {}) }, [])
  if (!path) return null
  const url = `${window.location.origin}${path}`
  return (
    <Panel title="Subscribe to HomeHub's calendar" description="Show HomeHub's events in Google Calendar or Outlook.">
      <div className="flex items-center gap-2">
        <code className="min-w-0 flex-1 break-all rounded-control border border-line bg-canvas px-3 py-2 text-ui text-ink">{url}</code>
        <IconButton icon={Copy} label="Copy link" variant="secondary"
          onClick={() => { navigator.clipboard?.writeText(url); toast.success('Link copied') }} />
      </div>
      <p className="mt-2 text-ui text-muted">
        Google: Other calendars → + → From URL. Outlook: Add calendar → Subscribe from web. Use an address they can reach,
        not localhost. Google refreshes subscriptions every few hours.
      </p>
    </Panel>
  )
}

// ---------------------------------------------------------------------------
// Storage, logins, maintenance
// ---------------------------------------------------------------------------
function StorageSection() {
  const [status, setStatus] = useState<any>(null)
  const [dataPath, setDataPath] = useState('')
  const [backupPath, setBackupPath] = useState('')
  const [cmds, setCmds] = useState<{ commands: string[]; note: string } | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    axios.get('/api/settings/setup/status').then(r => {
      setStatus(r.data); setDataPath(r.data.data_path || ''); setBackupPath(r.data.backup_path || '')
    }).catch(() => {})
  }, [])

  async function save() {
    setBusy(true)
    try {
      const { data } = await axios.post('/api/settings/storage', { data_path: dataPath.trim(), backup_path: backupPath.trim() })
      setCmds({ commands: data.commands, note: data.note })
      toast.success('Saved to .env')
    } catch (e) { toast.error(errorText(e, "Couldn't save")) } finally { setBusy(false) }
  }

  if (!status) return null
  return (
    <Panel title="Storage and backups">
      {status.env_file_writable ? (
        <div className="space-y-4">
          <p className="text-ui text-muted">
            Any folder on the machine running Docker works, including NAS folders. Changes go into .env and take effect
            after a restart. Leave a field blank to use the default.
          </p>
          <StoragePathInput label="Database folder" kind="data" placeholder={status.data_path_display} value={dataPath}
            onChange={v => { setDataPath(v); setCmds(null) }} />
          <StoragePathInput label="Backup folder (use a different disk)" kind="backup" placeholder={status.backup_path_display}
            value={backupPath} onChange={v => { setBackupPath(v); setCmds(null) }} />
          <Button variant="primary" loading={busy} onClick={save}>Save storage folders</Button>
          {cmds && (
            <div className="space-y-2 rounded-control border border-warn/30 bg-warn/[0.06] p-3">
              <p className="text-ui font-medium text-warn">Saved. Now run this on the Docker host:</p>
              <pre className="whitespace-pre-wrap break-all rounded bg-ink/[0.06] p-2 text-xs text-ink">{cmds.commands.join('\n')}</pre>
              <p className="text-xs text-muted">{cmds.note}</p>
            </div>
          )}
        </div>
      ) : (
        <dl className="grid gap-2 text-sm sm:grid-cols-[8rem_1fr]">
          <dt className="text-muted">Database</dt><dd className="break-all text-ink">{status.data_path_display}</dd>
          <dt className="text-muted">Backups</dt><dd className="break-all text-ink">{status.backup_path_display}</dd>
          <dd className="text-ui text-muted sm:col-span-2">
            To change these, set DATA_PATH and BACKUP_PATH in .env and run docker compose up -d.
          </dd>
        </dl>
      )}
    </Panel>
  )
}

function UsersSection() {
  const [users, setUsers] = useState<AppUser[]>([])
  const [form, setForm] = useState({ username: '', password: '', role: 'member' })
  const [busy, setBusy] = useState(false)
  const [removing, setRemoving] = useState<AppUser | null>(null)

  const load = () => getUsers().then(setUsers).catch(() => {})
  useEffect(() => { load() }, [])

  async function add() {
    if (!form.username.trim() || form.password.length < 6) { toast.error('Enter a username and a password of at least 6 characters'); return }
    setBusy(true)
    try {
      await createUser(form)
      toast.success(`${form.role === 'member' ? 'Member' : 'Admin'} login created`)
      setForm({ username: '', password: '', role: 'member' }); load()
    } catch (e) { toast.error(errorText(e, "Couldn't create that login")) } finally { setBusy(false) }
  }

  return (
    <Panel title="Logins" description="Members can use everything except Settings. Good for kids' tablets or a kitchen display." padded={false}>
      <ul className="divide-y divide-line border-b border-line">
        {users.map(u => (
          <li key={u.id} className="flex items-center gap-3 px-4 py-2.5">
            <span className="flex-1 text-sm text-ink">{u.username}</span>
            <Badge tone={u.role === 'admin' ? 'action' : 'neutral'}>{u.role === 'admin' ? 'Admin' : 'Member'}</Badge>
            <IconButton icon={Trash2} label={`Delete ${u.username}`} size="sm" onClick={() => setRemoving(u)} />
          </li>
        ))}
      </ul>
      <form className="grid gap-3 p-4 sm:grid-cols-[1fr_1fr_8rem_auto] sm:items-end" onSubmit={e => { e.preventDefault(); add() }}>
        <Field label="Username"><Input value={form.username} onChange={e => setForm(f => ({ ...f, username: e.target.value }))} autoComplete="off" /></Field>
        <Field label="Password"><Input type="password" autoComplete="new-password" placeholder="6 or more characters" value={form.password}
          onChange={e => setForm(f => ({ ...f, password: e.target.value }))} /></Field>
        <Field label="Role">
          <Select value={form.role} onChange={e => setForm(f => ({ ...f, role: e.target.value }))}>
            <option value="member">Member</option><option value="admin">Admin</option>
          </Select>
        </Field>
        <Button type="submit" variant="primary" icon={Plus} loading={busy}>Add login</Button>
      </form>
      <ConfirmDialog open={!!removing} onClose={() => setRemoving(null)} title={`Delete the login “${removing?.username}”?`}
        description="They won't be able to sign in. Nothing else is deleted." confirmLabel="Delete login"
        onConfirm={async () => {
          try { await deleteUser(removing!.id); toast.success('Login deleted'); load() } catch (e) { toast.error(errorText(e)) }
        }} />
    </Panel>
  )
}

function PasswordSection() {
  const [pw, setPw] = useState({ current: '', next: '', confirm: '' })
  const [busy, setBusy] = useState(false)
  const mismatch = pw.confirm && pw.next !== pw.confirm ? "The new passwords don't match" : null

  async function change() {
    if (pw.next.length < 6) { toast.error('Use at least 6 characters'); return }
    setBusy(true)
    try {
      await axios.post('/api/auth/change-password', { current_password: pw.current, new_password: pw.next })
      toast.success('Password changed'); setPw({ current: '', next: '', confirm: '' })
    } catch (e) { toast.error(errorText(e, "Couldn't change the password")) } finally { setBusy(false) }
  }

  return (
    <Panel title="Your password">
      <form className="grid gap-3 sm:grid-cols-3 sm:items-start" onSubmit={e => { e.preventDefault(); change() }}>
        <Field label="Current password"><Input type="password" autoComplete="current-password" value={pw.current} onChange={e => setPw(p => ({ ...p, current: e.target.value }))} /></Field>
        <Field label="New password"><Input type="password" autoComplete="new-password" value={pw.next} onChange={e => setPw(p => ({ ...p, next: e.target.value }))} /></Field>
        <Field label="Confirm new password" error={mismatch}><Input type="password" autoComplete="new-password" value={pw.confirm} onChange={e => setPw(p => ({ ...p, confirm: e.target.value }))} /></Field>
        <div className="sm:col-span-3">
          <Button type="submit" variant="primary" loading={busy} disabled={!pw.current || !pw.next || !pw.confirm || !!mismatch}>Change password</Button>
        </div>
      </form>
    </Panel>
  )
}

function MaintenanceSection() {
  const [confirming, setConfirming] = useState(false)
  return (
    <Panel title="Maintenance">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="flex-1">
          <p className="text-sm font-medium text-ink">Clear recent activity</p>
          <p className="text-ui text-muted">Empties the activity log on Overview. Inventory, calendar, and chores aren't touched.</p>
        </div>
        <Button variant="secondary" className="text-danger" onClick={() => setConfirming(true)}>Clear activity</Button>
      </div>
      <ConfirmDialog open={confirming} onClose={() => setConfirming(false)} title="Clear recent activity?"
        description="The activity log on Overview is emptied. This can't be undone." confirmLabel="Clear activity"
        onConfirm={async () => {
          try {
            const { data } = await axios.post('/api/settings/clear-activity')
            toast.success(`Cleared ${data.deleted} entries`)
          } catch (e) { toast.error(errorText(e)) }
        }} />
    </Panel>
  )
}
