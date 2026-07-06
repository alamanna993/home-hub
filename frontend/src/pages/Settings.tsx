import { useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import { Save, Eye, EyeOff, KeyRound, RefreshCw, Database, Users, Copy, Trash2 } from 'lucide-react'
import axios from 'axios'
import toast from 'react-hot-toast'
import { useAuth } from '../hooks/useAuth'
import { getUsers, createUser, deleteUser, AppUser } from '../lib/api'
import ModelSelect from '../components/ModelSelect'
import StoragePathInput from '../components/StoragePathInput'

interface Setting {
  key: string
  value: string
  description: string
  secret: boolean
  is_set: boolean
}

const LABELS: Record<string, string> = {
  ics_urls: 'Calendar Feed URLs (iCal/ICS)',
  telegram_bot_token: 'Telegram Bot Token',
  telegram_allowed_chat_ids: 'Allowed Telegram Chat IDs',
  discord_token: 'Discord Bot Token',
  discord_channel_id: 'Discord Channel ID',
  low_stock_alert_channel: 'Low Stock Alert Channel ID',
  site_title: 'Dashboard Title',
  llm_provider: 'AI Provider',
  ollama_host: 'Ollama Server URL',
  ollama_model: 'Ollama Model',
  lmstudio_host: 'LM Studio Server URL',
  lmstudio_model: 'LM Studio Model',
  openai_api_key: 'OpenAI API Key',
  openai_model: 'OpenAI Model',
  anthropic_api_key: 'Anthropic API Key',
  claude_model: 'Claude Model',
}

const PROVIDER_OPTIONS = [
  { value: 'ollama', label: 'Ollama (local)' },
  { value: 'lmstudio', label: 'LM Studio (local)' },
  { value: 'openai', label: 'OpenAI' },
  { value: 'claude', label: 'Claude (Anthropic)' },
  { value: 'none', label: 'None — AI disabled' },
]

const PROVIDER_FIELDS: Record<string, string[]> = {
  ollama: ['ollama_host', 'ollama_model'],
  lmstudio: ['lmstudio_host', 'lmstudio_model'],
  openai: ['openai_api_key', 'openai_model'],
  claude: ['anthropic_api_key', 'claude_model'],
  none: [],
}

const MODEL_KEYS: Record<string, string> = {
  ollama_model: 'ollama',
  lmstudio_model: 'lmstudio',
  openai_model: 'openai',
  claude_model: 'claude',
}

const GROUPS = [
  { label: '✈️ Telegram', keys: ['telegram_bot_token', 'telegram_allowed_chat_ids'] },
  { label: '🤖 Discord', keys: ['discord_token', 'discord_channel_id', 'low_stock_alert_channel'] },
  { label: '🎨 Dashboard', keys: ['site_title'] },
]

function UsersSection() {
  const [users, setUsers] = useState<AppUser[]>([])
  const [form, setForm] = useState({ username: '', password: '', role: 'member' })
  const [busy, setBusy] = useState(false)

  const load = () => getUsers().then(setUsers).catch(() => {})
  useEffect(() => { load() }, [])

  async function add() {
    if (!form.username.trim() || form.password.length < 6) return toast.error('Username + 6-char password required')
    setBusy(true)
    try {
      await createUser(form)
      toast.success(`${form.role === 'member' ? 'Member' : 'Admin'} account created`)
      setForm({ username: '', password: '', role: 'member' })
      load()
    } catch (e: any) {
      toast.error(e?.response?.data?.detail || 'Could not create user')
    } finally { setBusy(false) }
  }

  async function remove(u: AppUser) {
    if (!confirm(`Delete login "${u.username}"?`)) return
    try {
      await deleteUser(u.id)
      toast.success('User deleted'); load()
    } catch (e: any) {
      toast.error(e?.response?.data?.detail || 'Could not delete user')
    }
  }

  const input = 'bg-surface border border-surface-border rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-accent'

  return (
    <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}
      className="bg-surface-card border border-surface-border rounded-2xl p-5 shadow-card space-y-4">
      <h3 className="text-white font-semibold text-sm flex items-center gap-2">
        <Users size={15} className="text-accent" /> Logins
      </h3>
      <p className="text-surface-muted text-xs leading-relaxed">
        <span className="text-white font-medium">Members</span> can use everything — inventory, calendar,
        meals, chores, chat — but can't open Settings. Great for kids' tablets or a shared kitchen display.
      </p>
      <div className="space-y-1.5">
        {users.map(u => (
          <div key={u.id} className="flex items-center gap-3 bg-surface rounded-lg px-3 py-2 group">
            <span className="text-white text-sm flex-1">{u.username}</span>
            <span className={cnRole(u.role)}>{u.role}</span>
            <button onClick={() => remove(u)} className="opacity-0 group-hover:opacity-100 text-surface-muted hover:text-red-400 transition-all">
              <Trash2 size={14} />
            </button>
          </div>
        ))}
      </div>
      <div className="flex gap-2 flex-wrap">
        <input className={`flex-1 min-w-28 ${input}`} placeholder="Username"
          value={form.username} onChange={e => setForm(f => ({ ...f, username: e.target.value }))} />
        <input type="password" className={`flex-1 min-w-28 ${input}`} placeholder="Password (6+)"
          value={form.password} onChange={e => setForm(f => ({ ...f, password: e.target.value }))} />
        <select className={input} value={form.role} onChange={e => setForm(f => ({ ...f, role: e.target.value }))}>
          <option value="member">Member</option>
          <option value="admin">Admin</option>
        </select>
        <button onClick={add} disabled={busy}
          className="px-4 py-2 bg-accent hover:bg-accent-hover text-white text-sm font-medium rounded-lg transition-all disabled:opacity-50">
          Add
        </button>
      </div>
    </motion.div>
  )
}

