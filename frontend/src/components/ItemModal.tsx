import { useState, useEffect } from 'react'
import { Button, Dialog, Field, Input, Select, Textarea } from './ui'
import { cn } from '../lib/utils'
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
    name: '', quantity: '', unit: '', notes: '', author: '', expiration_date: '',
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
        expiration_date: item.expiration_date ?? '',
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
  // Expiration only makes sense for edibles — food-ish category or kitchen-ish location
  const isFood = /grocer|food|produce|spice|baking|snack|beverage|drink/i.test(selectedCatName)
    || /kitchen|pantry|fridge|freezer/i.test(selectedLocName)
  const showExpiration = isFood || Boolean(form.expiration_date)

  async function save() {
    if (!form.name.trim()) { toast.error('Give the item a name'); return }
    if (form.location_id === NEW && !newLoc.name.trim()) { toast.error('Name the new room'); return }
    if (form.category_id === NEW && !newCat.trim()) { toast.error('Name the new category'); return }
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
        expiration_date: form.expiration_date || null,  // explicit null clears a saved date
      }
      if (item) await updateItem(item.id, payload)
      else await createItem(payload)
      toast.success(item ? 'Item updated' : 'Item added')
      onSaved()
      onClose()
    } catch {
      toast.error("Couldn't save the item")
    } finally {
      setSaving(false)
    }
  }

  const footer = (
    <>
      <Button variant="ghost" onClick={onClose}>Cancel</Button>
      <Button variant="primary" loading={saving} onClick={save}>{item ? 'Save changes' : 'Add item'}</Button>
    </>
  )

  return (
    <Dialog open onClose={onClose} title={item ? 'Edit item' : 'Add item'} footer={footer}
      description={item ? `Entered ${new Date(item.created_at).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })}` : undefined}>
      <form className="space-y-4" onSubmit={e => { e.preventDefault(); save() }}>
        <Field label="Name" required>
          <Input autoFocus value={form.name} onChange={e => set('name', e.target.value)} placeholder="Pasta, drill, router" />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Quantity">
            <Input type="number" inputMode="decimal" value={form.quantity} onChange={e => set('quantity', e.target.value)} placeholder="1" />
          </Field>
          <Field label="Unit">
            <Input value={form.unit} onChange={e => set('unit', e.target.value)} placeholder="boxes, lbs, each" />
          </Field>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Location">
            <Select value={form.location_id} onChange={e => set('location_id', e.target.value)}>
              <option value="">No location</option>
              {locations.map(l => (
                <option key={l.id} value={l.id}>{l.name}{l.sublocation ? ` / ${l.sublocation}` : ''}</option>
              ))}
              <option value={NEW}>New location…</option>
            </Select>
          </Field>
          <Field label="Category">
            <Select value={form.category_id} onChange={e => set('category_id', e.target.value)}>
              <option value="">No category</option>
              {categories.map(c => <option key={c.id} value={c.id}>{c.icon} {c.name}</option>)}
              <option value={NEW}>New category…</option>
            </Select>
          </Field>
        </div>
        {form.location_id === NEW && (
          <div className="grid grid-cols-2 gap-3">
            <Field label="New room"><Input autoFocus placeholder="Kitchen" value={newLoc.name}
              onChange={e => setNewLoc(v => ({ ...v, name: e.target.value }))} /></Field>
            <Field label="Spot in the room"><Input placeholder="Optional" value={newLoc.sublocation}
              onChange={e => setNewLoc(v => ({ ...v, sublocation: e.target.value }))} /></Field>
          </div>
        )}
        {form.category_id === NEW && (
          <Field label="New category"><Input autoFocus placeholder="Camping gear" value={newCat} onChange={e => setNewCat(e.target.value)} /></Field>
        )}

        <div className="space-y-3 rounded-control border border-line px-3 py-3">
          <label className={cn('flex items-center gap-2.5 text-sm', isGrocery ? 'text-muted' : 'cursor-pointer text-ink')}>
            <input type="checkbox" className="h-4 w-4 accent-[rgb(var(--action))]" checked={tracking} disabled={isGrocery}
              onChange={e => setForm(f => ({ ...f, track_stock: e.target.checked }))} />
            Track stock level
            {isGrocery && <span className="ml-auto text-xs text-muted">Always on for consumables</span>}
          </label>
          {tracking && (
            <Field label="Warn when the quantity is at or below"
              hint={/kitchen|laundry|pantry|fridge|freezer/i.test(selectedLocName) ? 'Blank warns at the last one' : 'Blank warns only when it runs out'}>
              <Input type="number" inputMode="decimal" value={form.low_stock_threshold} onChange={e => set('low_stock_threshold', e.target.value)} />
            </Field>
          )}
        </div>

        {showExpiration && (
          <Field label="Use by" hint="Leave blank if it doesn't expire">
            <Input type="date" value={form.expiration_date} onChange={e => set('expiration_date', e.target.value)} />
          </Field>
        )}
        {showAuthor && (
          <Field label="Author or artist">
            <Input value={form.author} onChange={e => set('author', e.target.value)} placeholder="Brandon Sanderson" />
          </Field>
        )}
        <Field label="Notes">
          <Textarea rows={2} value={form.notes} onChange={e => set('notes', e.target.value)} />
        </Field>
        <button type="submit" hidden />
      </form>
    </Dialog>
  )
}
