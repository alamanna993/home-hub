import { useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import { Save, Eye, EyeOff, KeyRound, RefreshCw } from 'lucide-react'
import axios from 'axios'
import toast from 'react-hot-toast'
import { useAuth } from '../hooks/useAuth'

interface Setting {
  key: string
  value: string
  description: string
  secret: boolean
  is_set: boolean
}

const LABELS: Record<string, string> = {
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
]

const PROVIDER_FIELDS: Record<string, string[]> = {
  ollama: ['ollama_host', 'ollama_model'],
  lmstudio: ['lmstudio_host', 'lmstudio_model'],
  openai: ['openai_api_key', 'openai_model'],
  claude: ['anthropic_api_key', 'claude_model'],
}

const GROUPS = [
  { label: '🤖 Discord', keys: ['discord_token', 'discord_channel_id', 'low_stock_alert_channel'] },
  { label: '🎨 Dashboard', keys: ['site_title'] },
]

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
          return (
            <div key={key}>
              <div className="flex items-center justify-between mb-1.5">
                <label className="text-xs text-surface-muted font-medium">{LABELS[key] || key}</label>
                {s.is_set && isSecret && <span className="text-xs text-green-400">● Set</span>}
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
                  {saving === key ? <RefreshCw size={13} className="animate-spin" /> : <Save size={13} />}
                  Save
                </button>
              </div>
            </div>
          )
        })}
      </motion.div>

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
        Changes to Discord and Ollama settings take effect when the bot next restarts.
      </p>
    </div>
  )
}
