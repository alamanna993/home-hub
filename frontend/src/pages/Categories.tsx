import { useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import { Plus, Trash2, Pencil, Check, X } from 'lucide-react'
import { getCategories, createCategory, updateCategory, Category } from '../lib/api'
import EmojiPicker from '../components/EmojiPicker'
import axios from 'axios'
import toast from 'react-hot-toast'

const COLORS = ['#6366f1','#22c55e','#3b82f6','#f59e0b','#ec4899','#8b5cf6','#06b6d4','#84cc16','#ef4444']

export default function Categories() {
  const [cats, setCats] = useState<Category[]>([])
  const [name, setName] = useState(''); const [icon, setIcon] = useState('📦'); const [color, setColor] = useState(COLORS[0])
  const [editingId, setEditingId] = useState<number | null>(null)
  const [edit, setEdit] = useState({ name: '', icon: '', color: '' })

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

  function startEdit(cat: Category) {
    setEditingId(cat.id)
    setEdit({ name: cat.name, icon: cat.icon || '📦', color: cat.color || COLORS[0] })
  }

  async function saveEdit(id: number) {
    if (!edit.name.trim()) return toast.error('Name is required')
    await updateCategory(id, { name: edit.name.trim(), icon: edit.icon, color: edit.color })
    toast.success('Category updated')
    setEditingId(null)
    load()
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
          <EmojiPicker value={icon} onChange={setIcon} />
        </div>
        <div className="flex-1 min-w-32">
          <label className="text-xs text-surface-muted mb-1 block">Name</label>
          <input className="w-full bg-surface border border-surface-border rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-accent"
            placeholder="e.g. Groceries" value={name} onChange={e => setName(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && add()} />
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
            className="bg-surface-card border border-surface-border rounded-2xl p-4 shadow-card group">
            {editingId === cat.id ? (
              <div className="space-y-2.5">
                <div className="flex items-center gap-2">
                  <EmojiPicker value={edit.icon} onChange={v => setEdit(f => ({ ...f, icon: v }))}
                    buttonClassName="w-10 h-10 bg-surface border border-accent/50 rounded-xl text-xl hover:border-accent transition-all flex items-center justify-center flex-shrink-0" />
                  <input autoFocus className="flex-1 min-w-0 bg-surface border border-accent/50 rounded-lg px-2.5 py-2 text-white text-sm focus:outline-none focus:border-accent"
                    value={edit.name} onChange={e => setEdit(f => ({ ...f, name: e.target.value }))}
                    onKeyDown={e => { if (e.key === 'Enter') saveEdit(cat.id); if (e.key === 'Escape') setEditingId(null) }} />
                </div>
                <div className="flex items-center gap-1.5 flex-wrap">
                  {COLORS.map(c => (
                    <button key={c} onClick={() => setEdit(f => ({ ...f, color: c }))}
                      className={`w-5 h-5 rounded-full border-2 transition-all ${edit.color === c ? 'border-white scale-110' : 'border-transparent'}`}
                      style={{ background: c }} />
                  ))}
                  <div className="ml-auto flex gap-1.5">
                    <button onClick={() => saveEdit(cat.id)} className="text-green-400 hover:text-green-300"><Check size={17} /></button>
                    <button onClick={() => setEditingId(null)} className="text-surface-muted hover:text-white"><X size={17} /></button>
                  </div>
                </div>
              </div>
            ) : (
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl flex items-center justify-center text-xl flex-shrink-0"
                  style={{ background: `${cat.color || '#6366f1'}22` }}>
                  {cat.icon || '📦'}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-white font-medium text-sm truncate">{cat.name}</p>
                </div>
                <div className="w-3 h-3 rounded-full flex-shrink-0" style={{ background: cat.color || '#6366f1' }} />
                <div className="flex gap-1.5 opacity-0 group-hover:opacity-100 transition-all ml-1">
                  <button onClick={() => startEdit(cat)} className="text-surface-muted hover:text-accent">
                    <Pencil size={14} />
                  </button>
                  <button onClick={() => remove(cat.id)} className="text-surface-muted hover:text-red-400">
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>
            )}
          </motion.div>
        ))}
      </div>
    </div>
  )
}
