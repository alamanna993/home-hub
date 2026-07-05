import { useState } from 'react'
import { CheckCircle2, AlertTriangle, XCircle, RefreshCw, Wifi } from 'lucide-react'
import axios from 'axios'

interface Msg { level: 'ok' | 'warning' | 'error'; text: string }

interface Props {
  label: string
  placeholder?: string
  value: string
  kind: 'data' | 'backup'
  onChange: (v: string) => void
}

export default function StoragePathInput({ label, placeholder, value, kind, onChange }: Props) {
  const [testing, setTesting] = useState(false)
  const [messages, setMessages] = useState<Msg[] | null>(null)

  async function test() {
    setTesting(true)
    setMessages(null)
    try {
      const { data } = await axios.post('/api/settings/storage/test', { path: value, kind })
      setMessages(data.messages)
    } catch {
      setMessages([{ level: 'error', text: 'Test request failed — is the backend running?' }])
    } finally {
      setTesting(false)
    }
  }

  const icons = {
    ok: <CheckCircle2 size={13} className="text-green-400 flex-shrink-0 mt-0.5" />,
    warning: <AlertTriangle size={13} className="text-orange-400 flex-shrink-0 mt-0.5" />,
    error: <XCircle size={13} className="text-red-400 flex-shrink-0 mt-0.5" />,
  }
  const colors = { ok: 'text-green-400', warning: 'text-orange-300', error: 'text-red-400' }

  return (
    <div>
      <label className="text-xs text-surface-muted mb-1 block">{label}</label>
      <div className="flex gap-2">
        <input
          className="flex-1 bg-surface border border-surface-border rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-accent"
          placeholder={placeholder} value={value}
          onChange={e => { onChange(e.target.value); setMessages(null) }}
        />
        <button type="button" onClick={test} disabled={testing}
          title="Check this path (format, NAS reachability)"
          className="flex items-center gap-1.5 px-3 py-2 border border-surface-border hover:border-accent text-surface-muted hover:text-white text-xs rounded-lg transition-all disabled:opacity-50 flex-shrink-0">
          {testing ? <RefreshCw size={13} className="animate-spin" /> : <Wifi size={13} />} Test
        </button>
      </div>
      {messages && (
        <div className="mt-2 space-y-1.5 bg-surface rounded-lg px-3 py-2.5">
          {messages.map((m, i) => (
            <div key={i} className="flex items-start gap-2">
              {icons[m.level]}
              <span className={`text-[11px] leading-relaxed ${colors[m.level]}`}>{m.text}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
