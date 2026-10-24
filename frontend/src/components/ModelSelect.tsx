import { useEffect, useState } from 'react'
import { RefreshCw } from 'lucide-react'
import axios from 'axios'
import { Badge, IconButton, Input, Select } from './ui'

interface Props {
  provider: string
  value: string
  onChange: (v: string) => void
  /** Shown when the list is empty and the field is blank, e.g. "Codex default" */
  placeholder?: string
  id?: string
  refreshKey?: number   // bump to force a reload (e.g. after downloading a model)
}

const CUSTOM = '__custom__'

export default function ModelSelect({ provider, value, onChange, placeholder = 'Model name', id, refreshKey }: Props) {
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

  const refresh = (
    <IconButton icon={RefreshCw} label="Refresh model list" onClick={load}
      className={loading ? '[&_svg]:animate-spin' : undefined} />
  )

  if (custom || models.length === 0) {
    return (
      <div className="flex items-center gap-1">
        <Input id={id} placeholder={placeholder} value={value} onChange={e => onChange(e.target.value)} className="flex-1" />
        {models.length > 0 && (
          <button type="button" onClick={() => setCustom(false)}
            className="whitespace-nowrap px-2 text-ui text-action hover:underline">Pick from list</button>
        )}
        {refresh}
      </div>
    )
  }

  return (
    <div className="flex items-center gap-1">
      <Select id={id} className="flex-1" value={models.includes(value) ? value : ''}
        onChange={e => {
          if (e.target.value === CUSTOM) { setCustom(true); return }
          onChange(e.target.value)
        }}>
        <option value="" disabled>Choose a model</option>
        {models.map(m => <option key={m} value={m}>{m}</option>)}
        <option value={CUSTOM}>Type a name instead…</option>
      </Select>
      {refresh}
      {source === 'live' && <Badge className="ml-1">Live list</Badge>}
    </div>
  )
}
