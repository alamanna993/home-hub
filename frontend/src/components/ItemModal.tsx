import { useState, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { X } from 'lucide-react'
import { Item, Category, Location, createItem, updateItem, createLocation, createCategory } from '../lib/api'
import toast from 'react-hot-toast'

const NEW = '__new__'

interface Props {
  item?: Item | null
  categories: Category[]
  locations: Location[]
  onClose: () => void
  onSaved: () => void
}

export default function ItemModal({ item, categories, locations, onClose, onSaved }: Props) {
  const [form, setForm] = useState({
    name: '', quantity: '', unit: '', notes: '', author: '',
    track_stock: false, low_stock_threshold: '', location_id: '', category_id: '',
  })
  const [newLoc, setNewLoc] = useState({ name: '', sublocation: '' })
  const [newCat, setNewCat] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (item) {
      setForm({
        name: item.name, quantity: String(item.quantity ?? ''),
        unit: item.unit ?? '', notes: item.notes ?? '', author: item.author ?? '',
        track_stock: Boolean(item.track_stock),
        low_stock_threshold: String(item.low_stock_threshold ?? ''),
        location_id: String(item.location?.id ?? ''),
        category_id: String(item.category?.id ?? ''),
      })
    }
  }, [item])

  const set = (k: string, v: string) => setForm(f => ({ ...f, [k]: v }))

  // Show the author field for book/media-ish categories (including one being created inline)
  const selectedCatName = form.category_id === NEW
    ? newCat
    : categories.find(c => String(c.id) === form.category_id)?.name || ''
  const showAuthor = /book|media|dvd|vinyl|comic|magazine/i.test(selectedCatName) || Boolean(form.author)
  const selectedLocName = form.location_id === NEW
    ? newLoc.name
    : locations.find(l => String(l.id) === form.location_id)?.name || ''
  const isGrocery = /grocer|food|produce|cleaning|laundry/i.test(selectedCatName) || /laundry/i.test(selectedLocName)
  const tracking = isGrocery || form.track_stock

  async function save() {
    if (!form.name.trim()) return toast.error('Name is required')
    if (form.location_id === NEW && !newLoc.name.trim()) return toast.error('New location needs a name')
    if (form.category_id === NEW && !newCat.trim()) return toast.error('New category needs a name')
    setSaving(true)
    try {
      let locationId = form.location_id
      if (locationId === NEW) {
        const loc = await createLocation({ name: newLoc.name.trim(), sublocation: newLoc.sublocation.trim() || undefined })
        locationId = String(loc.id)
      }
      let categoryId = form.category_id
      if (categoryId === NEW) {
        const cat = await createCategory({ name: newCat.trim() })
        categoryId = String(cat.id)
      }
      const payload = {
        name: form.name,
        quantity: form.quantity ? parseFloat(form.quantity) : undefined,
        unit: form.unit || undefined,
        author: form.author.trim() || undefined,
        notes: form.notes || undefined,
        track_stock: isGrocery ? true : form.track_stock,
        low_stock_threshold: tracking && form.low_stock_threshold ? parseFloat(form.low_stock_threshold) : undefined,
        location_id: locationId ? parseInt(locationId) : undefined,
        category_id: categoryId ? parseInt(categoryId) : undefined,
      }
      if (item) await updateItem(item.id, payload)
      else await createItem(payload)
      toast.success(item ? 'Item updated' : 'Item added')
      onSaved()
      onClose()
    } catch {
      toast.error('Failed to save item')
    } finally {
      setSaving(false)
    }
  }

  return (
    <AnimatePresence>
      <motion.div
        className="fixed inset-0 z-50 flex items-center justify-center p-4"
        initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      >
        <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
        <motion.div
          className="relative bg-surface-card border border-surface-border rounded-2xl shadow-card w-full max-w-md p-6"
          initial={{ scale: 0.95, y: 20 }} animate={{ scale: 1, y: 0 }}
        >
          <div className="flex items-center justify-between mb-5">
            <h2 className="text-white font-semibold text-lg">{item ? 'Edit Item' : 'Add Item'}</h2>
            <button onClick={onClose} className="text-surface-muted hover:text-white transition-colors">
              <X size={18} />
            </button>
          </div>

          <div className="space-y-3">
            <div>
              <label className="text-xs text-surface-muted mb-1 block">Name *</label>
              <input
                className="w-full bg-surface border border-surface-border rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-accent"
                value={form.name} onChange={e => set('name', e.target.value)} placeholder="e.g. Pasta, Drill, Router"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-surface-muted mb-1 block">Quantity</label>
                <input type="number" className="w-full bg-surface border border-surface-border rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-accent"
                  value={form.quantity} onChange={e => set('quantity', e.target.value)} placeholder="1" />
              </div>
              <div>
                <label className="text-xs text-surface-muted mb-1 block">Unit</label>
                <input className="w-full bg-surface border border-surface-border rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-accent"
                  value={form.unit} onChange={e => set('unit', e.target.value)} placeholder="boxes, lbs, ea" />
              </div>
            </div>
            <div className="bg-surface rounded-lg px-3 py-2.5 space-y-2">
              <label className={`flex items-center gap-2.5 text-sm ${isGrocery ? 'text-surface-muted' : 'text-white cursor-pointer'}`}>
                <input type="checkbox" className="w-4 h-4 accent-indigo-500"
                  checked={tracking} disabled={isGrocery}
                  onChange={e => setForm(f => ({ ...f, track_stock: e.target.checked }))} />
                Track stock level
                {isGrocery && <span className="text-[10px] text-green-400 ml-auto">always on for consumables</span>}
              </label>
              {tracking && (
                <div>
                  <label className="text-xs text-surface-muted mb-1 block">Alert when quantity is at or below</label>
                  <input type="number" className="w-full bg-surface-card border border-surface-border rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-accent"
                    value={form.low_stock_threshold} onChange={e => set('low_stock_threshold', e.target.value)}
                    placeholder="Blank = alert only when out (0)" />
                </div>
              )}
            </div>
            <div>
              <label className="text-xs text-surface-muted mb-1 block">Location</label>
              <select className="w-full bg-surface border border-surface-border rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-accent"
                value={form.location_id} onChange={e => set('location_id', e.target.value)}>
                <option value="">— Select location —</option>
                {locations.map(l => (
                  <option key={l.id} value={l.id}>{l.name}{l.sublocation ? ` — ${l.sublocation}` : ''}</option>
                ))}
                <option value={NEW}>➕ Create new location…</option>
              </select>
              {form.location_id === NEW && (
                <div className="grid grid-cols-2 gap-2 mt-2">
                  <input autoFocus className="bg-surface border border-accent/50 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-accent"
                    placeholder="Room (e.g. Kitchen)" value={newLoc.name}
                    onChange={e => setNewLoc(v => ({ ...v, name: e.target.value }))} />
                  <input className="bg-surface border border-surface-border rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-accent"
                    placeholder="Spot (optional)" value={newLoc.sublocation}
                    onChange={e => setNewLoc(v => ({ ...v, sublocation: e.target.value }))} />
                </div>
              )}
            </div>
            <div>
              <label className="text-xs text-surface-muted mb-1 block">Category</label>
              <select className="w-full bg-surface border border-surface-border rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-accent"
                value={form.category_id} onChange={e => set('category_id', e.target.value)}>
                <option value="">— Select category —</option>
                {categories.map(c => (
                  <option key={c.id} value={c.id}>{c.icon} {c.name}</option>
                ))}
                <option value={NEW}>➕ Create new category…</option>
              </select>
              {form.category_id === NEW && (
                <input autoFocus className="w-full mt-2 bg-surface border border-accent/50 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-accent"
                  placeholder="Category name (e.g. Camping Gear)" value={newCat}
                  onChange={e => setNewCat(e.target.value)} />
              )}
            </div>
            {showAuthor && (
              <div>
                <label className="text-xs text-surface-muted mb-1 block">Author / Artist</label>
                <input className="w-full bg-surface border border-surface-border rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-accent"
                  value={form.author} onChange={e => set('author', e.target.value)}
                  placeholder="e.g. Brandon Sanderson" />
              </div>
            )}
            <div>
              <label className="text-xs text-surface-muted mb-1 block">Notes</label>
              <textarea className="w-full bg-surface border border-surface-border rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-accent resize-none"
                rows={2} value={form.notes} onChange={e => set('notes', e.target.value)} placeholder="Optional notes..." />
            </div>
          </div>

          <div className="flex gap-3 mt-5">
            <button onClick={onClose} className="flex-1 py-2 rounded-lg border border-surface-border text-surface-muted hover:text-white hover:border-white/20 text-sm transition-all">
              Cancel
            </button>
            <button onClick={save} disabled={saving}
              className="flex-1 py-2 rounded-lg bg-accent hover:bg-accent-hover text-white text-sm font-medium transition-all disabled:opacity-50">
              {saving ? 'Saving…' : item ? 'Save Changes' : 'Add Item'}
            </button>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  )
}
