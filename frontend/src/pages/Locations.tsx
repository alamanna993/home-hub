import { useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import { Plus, MapPin, Trash2 } from 'lucide-react'
import { getLocations, createLocation, Location } from '../lib/api'
import axios from 'axios'
import toast from 'react-hot-toast'

export default function Locations() {
  const [locations, setLocations] = useState<Location[]>([])
  const [name, setName] = useState(''); const [sub, setSub] = useState('')
  const [adding, setAdding] = useState(false)

  const load = () => getLocations().then(setLocations)
  useEffect(() => { load() }, [])

  async function add() {
    if (!name.trim()) return
    setAdding(true)
    try {
      await createLocation({ name: name.trim(), sublocation: sub.trim() || undefined })
      setName(''); setSub(''); toast.success('Location added'); load()
    } finally { setAdding(false) }
  }

  async function remove(id: number) {
    await axios.delete(`/api/locations/${id}`)
    toast.success('Location removed'); load()
  }

  return (
    <div className="p-6 space-y-5">
      <div>
        <h2 className="text-white text-2xl font-bold">Locations</h2>
        <p className="text-surface-muted text-sm mt-1">Rooms and spots in your home</p>
      </div>

      <div className="bg-surface-card border border-surface-border rounded-2xl p-4 flex gap-3 flex-wrap">
        <input className="flex-1 min-w-32 bg-surface border border-surface-border rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-accent"
          placeholder="Room (e.g. Kitchen)" value={name} onChange={e => setName(e.target.value)} />
        <input className="flex-1 min-w-32 bg-surface border border-surface-border rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-accent"
          placeholder="Sub-location (e.g. Pantry Shelf 1)" value={sub} onChange={e => setSub(e.target.value)} />
        <button onClick={add} disabled={adding || !name.trim()}
          className="flex items-center gap-2 bg-accent hover:bg-accent-hover text-white text-sm font-medium px-4 py-2 rounded-lg transition-all disabled:opacity-50">
          <Plus size={15} /> Add
        </button>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
        {locations.map((loc, i) => (
          <motion.div key={loc.id} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.04 }}
            className="bg-surface-card border border-surface-border rounded-2xl p-4 flex items-center gap-3 shadow-card group">
            <div className="w-10 h-10 rounded-xl bg-accent/10 flex items-center justify-center flex-shrink-0">
              <MapPin size={18} className="text-accent" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-white font-medium text-sm">{loc.name}</p>
              {loc.sublocation && <p className="text-surface-muted text-xs">{loc.sublocation}</p>}
              <p className="text-surface-muted text-xs mt-0.5">{loc.item_count} items</p>
            </div>
            <button onClick={() => remove(loc.id)}
              className="opacity-0 group-hover:opacity-100 text-surface-muted hover:text-red-400 transition-all">
              <Trash2 size={15} />
            </button>
          </motion.div>
        ))}
      </div>
    </div>
  )
}
