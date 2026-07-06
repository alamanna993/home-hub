import { useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import { Plus, MapPin, Trash2, Pencil, Check, X } from 'lucide-react'
import { getLocations, createLocation, updateLocation, Location } from '../lib/api'
import EmojiPicker from '../components/EmojiPicker'
import axios from 'axios'
import toast from 'react-hot-toast'

export default function Locations() {
  const [locations, setLocations] = useState<Location[]>([])
  const [name, setName] = useState(''); const [sub, setSub] = useState('')
  const [icon, setIcon] = useState('📍')
  const [adding, setAdding] = useState(false)
  const [editingId, setEditingId] = useState<number | null>(null)
  const [editForm, setEditForm] = useState({ name: '', sublocation: '', icon: '' })

  const load = () => getLocations().then(setLocations)
  useEffect(() => { load() }, [])

  async function add() {
    if (!name.trim()) return
    setAdding(true)
    try {
      await createLocation({ name: name.trim(), sublocation: sub.trim() || undefined, icon })
      setName(''); setSub(''); toast.success('Location added'); load()
    } finally { setAdding(false) }
  }

  async function remove(id: number) {
    await axios.delete(`/api/locations/${id}`)
    toast.success('Location removed'); load()
  }

  function startEdit(loc: Location) {
    setEditingId(loc.id)
    setEditForm({ name: loc.name, sublocation: loc.sublocation || '', icon: loc.icon || '📍' })
  }

  async function saveEdit(id: number) {
    if (!editForm.name.trim()) return toast.error('Name is required')
    await updateLocation(id, { name: editForm.name.trim(), sublocation: editForm.sublocation.trim(), icon: editForm.icon })
    toast.success('Location updated')
    setEditingId(null)
    load()
  }

  return (
    <div className="p-6 space-y-5">
      <div>
        <h2 className="text-white text-2xl font-bold">Locations</h2>
        <p className="text-surface-muted text-sm mt-1">Rooms and spots in your home</p>
      </div>

      <div className="bg-surface-card border border-surface-border rounded-2xl p-4 flex gap-3 flex-wrap">
        <EmojiPicker value={icon} onChange={setIcon} />
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
            {editingId === loc.id ? (
              <EmojiPicker value={editForm.icon} onChange={v => setEditForm(f => ({ ...f, icon: v }))}
                buttonClassName="w-10 h-10 bg-surface border border-accent/50 rounded-xl text-xl hover:border-accent transition-all flex items-center justify-center flex-shrink-0" />
            ) : (
              <div className="w-10 h-10 rounded-xl bg-accent/10 flex items-center justify-center flex-shrink-0 text-xl">
                {loc.icon || <MapPin size={18} className="text-accent" />}
              </div>
            )}
            {editingId === loc.id ? (
              <div className="flex-1 min-w-0 space-y-1.5">
                <input autoFocus className="w-full bg-surface border border-accent/50 rounded-lg px-2 py-1 text-white text-sm focus:outline-none focus:border-accent"
                  value={editForm.name} onChange={e => setEditForm(f => ({ ...f, name: e.target.value }))}
                  onKeyDown={e => { if (e.key === 'Enter') saveEdit(loc.id); if (e.key === 'Escape') setEditingId(null) }} />
                <input className="w-full bg-surface border border-surface-border rounded-lg px-2 py-1 text-white text-xs focus:outline-none focus:border-accent"
                  placeholder="Sub-location (optional)" value={editForm.sublocation}
                  onChange={e => setEditForm(f => ({ ...f, sublocation: e.target.value }))}
                  onKeyDown={e => { if (e.key === 'Enter') saveEdit(loc.id); if (e.key === 'Escape') setEditingId(null) }} />
              </div>
            ) : (
              <div className="flex-1 min-w-0">
                <p className="text-white font-medium text-sm">{loc.name}</p>
                {loc.sublocation && <p className="text-surface-muted text-xs">{loc.sublocation}</p>}
                <p className="text-surface-muted text-xs mt-0.5">{loc.item_count} items</p>
              </div>
            )}
            {editingId === loc.id ? (
              <div className="flex flex-col gap-1.5">
                <button onClick={() => saveEdit(loc.id)} className="text-green-400 hover:text-green-300 transition-all">
                  <Check size={16} />
                </button>
                <button onClick={() => setEditingId(null)} className="text-surface-muted hover:text-white transition-all">
                  <X size={16} />
                </button>
              </div>
            ) : (
              <div className="flex flex-col gap-1 opacity-100 lg:opacity-0 lg:group-hover:opacity-100 transition-all">
                <button onClick={() => startEdit(loc)} className="p-2 -m-1 text-surface-muted hover:text-accent">
                  <Pencil size={14} />
                </button>
                <button onClick={() => remove(loc.id)} className="p-2 -m-1 text-surface-muted hover:text-red-400">
                  <Trash2 size={14} />
                </button>
              </div>
            )}
          </motion.div>
        ))}
      </div>
    </div>
  )
}
