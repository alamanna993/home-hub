import { useEffect, useState, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Plus, Search, Trash2, Edit2, AlertTriangle } from 'lucide-react'
import { getItems, getCategories, getLocations, deleteItem, Item, Category, Location } from '../lib/api'
import ItemModal from '../components/ItemModal'
import toast from 'react-hot-toast'

export default function Inventory() {
  const [items, setItems] = useState<Item[]>([])
  const [categories, setCategories] = useState<Category[]>([])
  const [locations, setLocations] = useState<Location[]>([])
  const [search, setSearch] = useState('')
  const [catFilter, setCatFilter] = useState('')
  const [editItem, setEditItem] = useState<Item | null | undefined>(undefined)
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    try {
      const params: Record<string, unknown> = {}
      if (search) params.search = search
      if (catFilter) params.category_id = catFilter
      const [i, c, l] = await Promise.all([getItems(params), getCategories(), getLocations()])
      setItems(i); setCategories(c); setLocations(l)
    } catch {
      toast.error('Could not load inventory — is the backend running?')
    } finally {
      setLoading(false)
    }
  }, [search, catFilter])

  useEffect(() => { load() }, [load])

  async function handleDelete(item: Item) {
    if (!confirm(`Delete "${item.name}"?`)) return
    await deleteItem(item.id)
    toast.success('Item deleted')
    load()
  }

  return (
    <div className="p-6 space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-white text-2xl font-bold">Inventory</h2>
          <p className="text-surface-muted text-sm mt-1">{items.length} items tracked</p>
        </div>
        <button onClick={() => setEditItem(null)}
          className="flex items-center gap-2 bg-accent hover:bg-accent-hover text-white text-sm font-medium px-4 py-2 rounded-lg transition-all shadow-glow">
          <Plus size={16} /> Add Item
        </button>
      </div>

      {/* Filters */}
      <div className="flex gap-3 flex-wrap">
        <div className="relative flex-1 min-w-48">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-surface-muted" />
          <input className="w-full bg-surface-card border border-surface-border rounded-lg pl-9 pr-3 py-2 text-white text-sm focus:outline-none focus:border-accent"
            placeholder="Search items…" value={search} onChange={e => setSearch(e.target.value)} />
        </div>
        <select className="bg-surface-card border border-surface-border rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-accent"
          value={catFilter} onChange={e => setCatFilter(e.target.value)}>
          <option value="">All Categories</option>
          {categories.map(c => <option key={c.id} value={c.id}>{c.icon} {c.name}</option>)}
        </select>
      </div>

      {/* Items Grid */}
      {loading ? (
        <div className="flex justify-center py-16">
          <div className="w-8 h-8 border-2 border-accent border-t-transparent rounded-full animate-spin" />
        </div>
      ) : items.length === 0 ? (
        <div className="text-center py-16 text-surface-muted">
          <p className="text-4xl mb-3">📭</p>
          <p className="text-sm">No items found. Add one or text the bot!</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
          <AnimatePresence>
            {items.map((item, i) => (
              <motion.div key={item.id}
                initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.03 }}
                className={`bg-surface-card border rounded-2xl p-4 shadow-card group relative ${
                  item.is_low_stock ? 'border-orange-500/40' : 'border-surface-border'
                }`}
              >
                {item.is_low_stock && (
                  <div className="absolute top-3 right-3">
                    <AlertTriangle size={14} className="text-orange-400" />
                  </div>
                )}
                <div className="flex items-start gap-3 mb-3">
                  <div className="w-9 h-9 rounded-xl flex items-center justify-center text-lg flex-shrink-0"
                    style={{ background: `${item.category?.color || '#6366f1'}22` }}>
                    {item.category?.icon || '📦'}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-white font-medium text-sm leading-snug truncate">{item.name}</p>
                    {item.author && <p className="text-surface-muted text-xs italic truncate">by {item.author}</p>}
                    {item.category && <p className="text-surface-muted text-xs">{item.category.name}</p>}
                  </div>
                </div>
                <div className="space-y-1.5 text-xs text-surface-muted">
                  {item.location && (
                    <p>📍 {item.location.name}{item.location.sublocation ? ` — ${item.location.sublocation}` : ''}</p>
                  )}
                  <p>
                    📦 Qty: <span className={`font-medium ${item.is_low_stock ? 'text-orange-400' : 'text-white'}`}>
                      {item.quantity ?? '—'} {item.unit || ''}
                    </span>
                    {item.low_stock_threshold != null && (
                      <span className="ml-1 text-surface-muted">(alert ≤{item.low_stock_threshold})</span>
                    )}
                  </p>
                  {item.notes && <p className="text-surface-muted truncate">💬 {item.notes}</p>}
                </div>
                <div className="flex gap-2 mt-3 opacity-0 group-hover:opacity-100 transition-opacity">
                  <button onClick={() => setEditItem(item)}
                    className="flex-1 flex items-center justify-center gap-1.5 text-xs py-1.5 rounded-lg border border-surface-border text-surface-muted hover:text-white hover:border-accent transition-all">
                    <Edit2 size={12} /> Edit
                  </button>
                  <button onClick={() => handleDelete(item)}
                    className="flex-1 flex items-center justify-center gap-1.5 text-xs py-1.5 rounded-lg border border-surface-border text-surface-muted hover:text-red-400 hover:border-red-500/40 transition-all">
                    <Trash2 size={12} /> Delete
                  </button>
                </div>
              </motion.div>
            ))}
          </AnimatePresence>
        </div>
      )}

      {editItem !== undefined && (
        <ItemModal
          item={editItem}
          categories={categories}
          locations={locations}
          onClose={() => setEditItem(undefined)}
          onSaved={load}
        />
      )}
    </div>
  )
}