function cnRole(role: string) {
  return role === 'admin'
    ? 'text-xs px-2 py-0.5 rounded-full bg-accent/15 text-accent'
    : 'text-xs px-2 py-0.5 rounded-full bg-white/5 text-surface-muted'
}

function shortenUrl(u: string) {
  try {
    const p = new URL(u)
    return p.hostname + '…' + u.slice(-18)
  } catch { return u.slice(0, 40) + '…' }
}

function InboundFeedsSection() {
  const [feeds, setFeeds] = useState<string[]>([])
  const [newUrl, setNewUrl] = useState('')
  const [busy, setBusy] = useState(false)

  const load = () => axios.get('/api/settings/ics-feeds').then(r => setFeeds(r.data.feeds)).catch(() => {})
  useEffect(() => { load() }, [])

  async function add() {
    if (!newUrl.trim()) return
    setBusy(true)
    try {
      const { data } = await axios.post('/api/settings/ics-feeds', { url: newUrl.trim() })
      toast.success(`Synced${data.name ? ` "${data.name}"` : ''} — ${data.events_found} events found`)
      setNewUrl('')
      setFeeds(data.feeds)
    } catch (e: any) {
      toast.error(e?.response?.data?.detail || 'Could not add that calendar')
    } finally { setBusy(false) }
  }

  async function remove(url: string) {
    if (!confirm('Stop showing this synced calendar? (Nothing is deleted on Google/Outlook.)')) return
    try {
      const { data } = await axios.delete('/api/settings/ics-feeds', { params: { url } })
      toast.success('Calendar removed')
      setFeeds(data.feeds)
    } catch (e: any) {
      toast.error(e?.response?.data?.detail || 'Could not remove it')
    }
  }

  return (
    <div className="space-y-2.5">
      <p className="text-surface-muted text-xs font-medium">📥 Synced calendars shown on HomeHub (Google/Outlook iCal links)</p>
      {feeds.length === 0 && <p className="text-surface-muted text-xs">None yet — paste an iCal/ICS link below.</p>}
      {feeds.map(url => (
        <div key={url} className="flex items-center gap-2 bg-surface rounded-lg px-3 py-2 group">
          <span className="text-base flex-shrink-0">📆</span>
          <code className="flex-1 text-white text-[11px] truncate" title={url}>{shortenUrl(url)}</code>
          <button onClick={() => remove(url)}
            className="text-surface-muted hover:text-red-400 transition-all flex-shrink-0 text-xs font-medium">
            Remove
          </button>
        </div>
      ))}
      <div className="flex gap-2">
        <input className="flex-1 bg-surface border border-surface-border rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-accent"
          placeholder="Paste iCal/ICS or webcal:// link…" value={newUrl}
          onChange={e => setNewUrl(e.target.value)} onKeyDown={e => e.key === 'Enter' && add()} />
        <button onClick={add} disabled={busy || !newUrl.trim()}
          className="px-4 py-2 bg-accent hover:bg-accent-hover text-white text-sm font-medium rounded-lg transition-all disabled:opacity-50">
          {busy ? 'Checking…' : 'Add'}
        </button>
      </div>
      <p className="text-surface-muted text-[10px] leading-relaxed">
        Google: calendar Settings → "Secret address in iCal format". Outlook: Settings → Shared calendars → Publish.
        Changes apply to the HomeHub calendar immediately.
      </p>
    </div>
  )
}

