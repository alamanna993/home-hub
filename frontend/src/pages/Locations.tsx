import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { ChevronRight, Inbox, MapPin, Pencil, Plus, Trash2 } from 'lucide-react'
import axios from 'axios'
import toast from 'react-hot-toast'
import { getLocations, createLocation, updateLocation, getItems, errorText, Location } from '../lib/api'
import EmojiPicker from '../components/EmojiPicker'
import {
  Button, ConfirmDialog, DataTable, Dialog, EmptyState, Field, Input, Page, PageHeader, Panel, type Column,
} from '../components/ui'

type Draft = { id?: number; name: string; sublocation: string; icon: string }

export default function Locations() {
  const [locations, setLocations] = useState<Location[] | null>(null)
  const [unlocatedCount, setUnlocatedCount] = useState(0)
  const [draft, setDraft] = useState<Draft | null>(null)
  const [saving, setSaving] = useState(false)
  const [removing, setRemoving] = useState<Location | null>(null)

  const load = () => {
    getLocations().then(setLocations).catch(() => setLocations([]))
    getItems({ unlocated: true }).then(items => setUnlocatedCount(items.length)).catch(() => {})
  }
  useEffect(() => { load() }, [])

  async function save() {
    if (!draft?.name.trim()) { toast.error('Give the room a name'); return }
    setSaving(true)
    try {
      const data = { name: draft.name.trim(), sublocation: draft.sublocation.trim() || undefined, icon: draft.icon }
      if (draft.id) await updateLocation(draft.id, { ...data, sublocation: draft.sublocation.trim() })
      else await createLocation(data)
      toast.success(draft.id ? 'Location updated' : 'Location added')
      setDraft(null); load()
    } catch (e) { toast.error(errorText(e, "Couldn't save the location")) } finally { setSaving(false) }
  }

  const columns: Column<Location>[] = [
    {
      key: 'room', header: 'Room', sortValue: l => `${l.name} ${l.sublocation || ''}`.toLowerCase(),
      cell: l => (
        <span className="flex items-center gap-2.5">
          <span className="w-5 text-center leading-none" aria-hidden>{l.icon || '📍'}</span>
          <span className="font-medium text-ink">{l.name}</span>
        </span>
      ),
    },
    { key: 'spot', header: 'Spot in the room', sortValue: l => l.sublocation ?? null, cell: l => <span className="text-muted">{l.sublocation || '—'}</span> },
    {
      key: 'items', header: 'Items', width: '7rem', numeric: true, sortValue: l => l.item_count,
      cell: l => <Link to={`/inventory?location=${encodeURIComponent(l.name)}${l.sublocation ? `&sub=${l.id}` : ''}`}
        onClick={e => e.stopPropagation()} className="text-action hover:underline">{l.item_count}</Link>,
    },
  ]

  return (
    <Page>
      <PageHeader title="Locations" description="Rooms in the house, and the spots inside them."
        actions={<Button variant="primary" icon={Plus} onClick={() => setDraft({ name: '', sublocation: '', icon: '📍' })}>Add location</Button>} />

      {unlocatedCount > 0 && (
        <Link to="/inventory?location=__none__"
          className="mb-4 flex items-center gap-3 rounded-panel border border-warn/40 bg-warn/[0.05] px-4 py-3 hover:border-warn">
          <Inbox size={18} className="shrink-0 text-warn" aria-hidden />
          <span className="flex-1 text-sm text-ink">
            {unlocatedCount} item{unlocatedCount === 1 ? ' is' : 's are'} waiting for a location
          </span>
          <span className="text-ui font-medium text-action">File them</span>
          <ChevronRight size={16} className="text-muted" aria-hidden />
        </Link>
      )}

      <Panel padded={false}>
        <DataTable columns={columns} rows={locations || []} rowKey={l => l.id} loading={locations === null}
          initialSort={{ key: 'room', dir: 'asc' }} caption="Locations"
          onRowClick={l => setDraft({ id: l.id, name: l.name, sublocation: l.sublocation || '', icon: l.icon || '📍' })}
          rowActions={l => [
            { label: 'Edit', icon: Pencil, onSelect: () => setDraft({ id: l.id, name: l.name, sublocation: l.sublocation || '', icon: l.icon || '📍' }) },
            { separator: true },
            { label: 'Delete', icon: Trash2, danger: true, onSelect: () => setRemoving(l) },
          ]}
          empty={<EmptyState icon={MapPin} title="No locations yet" description="Add the rooms in your home, like Kitchen or Garage. Add spots like Pantry shelf 2 to find things faster."
            action={<Button variant="primary" icon={Plus} onClick={() => setDraft({ name: '', sublocation: '', icon: '📍' })}>Add location</Button>} />} />
      </Panel>

      <Dialog open={!!draft} onClose={() => setDraft(null)} size="sm" title={draft?.id ? 'Edit location' : 'Add location'}
        footer={<>
          <Button variant="ghost" onClick={() => setDraft(null)}>Cancel</Button>
          <Button variant="primary" loading={saving} onClick={save}>{draft?.id ? 'Save changes' : 'Add location'}</Button>
        </>}>
        {draft && (
          <form className="space-y-4" onSubmit={e => { e.preventDefault(); save() }}>
            <div className="flex items-end gap-3">
              <div className="flex flex-col gap-1.5">
                <span className="text-ui font-medium text-ink">Icon</span>
                <EmojiPicker value={draft.icon} onChange={v => setDraft(d => d && { ...d, icon: v })} />
              </div>
              <Field label="Room" required className="flex-1">
                <Input autoFocus value={draft.name} onChange={e => setDraft(d => d && { ...d, name: e.target.value })} placeholder="Kitchen" />
              </Field>
            </div>
            <Field label="Spot in the room" hint="Optional, like Pantry shelf 2">
              <Input value={draft.sublocation} onChange={e => setDraft(d => d && { ...d, sublocation: e.target.value })} />
            </Field>
            <button type="submit" hidden />
          </form>
        )}
      </Dialog>

      <ConfirmDialog open={!!removing} onClose={() => setRemoving(null)} confirmLabel="Delete location"
        title={`Delete ${removing?.name}${removing?.sublocation ? ` / ${removing.sublocation}` : ''}?`}
        description={removing?.item_count ? `${removing.item_count} item${removing.item_count === 1 ? '' : 's'} stored here will have no location.` : 'Nothing is stored here.'}
        onConfirm={async () => {
          try { await axios.delete(`/api/locations/${removing!.id}`); toast.success('Location deleted'); load() }
          catch (e) { toast.error(errorText(e, "Couldn't delete the location")) }
        }} />
    </Page>
  )
}
