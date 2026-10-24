import { useState, useEffect } from 'react'
import { Button, Dialog, Field, Input, Select, Tabs, Textarea } from './ui'
import { cn } from '../lib/utils'
import { Item, Category, Location, createItem, updateItem, createLocation, createCategory, locationOptionLabel } from '../lib/api'
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
  const [newLoc, setNewLoc] = useState({ name: '', parent: '' })
  const [newCat, setNewCat] = useState('')
  const [saving, setSaving] = useState(false)
  const [open, setOpen] = useState<OpenState>(() => openStateOf(item))

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
      setOpen(openStateOf(item))
    }
  }, [item])

  const set = (k: string, v: string) => setForm(f => ({ ...f, [k]: v }))

  // Show the author field for book/media-ish categories (including one being created inline)
  const selectedCatName = form.category_id === NEW
    ? newCat
    : categories.find(c => String(c.id) === form.category_id)?.name || ''
  const showAuthor = /book|media|dvd|vinyl|comic|magazine/i.test(selectedCatName) || Boolean(form.author)
  // The whole path, so a fridge inside the kitchen still reads as kitchen
  const selectedLocName = form.location_id === NEW
    ? [locations.find(l => String(l.id) === newLoc.parent)?.path_label, newLoc.name].filter(Boolean).join(' ')
    : locations.find(l => String(l.id) === form.location_id)?.path_label || ''
  const isGrocery = /grocer|food|produce|cleaning|laundry/i.test(selectedCatName) || /laundry/i.test(selectedLocName)
  const tracking = isGrocery || form.track_stock
  // Expiration only makes sense for edibles — food-ish category or kitchen-ish location
  const isFood = /grocer|food|produce|spice|baking|snack|beverage|drink/i.test(selectedCatName)
    || /kitchen|pantry|fridge|freezer/i.test(selectedLocName)
  const showExpiration = isFood || Boolean(form.expiration_date)

  async function save() {
    if (!form.name.trim()) { toast.error('Give the item a name'); return }
    if (form.location_id === NEW && !newLoc.name.trim()) { toast.error('Name the new location'); return }
    if (form.category_id === NEW && !newCat.trim()) { toast.error('Name the new category'); return }
    if (open.mode === 'count' && (!open.unit.trim() || open.count === '')) {
      toast.error('Say how many are left and what they are, like 1 bagel'); return
    }
    setSaving(true)
    try {
      let locationId = form.location_id
      if (locationId === NEW) {
        const loc = await createLocation({ name: newLoc.name.trim(), parent_id: newLoc.parent ? Number(newLoc.parent) : null })
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
        ...openPayload(open),
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
                <option key={l.id} value={l.id}>{locationOptionLabel(l)}</option>
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
            <Field label="Inside">
              <Select value={newLoc.parent} onChange={e => setNewLoc(v => ({ ...v, parent: e.target.value }))}>
                <option value="">Nothing: it's a new room</option>
                {locations.map(l => <option key={l.id} value={l.id}>{locationOptionLabel(l)}</option>)}
              </Select>
            </Field>
            <Field label={newLoc.parent ? 'New spot' : 'New room'}>
              <Input autoFocus placeholder={newLoc.parent ? 'Third shelf up' : 'Office'} value={newLoc.name}
                onChange={e => setNewLoc(v => ({ ...v, name: e.target.value }))} />
            </Field>
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

        {(isFood || tracking || open.mode !== 'none' || open.unit) && <OpenPackageFields value={open} onChange={setOpen} unit={form.unit} />}

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

// ---------------------------------------------------------------------------
// The opened package: "1 package of bagels, 1 bagel left" / "1 tub, a quarter left"
// ---------------------------------------------------------------------------
type OpenMode = 'none' | 'count' | 'portion'
interface OpenState { mode: OpenMode; count: string; unit: string; size: string; portion: number }

function openStateOf(item?: Item | null): OpenState {
  const base = { count: '', unit: item?.pack_unit ?? '', size: item?.pack_size != null ? String(item.pack_size) : '', portion: 0.5 }
  if (!item || item.open_amount == null) return { ...base, mode: 'none' }
  if (item.pack_unit) return { ...base, mode: 'count', count: String(item.open_amount) }
  return { ...base, mode: 'portion', portion: item.open_amount }
}

function openPayload(o: OpenState) {
  return {
    pack_size: o.size ? parseFloat(o.size) : null,
    pack_unit: o.mode === 'portion' ? null : o.unit.trim() || null,
    open_amount: o.mode === 'none' ? null : o.mode === 'count' ? parseFloat(o.count) : o.portion,
  }
}

const PORTIONS = [{ v: 0.75, label: '¾' }, { v: 0.5, label: '½' }, { v: 1 / 3, label: '⅓' }, { v: 0.25, label: '¼' }, { v: 0.05, label: 'Almost empty' }]

function OpenPackageFields({ value: o, onChange, unit }: { value: OpenState; onChange: (o: OpenState) => void; unit: string }) {
  const set = (patch: Partial<OpenState>) => onChange({ ...o, ...patch })
  const pkg = unit.trim() || 'package'
  return (
    <fieldset className="space-y-3 rounded-control border border-line px-3 py-3">
      <legend className="px-1 text-ui font-medium text-ink">Opened {pkg}</legend>
      <Tabs label="How much is left in the opened one" value={o.mode} onChange={mode => set({ mode })}
        tabs={[{ id: 'none', label: 'Not opened' }, { id: 'count', label: 'Count pieces' }, { id: 'portion', label: 'Portion left' }]} />
      {o.mode === 'count' && (
        <div className="grid grid-cols-3 gap-3">
          <Field label="Left"><Input type="number" inputMode="decimal" min={0} value={o.count} onChange={e => set({ count: e.target.value })} placeholder="1" /></Field>
          <Field label="Piece"><Input value={o.unit} onChange={e => set({ unit: e.target.value })} placeholder="bagel" /></Field>
          <Field label="Per full one" hint="Optional"><Input type="number" inputMode="numeric" min={1} value={o.size} onChange={e => set({ size: e.target.value })} placeholder="6" /></Field>
        </div>
      )}
      {o.mode === 'portion' && (
        <div className="space-y-2">
          <div className="flex flex-wrap gap-1.5" role="group" aria-label="Portion left">
            {PORTIONS.map(p => (
              <button key={p.label} type="button" aria-pressed={Math.abs(o.portion - p.v) < 0.01} onClick={() => set({ portion: p.v })}
                className={cn('h-8 min-w-10 rounded-control border px-2.5 text-sm transition-colors',
                  Math.abs(o.portion - p.v) < 0.01 ? 'border-action bg-action/10 text-action' : 'border-line text-ink hover:border-muted/50')}>
                {p.label}
              </button>
            ))}
          </div>
          <label className="flex items-center gap-3 text-ui text-muted">
            <input type="range" min={5} max={100} step={5} value={Math.round(o.portion * 100)}
              onChange={e => set({ portion: Number(e.target.value) / 100 })} className="flex-1 accent-[rgb(var(--action))]"
              aria-label="Portion left, percent" />
            <span className="w-10 text-right text-ink tnum">{Math.round(o.portion * 100)}%</span>
          </label>
        </div>
      )}
      {o.mode === 'none' && <p className="text-xs text-muted">Every {pkg} is full. Set what's left once one is opened.</p>}
    </fieldset>
  )
}