function CalendarFeedSection() {
  const [path, setPath] = useState<string | null>(null)

  useEffect(() => {
    axios.get('/api/settings/calendar-feed').then(r => setPath(r.data.path)).catch(() => {})
  }, [])

  if (!path) return null
  const url = `${window.location.origin}${path}`

  return (
    <div className="bg-surface rounded-lg px-3 py-2.5 space-y-1.5">
      <p className="text-surface-muted text-xs font-medium">📤 Your HomeHub calendar as a feed (subscribe from Google/Outlook)</p>
      <div className="flex gap-2 items-center">
        <code className="flex-1 text-green-400 text-[11px] break-all bg-black/30 rounded px-2 py-1.5">{url}</code>
        <button onClick={() => { navigator.clipboard.writeText(url); toast.success('Copied') }}
          className="text-surface-muted hover:text-white transition-colors flex-shrink-0"><Copy size={14} /></button>
      </div>
      <p className="text-surface-muted text-[10px] leading-relaxed">
        Google Calendar: Other calendars → + → From URL. Outlook: Add calendar → Subscribe from web.
        Needs to be a URL they can reach (your public/Tailscale address, not localhost). Google refreshes subscribed feeds every few hours.
      </p>
    </div>
  )
}

function MaintenanceSection() {
  const [busy, setBusy] = useState(false)

  async function clearActivity() {
    if (!confirm('Clear the Recent Activity feed on the dashboard? Inventory items are NOT affected.')) return
    setBusy(true)
    try {
      const { data } = await axios.post('/api/settings/clear-activity')
      toast.success(`Cleared ${data.deleted} activity entries`)
    } catch (e: any) {
      toast.error(e?.response?.data?.detail || 'Failed to clear activity')
    } finally { setBusy(false) }
  }

  return (
    <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}
      className="bg-surface-card border border-surface-border rounded-2xl p-5 shadow-card space-y-3">
      <h3 className="text-white font-semibold text-sm">🧹 Maintenance</h3>
      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex-1 min-w-48">
          <p className="text-white text-sm">Clear Recent Activity</p>
          <p className="text-surface-muted text-xs mt-0.5">Empties the activity feed on the dashboard. Your inventory, calendar, and chores are untouched.</p>
        </div>
        <button onClick={clearActivity} disabled={busy}
          className="px-4 py-2 border border-red-500/40 text-red-400 hover:bg-red-500/10 text-sm font-medium rounded-lg transition-all disabled:opacity-50">
          {busy ? 'Clearing…' : 'Clear Activity'}
        </button>
      </div>
    </motion.div>
  )
}

