import { useState } from 'react'
import { AlertTriangle, CheckCircle2, Wifi, XCircle } from 'lucide-react'
import axios from 'axios'
import { Button, Field, Input } from './ui'
import { cn } from '../lib/utils'

interface Msg { level: 'ok' | 'warning' | 'error'; text: string }

interface Props {
  label: string
  placeholder?: string
  value: string
  kind: 'data' | 'backup'
  onChange: (v: string) => void
}

const ICONS = { ok: CheckCircle2, warning: AlertTriangle, error: XCircle }
const TONES = { ok: 'text-muted', warning: 'text-warn', error: 'text-danger' }

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
      setMessages([{ level: 'error', text: "The check didn't run. Is the backend up?" }])
    } finally {
      setTesting(false)
    }
  }

  return (
    <div>
      <div className="flex items-end gap-2">
        <Field label={label} className="flex-1">
          <Input placeholder={placeholder} value={value} onChange={e => { onChange(e.target.value); setMessages(null) }} />
        </Field>
        <Button icon={Wifi} loading={testing} onClick={test} title="Check the path format and whether the NAS is reachable">Check</Button>
      </div>
      {messages && (
        <ul className="mt-2 space-y-1.5 rounded-control border border-line bg-canvas px-3 py-2.5">
          {messages.map((m, i) => {
            const Icon = ICONS[m.level]
            return (
              <li key={i} className={cn('flex items-start gap-2 text-ui', TONES[m.level])}>
                <Icon size={14} className={cn('mt-0.5 shrink-0', m.level === 'ok' && 'text-action')} aria-hidden />
                {m.text}
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
