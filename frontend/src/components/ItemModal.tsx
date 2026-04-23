import { useState, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { X } from 'lucide-react'
import { Item, Category, Location, createItem, updateItem } from '../lib/api'
import toast from 'react-hot-toast'

interface Props {
  item?: Item | null
  categories: Category[]
  locations: Location[]
  onClose: () => void
  onSaved: () => void
}

export default function ItemModal({ item, categories, locations, onClose, onSaved }: Props) {
  const [form, setForm] = useState({
    name: '', quantity: '', unit: '', notes: '',
    low_stock_threshold: '', location_id: '', category_id: '',
  })
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (item) {
      setForm({
        name: item.name, quantity: String(item.quantity ?? ''),
        unit: item.unit ?? '', notes: item.notes ?? '',
        low_stock_threshold: String(item.low_stock_threshold ?? ''),
        location_id: String(item.location?.id ?? ''),
        category_id: String(item.category?.id ?? ''),
      })
    }
  }, [item])

  const set = (k: string, v: string) => setForm(f => ({ ...f, [k]: v }))

  async function save() {
    if (!form.name.trim()) return toast.error('Name is required')
    setSaving(true)
    try {
      const payload = {
        name: form.name,
        quantity: form.quantity ? parseFloat(form.quantity) : undefined,
        unit: form.unit || undefined,
        notes: form.notes || undefined,
        low_stock_threshold: form.low_stock_threshold ? parseFloat(form.low_stock_threshold) : undefined,
        location_id: form.location_id ? parseInt(form.location_id) : undefined,
        category_id: form.category_id ? parseInt(form.category_id) : undefined,
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
            <div>
              <label className="text-xs text-surface-muted mb-1 block">Low Stock Alert (qty)</label>
              <input type="number" className="w-full bg-surface border border-surface-border rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-accent"
                value={form.low_stock_threshold} onChange={e => set('low_stock_threshold', e.target.value)} placeholder="Alert when below this number" />
            </div>
            <div>
              <label className="text-xs text-surface-muted mb-1 block">Location</label>
              <select className="w-full bg-surface border border-surface-border rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-accent"
                value={form.location_id} onChange={e => set('location_id', e.target.value)}>
                <option value="">— Select location —</option>
                {locations.map(l => (
                  <option key={l.id} value={l.id}>{l.name}{l.sublocation ? ` — ${l.sublocation}` : ''}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-xs text-surface-muted mb-1 block">Category</label>
              <select className="w-full bg-surface border border-surface-border rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-accent"
                value={form.category_id} onChange={e => set('category_id', e.target.value)}>
                <option value="">— Select category —</option>
                {categories.map(c => (
                  <option key={c.id} value={c.id}>{c.icon} {c.name}</option>
                ))}
              </select>
            </div>
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
