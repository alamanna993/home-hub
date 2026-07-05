import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { ArrowLeft, ArrowRight, Bot, Check, CheckCircle2, Database, KeyRound, MessageCircle, PartyPopper, RefreshCw, XCircle } from 'lucide-react'
import axios from 'axios'
import toast from 'react-hot-toast'
import { cn } from '../lib/utils'
import ModelSelect from '../components/ModelSelect'
import StoragePathInput from '../components/StoragePathInput'

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

const PROVIDERS = [
  { value: 'ollama', label: 'Ollama', sub: 'Local, free — runs on your machine', fields: [
    { key: 'ollama_host', label: 'Server URL', placeholder: 'http://host.docker.internal:11434' },
    { key: 'ollama_model', label: 'Model', placeholder: 'llama3.2, hermes3, mistral…', model: true },
  ]},
  { value: 'lmstudio', label: 'LM Studio', sub: 'Local, free — OpenAI-compatible server', fields: [
    { key: 'lmstudio_host', label: 'Server URL', placeholder: 'http://host.docker.internal:1234' },
    { key: 'lmstudio_model', label: 'Model', placeholder: 'leave blank to use the loaded model', model: true },
  ]},
  { value: 'openai', label: 'OpenAI', sub: 'Cloud — needs an API key', fields: [
    { key: 'openai_api_key', label: 'API Key', placeholder: 'sk-…', secret: true },
    { key: 'openai_model', label: 'Model', placeholder: 'gpt-4o-mini', model: true },
  ]},
  { value: 'claude', label: 'Claude', sub: 'Cloud (Anthropic) — needs an API key', fields: [
    { key: 'anthropic_api_key', label: 'API Key', placeholder: 'sk-ant-…', secret: true },
    { key: 'claude_model', label: 'Model', placeholder: 'claude-haiku-4-5', model: true },
  ]},
  { value: 'none', label: 'No AI yet', sub: 'Skip for now — everything else still works', fields: [] },
]

const STEPS = ['Welcome', 'Password', 'Storage', 'AI Model', 'Bots', 'Done']

