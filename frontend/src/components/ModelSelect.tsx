import { useEffect, useState } from 'react'
import { RefreshCw } from 'lucide-react'
import axios from 'axios'

interface Props {
  provider: string
  value: string
  onChange: (v: string) => void
  className?: string
  refreshKey?: number   // bump to force a reload (e.g. after downloading a model)
}

const CUSTOM = '__custom__'

export default function ModelSelect({ provider, value, onChange, className, refreshKey }: Props) {
  const [models, setModels] = useState<string[]>([])
  const [source, setSource] = useState<'live' | 'static'>('static')
  const [loading, setLoading] = useState(false)
  const [custom, setCustom] = useState(false)

  async function load() {
    setLoading(true)
    try {
      const { data } = await axios.get(`/api/settings/models?provider=${provider}`)
      setModels(data.models || [])
      setSource(data.source || 'static')
      setCustom(Boolean(value) && data.models?.length > 0 && !data.models.includes(value))
    } catch {
      setModels([])
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [provider, refreshKey])

  const inputCls = className || 'w-full bg-surface border border-surface-border rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-accent'

  if (custom || models.length === 0) {
    return (
      <div className="flex gap-2">
        <input className={inputCls} placeholder="Model name" value={value} onChange={e => onChange(e.target.value)} />
        {models.length > 0 && (
          <button type="button" onClick={() => setCustom(false)}
            className="text-xs text-surface-muted hover:text-white whitespace-nowrap px-2 transition-colors">
            pick from list
          </button>
        )}
        <button type="button" onClick={load} title="Refresh model list"
          className="text-surface-muted hover:text-white px-1 transition-colors">
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
        </button>
      </div>
    )
  }

  return (
    <div className="flex gap-2 items-center">
      <select
        className={inputCls}
        value={models.includes(value) ? value : ''}
        onChange={e => {
          if (e.target.value === CUSTOM) { setCustom(true); return }
          onChange(e.target.value)
        }}
      >
        <option value="" disabled>— Choose a model —</option>
        {models.map(m => <option key={m} value={m}>{m}</option>)}
        <option value={CUSTOM}>Custom…</option>
      </select>
      <button type="button" onClick={load} title="Refresh model list"
        className="text-surface-muted hover:text-white px-1 transition-colors flex-shrink-0">
        <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
      </button>
      {source === 'live' && <span className="text-[10px] text-green-400 flex-shrink-0">● live</span>}
    </div>
  )
}