function StorageSection() {
  const [status, setStatus] = useState<any>(null)
  const [dataPath, setDataPath] = useState('')
  const [backupPath, setBackupPath] = useState('')
  const [cmds, setCmds] = useState<{ commands: string[]; note: string } | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    axios.get('/api/settings/setup/status').then(r => {
      setStatus(r.data)
      setDataPath(r.data.data_path || '')
      setBackupPath(r.data.backup_path || '')
    }).catch(() => {})
  }, [])

  async function save() {
    setBusy(true)
    try {
      const { data } = await axios.post('/api/settings/storage', {
        data_path: dataPath.trim(), backup_path: backupPath.trim(),
      })
      setCmds({ commands: data.commands, note: data.note })
      toast.success('Saved to .env')
    } catch (e: any) {
      toast.error(e?.response?.data?.detail || 'Failed to save')
    } finally { setBusy(false) }
  }

  if (!status) return null

  return (
    <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}
      className="bg-surface-card border border-surface-border rounded-2xl p-5 shadow-card space-y-4">
      <h3 className="text-white font-semibold text-sm flex items-center gap-2">
        <Database size={15} className="text-accent" /> Storage
      </h3>
      {status.env_file_writable ? (
        <>
          <p className="text-surface-muted text-xs leading-relaxed">
            Any folder on the machine running Docker works — including NAS folders
            (e.g. <span className="font-mono text-white">/volume1/docker/homehub</span> when HomeHub runs on the NAS).
            Changes are written to <span className="font-mono text-white">.env</span> and take effect after a restart.
            Leave blank for the defaults.
          </p>
          <StoragePathInput label="Database folder" kind="data"
            placeholder={status.data_path_display} value={dataPath}
            onChange={v => { setDataPath(v); setCmds(null) }} />
          <StoragePathInput label="Backup folder (use a different disk!)" kind="backup"
            placeholder={status.backup_path_display} value={backupPath}
            onChange={v => { setBackupPath(v); setCmds(null) }} />
          <button onClick={save} disabled={busy}
            className="w-full py-2.5 bg-accent hover:bg-accent-hover disabled:opacity-50 text-white text-sm font-medium rounded-lg transition-all">
            {busy ? 'Saving…' : 'Save Storage Paths'}
          </button>
          {cmds && (
            <div className="bg-surface rounded-lg p-3 space-y-2">
              <p className="text-orange-300 text-xs font-medium">⚠️ Saved — now run this on the Docker host:</p>
              <pre className="text-green-400 font-mono text-[11px] whitespace-pre-wrap break-all bg-black/30 rounded p-2">{cmds.commands.join('\n')}</pre>
              <p className="text-surface-muted text-[10px] leading-relaxed">{cmds.note}</p>
            </div>
          )}
        </>
      ) : (
        <div className="space-y-2 text-xs">
          <p className="text-surface-muted">Database: <span className="text-white font-mono">{status.data_path_display}</span></p>
          <p className="text-surface-muted">Backups: <span className="text-white font-mono">{status.backup_path_display}</span></p>
          <p className="text-surface-muted leading-relaxed">
            To change these, set <span className="font-mono text-white">DATA_PATH</span> / <span className="font-mono text-white">BACKUP_PATH</span> in
            <span className="font-mono text-white"> .env</span> and run <span className="font-mono text-white">docker compose up -d</span>.
          </p>
        </div>
      )}
    </motion.div>
  )
}