export default function Setup() {
  const navigate = useNavigate()
  const [step, setStep] = useState(0)
  const [status, setStatus] = useState<SetupStatus | null>(null)
  const [busy, setBusy] = useState(false)

  // password step
  const [pw, setPw] = useState({ current: 'admin', next: '', confirm: '' })
  const [pwDone, setPwDone] = useState(false)

  // storage step
  const [dataPath, setDataPath] = useState('')
  const [backupPath, setBackupPath] = useState('')
  const [storageCmds, setStorageCmds] = useState<{ commands: string[]; note: string } | null>(null)

  // AI step
  const [provider, setProvider] = useState('ollama')
  const [fields, setFields] = useState<Record<string, string>>({})
  const [testResult, setTestResult] = useState<{ ok: boolean; text: string } | null>(null)

  // bots step
  const [tgToken, setTgToken] = useState('')
  const [tgChats, setTgChats] = useState('')

  useEffect(() => {
    axios.get<SetupStatus>('/api/settings/setup/status').then(r => {
      setStatus(r.data)
      setProvider(r.data.llm_provider || 'ollama')
      setDataPath(r.data.data_path || '')
      setBackupPath(r.data.backup_path || '')
      if (!r.data.default_password_in_use) setPwDone(true)
    }).catch(() => toast.error('Could not load setup status'))
  }, [])

  async function saveStorage() {
    setBusy(true)
    try {
      const { data } = await axios.post('/api/settings/storage', {
        data_path: dataPath.trim(),
        backup_path: backupPath.trim(),
      })
      setStorageCmds({ commands: data.commands, note: data.note })
      toast.success('Storage paths saved to .env')
    } catch (e: any) {
      toast.error(e?.response?.data?.detail || 'Failed to save storage paths')
    } finally { setBusy(false) }
  }

  async function savePassword() {
    if (pw.next !== pw.confirm) return toast.error('Passwords do not match')
    if (pw.next.length < 6) return toast.error('Use at least 6 characters')
    setBusy(true)
    try {
      await axios.post('/api/auth/change-password', { current_password: pw.current, new_password: pw.next })
      toast.success('Password changed')
      setPwDone(true)
      setStep(step + 1)
    } catch (e: any) {
      toast.error(e?.response?.data?.detail || 'Failed to change password')
    } finally { setBusy(false) }
  }

  async function saveProvider(goNext: boolean) {
    setBusy(true)
    try {
      await axios.patch('/api/settings/llm_provider', { value: provider })
      for (const f of PROVIDERS.find(p => p.value === provider)!.fields) {
        if (fields[f.key] !== undefined && fields[f.key] !== '') {
          await axios.patch(`/api/settings/${f.key}`, { value: fields[f.key] })
        }
      }
      if (goNext) { toast.success('AI provider saved'); setStep(step + 1) }
    } finally { setBusy(false) }
  }

  async function testLLM() {
    setTestResult(null)
    setBusy(true)
    try {
      await saveProvider(false)
      const { data } = await axios.post('/api/settings/test-llm')
      setTestResult(data.ok ? { ok: true, text: `Model replied: "${data.reply}"` } : { ok: false, text: data.error })
    } catch (e: any) {
      setTestResult({ ok: false, text: e?.response?.data?.detail || 'Request failed' })
    } finally { setBusy(false) }
  }

  async function saveBots() {
    setBusy(true)
    try {
      if (tgToken.trim()) await axios.patch('/api/settings/telegram_bot_token', { value: tgToken.trim() })
      if (tgChats.trim()) await axios.patch('/api/settings/telegram_allowed_chat_ids', { value: tgChats.trim() })
      if (tgToken.trim()) toast.success('Bot config saved — the Telegram bot picks it up within ~30s')
      setStep(step + 1)
    } finally { setBusy(false) }
  }

  async function finish() {
    setBusy(true)
    try {
      await axios.post('/api/settings/setup/complete')
      toast.success('Welcome to HomeHub! 🏠')
      navigate('/', { replace: true })
    } finally { setBusy(false) }
  }

  const activeProvider = PROVIDERS.find(p => p.value === provider)!

  const input = 'w-full bg-surface border border-surface-border rounded-lg px-3 py-2.5 text-white text-sm focus:outline-none focus:border-accent'
  const primaryBtn = 'flex items-center justify-center gap-2 bg-accent hover:bg-accent-hover text-white text-sm font-medium px-5 py-2.5 rounded-lg transition-all disabled:opacity-50'
  const ghostBtn = 'flex items-center gap-2 text-surface-muted hover:text-white text-sm px-4 py-2.5 rounded-lg transition-all'

  return (
    <div className="min-h-screen bg-surface flex items-center justify-center p-4">
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-1/3 left-1/2 -translate-x-1/2 -translate-y-1/2 w-96 h-96 bg-accent/10 rounded-full blur-3xl" />
      </div>

      <div className="relative w-full max-w-xl">
        {/* Progress */}
        <div className="flex items-center justify-center gap-1.5 mb-6">
          {STEPS.map((s, i) => (
            <div key={s} className={cn('h-1.5 rounded-full transition-all',
              i === step ? 'w-8 bg-accent' : i < step ? 'w-4 bg-accent/50' : 'w-4 bg-surface-border')} />
          ))}
        </div>

        <AnimatePresence mode="wait">
          <motion.div key={step}
            initial={{ opacity: 0, x: 24 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -24 }}
            transition={{ duration: 0.2 }}
            className="bg-surface-card border border-surface-border rounded-2xl p-7 shadow-card space-y-5">

            {step === 0 && (
              <>
                <div className="text-center">
                  <div className="text-5xl mb-3">🏠</div>
                  <h1 className="text-white text-2xl font-bold">Welcome to HomeHub</h1>
                  <p className="text-surface-muted text-sm mt-2 leading-relaxed">
                    Let's get your home set up in a couple of minutes: secure your account,
                    check where your data lives, connect an AI model, and hook up the chat bots.
                  </p>
                </div>
                <div className="flex justify-end pt-2">
                  <button className={primaryBtn} onClick={() => setStep(1)}>Get Started <ArrowRight size={15} /></button>
                </div>
              </>
            )}

            {step === 1 && (
              <>
                <h2 className="text-white text-lg font-bold flex items-center gap-2"><KeyRound size={18} className="text-accent" /> Secure your account</h2>
                {pwDone ? (
                  <div className="flex items-center gap-2 text-green-400 text-sm bg-green-500/10 rounded-lg px-3 py-2.5">
                    <CheckCircle2 size={16} /> Your password is already set — you're good.
                  </div>
                ) : (
                  <>
                    <p className="text-surface-muted text-sm">You're signed in with the default <span className="font-mono text-white">admin / admin</span>. Pick a real password before anything else.</p>
                    <div className="space-y-3">
                      <input type="password" className={input} placeholder="New password (6+ characters)"
                        value={pw.next} onChange={e => setPw(f => ({ ...f, next: e.target.value }))} />
                      <input type="password" className={input} placeholder="Confirm new password"
                        value={pw.confirm} onChange={e => setPw(f => ({ ...f, confirm: e.target.value }))} />
                    </div>
                  </>
                )}
                <div className="flex justify-between pt-2">
                  <button className={ghostBtn} onClick={() => setStep(0)}><ArrowLeft size={15} /> Back</button>
                  {pwDone
                    ? <button className={primaryBtn} onClick={() => setStep(2)}>Next <ArrowRight size={15} /></button>
                    : <button className={primaryBtn} disabled={busy || !pw.next || !pw.confirm} onClick={savePassword}>
                        {busy ? <RefreshCw size={15} className="animate-spin" /> : <Check size={15} />} Set Password
                      </button>}
                </div>
              </>
            )}

            {step === 2 && (
              <>
                <h2 className="text-white text-lg font-bold flex items-center gap-2"><Database size={18} className="text-accent" /> Where your data lives</h2>
                {status?.env_file_writable ? (
                  <>
                    <p className="text-surface-muted text-xs leading-relaxed">
                      Pick host folders for the database and its nightly backups. Leave blank to keep
                      the safe defaults (a Docker-managed volume + a <span className="font-mono text-white">backups</span> folder).
                      Put the backups on a <em>different</em> disk than the database so one drive failure can't take both.
                    </p>
                    <div className="space-y-2.5">
                      <StoragePathInput label="Database folder (e.g. /volume1/docker/homehub/db)" kind="data"
                        placeholder={status?.data_path_display} value={dataPath}
                        onChange={v => { setDataPath(v); setStorageCmds(null) }} />
                      <StoragePathInput label="Backup folder (e.g. /volume2/backup/homehub)" kind="backup"
                        placeholder={status?.backup_path_display} value={backupPath}
                        onChange={v => { setBackupPath(v); setStorageCmds(null) }} />
                    </div>
                    {(dataPath.trim() !== (status?.data_path || '') || backupPath.trim() !== (status?.backup_path || '')) && !storageCmds && (
                      <button onClick={saveStorage} disabled={busy}
                        className="w-full flex items-center justify-center gap-2 border border-surface-border hover:border-accent text-white text-sm py-2.5 rounded-lg transition-all disabled:opacity-50">
                        {busy ? <RefreshCw size={15} className="animate-spin" /> : <Check size={15} />} Save Storage Paths
                      </button>
                    )}
                    {storageCmds && (
                      <div className="bg-surface rounded-lg p-3 space-y-2">
                        <p className="text-orange-300 text-xs font-medium">⚠️ Saved — takes effect after a restart. Run on the Docker host:</p>
                        <pre className="text-green-400 font-mono text-[11px] whitespace-pre-wrap break-all bg-black/30 rounded p-2">{storageCmds.commands.join('\n')}</pre>
                        <p className="text-surface-muted text-[10px] leading-relaxed">{storageCmds.note}</p>
                      </div>
                    )}
                  </>
                ) : (
                  <div className="space-y-3 text-sm">
                    <div className="bg-surface rounded-lg px-3 py-2.5">
                      <p className="text-surface-muted text-xs mb-0.5">Database folder</p>
                      <p className="text-white font-mono text-xs break-all">{status?.data_path_display}</p>
                    </div>
                    <div className="bg-surface rounded-lg px-3 py-2.5">
                      <p className="text-surface-muted text-xs mb-0.5">Automatic nightly backups</p>
                      <p className="text-white font-mono text-xs break-all">{status?.backup_path_display}</p>
                    </div>
                    <p className="text-surface-muted leading-relaxed text-xs">
                      To change these, set <span className="font-mono text-white">DATA_PATH</span> and
                      <span className="font-mono text-white"> BACKUP_PATH</span> in
                      <span className="font-mono text-white"> .env</span> and run
                      <span className="font-mono text-white"> docker compose up -d</span>.
                      (Editing from here requires the .env bind mount added in newer versions of docker-compose.yml.)
                    </p>
                  </div>
                )}
                <div className="flex justify-between pt-2">
                  <button className={ghostBtn} onClick={() => setStep(1)}><ArrowLeft size={15} /> Back</button>
                  <button className={primaryBtn} onClick={() => setStep(3)}>
                    {storageCmds || !status?.env_file_writable ? 'Next' : 'Keep Defaults'} <ArrowRight size={15} />
                  </button>
                </div>
              </>
            )}

            {step === 3 && (
              <>
                <h2 className="text-white text-lg font-bold flex items-center gap-2"><Bot size={18} className="text-accent" /> Connect an AI model</h2>
                <p className="text-surface-muted text-xs">Powers the chat, the bots, and "what can I make tonight?". Local models are free and private; cloud models are smarter.</p>
                <div className="grid grid-cols-2 gap-2">
                  {PROVIDERS.map(p => (
                    <button key={p.value} onClick={() => { setProvider(p.value); setTestResult(null) }}
                      className={cn('text-left rounded-xl border px-3 py-2.5 transition-all',
                        provider === p.value ? 'border-accent bg-accent/10' : 'border-surface-border bg-surface hover:border-surface-muted')}>
                      <p className="text-white text-sm font-medium">{p.label}</p>
                      <p className="text-surface-muted text-[11px] mt-0.5">{p.sub}</p>
                    </button>
                  ))}
                </div>
                <div className="space-y-2.5">
                  {activeProvider.fields.map(f => (
                    <div key={f.key}>
                      <label className="text-xs text-surface-muted mb-1 block">{f.label}</label>
                      {(f as any).model ? (
                        <ModelSelect provider={provider} value={fields[f.key] ?? ''}
                          onChange={v => setFields(prev => ({ ...prev, [f.key]: v }))} />
                      ) : (
                        <input type={(f as any).secret ? 'password' : 'text'} className={input} placeholder={f.placeholder}
                          value={fields[f.key] ?? ''} onChange={e => setFields(prev => ({ ...prev, [f.key]: e.target.value }))} />
                      )}
                    </div>
                  ))}
                </div>
                {provider === 'none' ? (
                  <p className="text-surface-muted text-xs bg-surface rounded-lg px-3 py-2.5 leading-relaxed">
                    👍 Totally fine — inventory, calendar, meals, and chores all work without AI.
                    Basic chat lookups ("where is my drill") still work too. Add a model anytime in Settings.
                  </p>
                ) : (
                  <>
                    <button onClick={testLLM} disabled={busy}
                      className="w-full flex items-center justify-center gap-2 border border-surface-border hover:border-accent text-white text-sm py-2.5 rounded-lg transition-all disabled:opacity-50">
                      {busy ? <RefreshCw size={15} className="animate-spin" /> : '⚡'} Test Connection
                    </button>
                    {testResult && (
                      <div className={cn('flex items-start gap-2 text-xs rounded-lg px-3 py-2.5',
                        testResult.ok ? 'bg-green-500/10 text-green-400' : 'bg-red-500/10 text-red-400')}>
                        {testResult.ok ? <CheckCircle2 size={15} className="flex-shrink-0 mt-0.5" /> : <XCircle size={15} className="flex-shrink-0 mt-0.5" />}
                        <span className="break-all">{testResult.text}</span>
                      </div>
                    )}
                  </>
                )}
                <div className="flex justify-between pt-2">
                  <button className={ghostBtn} onClick={() => setStep(2)}><ArrowLeft size={15} /> Back</button>
                  <button className={primaryBtn} disabled={busy} onClick={() => saveProvider(true)}>
                    {provider === 'none' ? 'Skip for Now' : 'Save & Next'} <ArrowRight size={15} />
                  </button>
                </div>
              </>
            )}

            {step === 4 && (
              <>
                <h2 className="text-white text-lg font-bold flex items-center gap-2"><MessageCircle size={18} className="text-accent" /> Chat bots (optional)</h2>
                <p className="text-surface-muted text-xs leading-relaxed">
                  Text your inventory from anywhere — "just bought 2 gallons of milk" from the store updates the database.
                  Get a Telegram token from <span className="text-white font-mono">@BotFather</span> (send it <span className="font-mono text-white">/newbot</span>).
                </p>
                <div className="space-y-2.5">
                  <div>
                    <label className="text-xs text-surface-muted mb-1 block">Telegram Bot Token</label>
                    <input type="password" className={input} placeholder="123456:ABC-DEF…  (leave blank to skip)"
                      value={tgToken} onChange={e => setTgToken(e.target.value)} />
                  </div>
                  <div>
                    <label className="text-xs text-surface-muted mb-1 block">Allowed Chat IDs</label>
                    <input className={input} placeholder="Send /start to your bot to see yours — comma-separate family members"
                      value={tgChats} onChange={e => setTgChats(e.target.value)} />
                  </div>
                  <p className="text-surface-muted text-[11px]">
                    The bot picks up changes within ~30 seconds — no restart needed. You can add Discord later in Settings.
                  </p>
                </div>
                <div className="flex justify-between pt-2">
                  <button className={ghostBtn} onClick={() => setStep(3)}><ArrowLeft size={15} /> Back</button>
                  <button className={primaryBtn} disabled={busy} onClick={saveBots}>
                    {tgToken.trim() ? 'Save & Next' : 'Skip for Now'} <ArrowRight size={15} />
                  </button>
                </div>
              </>
            )}

            {step === 5 && (
              <>
                <div className="text-center">
                  <PartyPopper size={40} className="text-accent mx-auto mb-3" />
                  <h2 className="text-white text-xl font-bold">You're all set!</h2>
                  <p className="text-surface-muted text-sm mt-2 leading-relaxed">
                    Add your rooms in <span className="text-white">Locations</span>, start logging items in
                    <span className="text-white"> Inventory</span>, and try asking the
                    <span className="text-white"> Chat</span>: <em>"what can I make for dinner tonight?"</em>
                  </p>
                </div>
                <button className={cn(primaryBtn, 'w-full')} disabled={busy} onClick={finish}>
                  {busy ? <RefreshCw size={15} className="animate-spin" /> : <Check size={15} />} Open HomeHub
                </button>
              </>
            )}
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  )
}
