import { useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import { Plus, Trash2 } from 'lucide-react'
import { getCategories, createCategory, Category } from '../lib/api'
import axios from 'axios'
import toast from 'react-hot-toast'

const COLORS = ['#6366f1','#22c55e','#3b82f6','#f59e0b','#ec4899','#8b5cf6','#06b6d4','#84cc16','#ef4444']

export default function Categories() {
  const [cats, setCats] = useState<Category[]>([])
  const [name, setName] = useState(''); const [icon, setIcon] = useState('📦'); const [color, setColor] = useState(COLORS[0])

  const load = () => getCategories().then(setCats)
  useEffect(() => { load() }, [])

  async function add() {
    if (!name.trim()) return
    await createCategory({ name: name.trim(), icon, color })
    setName(''); toast.success('Category added'); load()
  }

  async function remove(id: number) {
    await axios.delete(`/api/categories/${id}`)
    toast.success('Category removed'); load()
  }

  return (
    <div className="p-6 space-y-5">
      <div>
        <h2 className="text-white text-2xl font-bold">Categories</h2>
        <p className="text-surface-muted text-sm mt-1">Organize your inventory by type</p>
      </div>

      <div className="bg-surface-card border border-surface-border rounded-2xl p-4 flex gap-3 flex-wrap items-end">
        <div>
          <label className="text-xs text-surface-muted mb-1 block">Icon</label>
          <input className="w-16 bg-surface border border-surface-border rounded-lg px-2 py-2 text-white text-xl text-center focus:outline-none focus:border-accent"
            value={icon} onChange={e => setIcon(e.target.value)} />
        </div>
        <div className="flex-1 min-w-32">
          <label className="text-xs text-surface-muted mb-1 block">Name</label>
          <input className="w-full bg-surface border border-surface-border rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-accent"
            placeholder="e.g. Groceries" value={name} onChange={e => setName(e.target.value)} />
        </div>
        <div>
          <label className="text-xs text-surface-muted mb-1 block">Color</label>
          <div className="flex gap-1.5">
            {COLORS.map(c => (
              <button key={c} onClick={() => setColor(c)}
                className={`w-6 h-6 rounded-full border-2 transition-all ${color === c ? 'border-white scale-110' : 'border-transparent'}`}
                style={{ background: c }} />
            ))}
          </div>
        </div>
        <button onClick={add} disabled={!name.trim()}
          className="flex items-center gap-2 bg-accent hover:bg-accent-hover text-white text-sm font-medium px-4 py-2 rounded-lg transition-all disabled:opacity-50">
          <Plus size={15} /> Add
        </button>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
        {cats.map((cat, i) => (
          <motion.div key={cat.id} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.04 }}
            className="bg-surface-card border border-surface-border rounded-2xl p-4 flex items-center gap-3 shadow-card group">
            <div className="w-10 h-10 rounded-xl flex items-center justify-center text-xl flex-shrink-0"
              style={{ background: `${cat.color || '#6366f1'}22` }}>
              {cat.icon || '📦'}
            </div>
            <div className="flex-1">
              <p className="text-white font-medium text-sm">{cat.name}</p>
            </div>
            <div className="w-3 h-3 rounded-full flex-shrink-0" style={{ background: cat.color || '#6366f1' }} />
            <button onClick={() => remove(cat.id)}
              className="opacity-0 group-hover:opacity-100 text-surface-muted hover:text-red-400 transition-all ml-1">
              <Trash2 size={15} />
            </button>
          </motion.div>
        ))}
      </div>
    </div>
  )
}