export default function Settings() {
  const { username } = useAuth()
  const [settings, setSettings] = useState<Setting[]>([])
  const [edits, setEdits] = useState<Record<string, string>>({})
  const [revealed, setRevealed] = useState<Record<string, boolean>>({})
  const [saving, setSaving] = useState<string | null>(null)

  const [pwForm, setPwForm] = useState({ current: '', next: '', confirm: '' })
  const [pwLoading, setPwLoading] = useState(false)
  const [showPw, setShowPw] = useState(false)

  async function load() {
    const { data } = await axios.get('/api/settings/')
    setSettings(data)
    const initial: Record<string, string> = {}
    data.forEach((s: Setting) => { if (!s.secret) initial[s.key] = s.value || '' })
    setEdits(initial)
  }

  useEffect(() => { load().catch(console.error) }, [])

  function getValue(s: Setting): string {
    if (edits[s.key] !== undefined) return edits[s.key]
    return s.value || ''
  }

  async function saveSetting(key: string) {
    setSaving(key)
    try {
      await axios.patch(`/api/settings/${key}`, { value: edits[key] ?? '' })
      toast.success('Saved')
      load()
    } catch {
      toast.error('Failed to save')
    } finally {
      setSaving(null)
    }
  }

  async function changePassword() {
    if (pwForm.next !== pwForm.confirm) return toast.error('New passwords do not match')
    if (pwForm.next.length < 6) return toast.error('Password must be at least 6 characters')
    setPwLoading(true)
    try {
      await axios.post('/api/auth/change-password', {
        current_password: pwForm.current,
        new_password: pwForm.next,
      })
      toast.success('Password changed')
      setPwForm({ current: '', next: '', confirm: '' })
    } catch (e: any) {
      toast.error(e?.response?.data?.detail || 'Failed to change password')
    } finally {
      setPwLoading(false)
    }
  }

  const settingsByKey = Object.fromEntries(settings.map(s => [s.key, s]))

  return (
    <div className="p-6 max-w-2xl space-y-8">
      <div>
        <h2 className="text-white text-2xl font-bold">Settings</h2>
        <p className="text-surface-muted text-sm mt-1">Signed in as <span className="text-white font-medium">{username}</span></p>
      </div>

      {GROUPS.map(group => (
        <motion.div key={group.label}
          initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}
          className="bg-surface-card border border-surface-border rounded-2xl p-5 shadow-card space-y-4"
        >
          <h3 className="text-white font-semibold text-sm">{group.label}</h3>
          {group.keys.map(key => {
            const s = settingsByKey[key]
            if (!s) return null
            const isSecret = s.secret

            return (
              <div key={key}>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="text-xs text-surface-muted font-medium">{LABELS[key] || key}</label>
                  {s.is_set && isSecret && (
                    <span className="text-xs text-green-400">● Set</span>
                  )}
                </div>
                <p className="text-surface-muted text-xs mb-2">{s.description}</p>
                <div className="flex gap-2">
                  <div className="relative flex-1">
                    <input
                      type={isSecret && !revealed[key] ? 'password' : 'text'}
                      className="w-full bg-surface border border-surface-border rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-accent pr-10"
                      placeholder={isSecret && s.is_set ? '••••••••  (leave blank to keep current)' : `Enter ${LABELS[key] || key}`}
                      value={isSecret ? (edits[key] ?? '') : getValue(s)}
                      onChange={e => setEdits(prev => ({ ...prev, [key]: e.target.value }))}
                    />
                    {isSecret && (
                      <button onClick={() => setRevealed(r => ({ ...r, [key]: !r[key] }))}
                        className="absolute right-2.5 top-1/2 -translate-y-1/2 text-surface-muted hover:text-white transition-colors">
                        {revealed[key] ? <EyeOff size={14} /> : <Eye size={14} />}
                      </button>
                    )}
                  </div>
                  <button
                    onClick={() => saveSetting(key)}
                    disabled={saving === key}
                    className="flex items-center gap-1.5 px-3 py-2 bg-accent hover:bg-accent-hover text-white text-xs font-medium rounded-lg transition-all disabled:opacity-50"
                  >
                    {saving === key
                      ? <RefreshCw size={13} className="animate-spin" />
                      : <Save size={13} />}
                    Save
                  </button>
                </div>
              </div>
            )
          })}
        </motion.div>
      ))}

      {/* Calendar sync — inbound feeds + outbound subscribe URL */}
      <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}
        className="bg-surface-card border border-surface-border rounded-2xl p-5 shadow-card space-y-4">
        <h3 className="text-white font-semibold text-sm">📅 Calendar Sync</h3>
        <InboundFeedsSection />
        <CalendarFeedSection />
      </motion.div>

      {/* AI Provider */}
      <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}
        className="bg-surface-card border border-surface-border rounded-2xl p-5 shadow-card space-y-4"
      >
        <h3 className="text-white font-semibold text-sm">🧠 AI Provider</h3>

        {/* Provider selector */}
        <div>
          <label className="text-xs text-surface-muted font-medium block mb-1.5">Provider</label>
          <p className="text-surface-muted text-xs mb-2">Which AI to use for natural language parsing</p>
          <div className="flex gap-2">
            <select
              className="flex-1 bg-surface border border-surface-border rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-accent"
              value={edits['llm_provider'] ?? settingsByKey['llm_provider']?.value ?? 'ollama'}
              onChange={e => setEdits(prev => ({ ...prev, llm_provider: e.target.value }))}
            >
              {PROVIDER_OPTIONS.map(o => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
            <button
              onClick={() => saveSetting('llm_provider')}
              disabled={saving === 'llm_provider'}
              className="flex items-center gap-1.5 px-3 py-2 bg-accent hover:bg-accent-hover text-white text-xs font-medium rounded-lg transition-all disabled:opacity-50"
            >
              {saving === 'llm_provider' ? <RefreshCw size={13} className="animate-spin" /> : <Save size={13} />}
              Save
            </button>
          </div>
        </div>

        {/* Provider-specific fields */}
        {(PROVIDER_FIELDS[edits['llm_provider'] ?? settingsByKey['llm_provider']?.value ?? 'ollama'] ?? []).map(key => {
          const s = settingsByKey[key]
          if (!s) return null
          const isSecret = s.secret
          const modelProvider = MODEL_KEYS[key]
          return (
            <div key={key}>
              <div className="flex items-center justify-between mb-1.5">
                <label className="text-xs text-surface-muted font-medium">{LABELS[key] || key}</label>
                {s.is_set && isSecret && <span className="text-xs text-green-400">● Set</span>}
              </div>
              <p className="text-surface-muted text-xs mb-2">{s.description}</p>
              <div className="flex gap-2">
                <div className="relative flex-1">
                  {modelProvider ? (
                    <ModelSelect provider={modelProvider} value={getValue(s)}
                      onChange={v => setEdits(prev => ({ ...prev, [key]: v }))} />
                  ) : (
                    <>
                      <input
                        type={isSecret && !revealed[key] ? 'password' : 'text'}
                        className="w-full bg-surface border border-surface-border rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-accent pr-10"
                        placeholder={isSecret && s.is_set ? '••••••••  (leave blank to keep current)' : `Enter ${LABELS[key] || key}`}
                        value={isSecret ? (edits[key] ?? '') : getValue(s)}
                        onChange={e => setEdits(prev => ({ ...prev, [key]: e.target.value }))}
                      />
                      {isSecret && (
                        <button onClick={() => setRevealed(r => ({ ...r, [key]: !r[key] }))}
                          className="absolute right-2.5 top-1/2 -translate-y-1/2 text-surface-muted hover:text-white transition-colors">
                          {revealed[key] ? <EyeOff size={14} /> : <Eye size={14} />}
                        </button>
                      )}
                    </>
                  )}
                </div>
                <button
                  onClick={() => saveSetting(key)}
                  disabled={saving === key}
                  className="flex items-center gap-1.5 px-3 py-2 bg-accent hover:bg-accent-hover text-white text-xs font-medium rounded-lg transition-all disabled:opacity-50"
                >
                  {saving === key ? <RefreshCw size={13} className="animate-spin" /> : <Save size={13} />}
                  Save
                </button>
              </div>
            </div>
          )
        })}
      </motion.div>

      {/* Storage */}
      <StorageSection />

      {/* Maintenance */}
      <MaintenanceSection />

      {/* Logins / roles */}
      <UsersSection />

      {/* Change Password */}
      <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}
        className="bg-surface-card border border-surface-border rounded-2xl p-5 shadow-card space-y-4">
        <h3 className="text-white font-semibold text-sm flex items-center gap-2">
          <KeyRound size={15} className="text-accent" /> Change Password
        </h3>
        <div className="space-y-3">
          {(['current', 'next', 'confirm'] as const).map((field, i) => (
            <div key={field}>
              <label className="text-xs text-surface-muted mb-1.5 block">
                {field === 'current' ? 'Current Password' : field === 'next' ? 'New Password' : 'Confirm New Password'}
              </label>
              <div className="relative">
                <input
                  type={showPw ? 'text' : 'password'}
                  className="w-full bg-surface border border-surface-border rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-accent pr-10"
                  value={pwForm[field]}
                  onChange={e => setPwForm(f => ({ ...f, [field]: e.target.value }))}
                  placeholder={field === 'current' ? 'Current password' : field === 'next' ? 'At least 6 characters' : 'Repeat new password'}
                />
                {i === 0 && (
                  <button onClick={() => setShowPw(v => !v)}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-surface-muted hover:text-white transition-colors">
                    {showPw ? <EyeOff size={14} /> : <Eye size={14} />}
                  </button>
                )}
              </div>
            </div>
          ))}
          <button
            onClick={changePassword}
            disabled={pwLoading || !pwForm.current || !pwForm.next || !pwForm.confirm}
            className="w-full py-2.5 bg-accent hover:bg-accent-hover disabled:opacity-50 text-white text-sm font-medium rounded-lg transition-all"
          >
            {pwLoading ? 'Updating…' : 'Update Password'}
          </button>
        </div>
      </motion.div>

      <p className="text-surface-muted text-xs text-center pb-4">
        AI provider changes apply instantly. A newly added Telegram/Discord token is picked up within ~30s;
        changing an existing token needs a bot restart (<span className="font-mono">docker compose restart telegram</span>).
      </p>
    </div>
  )
}
