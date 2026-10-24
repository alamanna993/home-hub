import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { ChevronDown, ChevronRight, ChevronsDownUp, ChevronsUpDown, CornerDownRight, Inbox, MapPin, MoreHorizontal, Pencil, Plus, Trash2 } from 'lucide-react'
import toast from 'react-hot-toast'
import {
  getLocations, createLocation, updateLocation, deleteLocation, getItems, errorText, locationOptionLabel, Location,
} from '../lib/api'
import EmojiPicker from '../components/EmojiPicker'
import {
  Badge, Button, ConfirmDialog, Dialog, EmptyState, Field, IconButton, Input, Menu, Page, PageHeader, Panel, Select, Skeleton,
} from '../components/ui'
import { cn } from '../lib/utils'

const COLLAPSED_KEY = 'hh_locations_collapsed'

function readCollapsed(): Set<number> {
  try { return new Set(JSON.parse(localStorage.getItem(COLLAPSED_KEY) || '[]')) } catch { return new Set() }
}

/** Add or edit dialog state. parent_id null = a room. */
type Draft = { id?: number; name: string; parent_id: number | null; icon: string }

export default function Locations() {
  const navigate = useNavigate()
  const [locations, setLocations] = useState<Location[] | null>(null)
  const [unlocatedCount, setUnlocatedCount] = useState(0)
  const [collapsed, setCollapsed] = useState<Set<number>>(readCollapsed)
  const [draft, setDraft] = useState<Draft | null>(null)
  const [saving, setSaving] = useState(false)
  const [removing, setRemoving] = useState<Location | null>(null)

  const load = () => {
    getLocations().then(setLocations).catch(() => setLocations([]))
    getItems({ unlocated: true }).then(items => setUnlocatedCount(items.length)).catch(() => {})
  }
  useEffect(() => { load() }, [])
  useEffect(() => { try { localStorage.setItem(COLLAPSED_KEY, JSON.stringify([...collapsed])) } catch { /* private mode */ } }, [collapsed])

  const byId = useMemo(() => new Map((locations || []).map(l => [l.id, l])), [locations])

  // A row is shown when none of its ancestors is collapsed
  const visible = useMemo(() => (locations || []).filter(l => {
    let p = l.parent_id
    while (p != null) {
      if (collapsed.has(p)) return false
      p = byId.get(p)?.parent_id ?? null
    }
    return true
  }), [locations, collapsed, byId])

  // Where a location may move to: anywhere except itself and what's inside it
  const insideOf = (id: number) => {
    const out = new Set([id])
    for (const l of locations || []) if (l.parent_id != null && out.has(l.parent_id)) out.add(l.id)
    return out
  }

  function toggle(id: number) {
    setCollapsed(c => { const n = new Set(c); if (n.has(id)) n.delete(id); else n.add(id); return n })
  }

  async function save() {
    if (!draft?.name.trim()) { toast.error('Give the location a name'); return }
    setSaving(true)
    try {
      if (draft.id) {
        await updateLocation(draft.id, { name: draft.name.trim(), icon: draft.icon, parent_id: draft.parent_id, move: true })
        toast.success('Location updated')
      } else {
        const created = await createLocation({ name: draft.name.trim(), parent_id: draft.parent_id, icon: draft.parent_id == null ? draft.icon : undefined })
        toast.success(`Added ${created.path_label}`)
        if (draft.parent_id != null) setCollapsed(c => { const n = new Set(c); n.delete(draft.parent_id!); return n })
      }
      setDraft(null); load()
    } catch (e) { toast.error(errorText(e, "Couldn't save the location")) } finally { setSaving(false) }
  }

  const rooms = (locations || []).filter(l => l.depth === 0)
  const parentName = draft?.parent_id != null ? byId.get(draft.parent_id)?.path_label : null
  const allCollapsed = rooms.length > 0 && rooms.every(r => r.child_count === 0 || collapsed.has(r.id))

  return (
    <Page>
      <PageHeader title="Locations" description="Rooms, and the spots inside them, as specific as you like."
        actions={<>
          {(locations?.length ?? 0) > rooms.length && (
            <Button icon={allCollapsed ? ChevronsUpDown : ChevronsDownUp}
              onClick={() => setCollapsed(allCollapsed ? new Set() : new Set((locations || []).filter(l => l.child_count > 0).map(l => l.id)))}>
              {allCollapsed ? 'Expand all' : 'Collapse all'}
            </Button>
          )}
          <Button variant="primary" icon={Plus} onClick={() => setDraft({ name: '', parent_id: null, icon: '📍' })}>Add room</Button>
        </>} />

      {unlocatedCount > 0 && (
        <Link to="/inventory?loc=none"
          className="mb-4 flex items-center gap-3 rounded-panel border border-warn/40 bg-warn/[0.05] px-4 py-3 hover:border-warn">
          <Inbox size={18} className="shrink-0 text-warn" aria-hidden />
          <span className="flex-1 text-sm text-ink">{unlocatedCount} item{unlocatedCount === 1 ? ' is' : 's are'} waiting for a location</span>
          <span className="text-ui font-medium text-action">File them</span>
          <ChevronRight size={16} className="text-muted" aria-hidden />
        </Link>
      )}

      <Panel padded={false} className="max-w-4xl">
        {locations === null ? (
          <div className="space-y-2 p-4">{[0, 1, 2, 3].map(i => <Skeleton key={i} className="h-6" />)}</div>
        ) : locations.length === 0 ? (
          <EmptyState icon={MapPin} title="No locations yet"
            description="Start with the rooms in your home, then add spots inside them: Office › Bookshelf › Right side › Third shelf up."
            action={<Button variant="primary" icon={Plus} onClick={() => setDraft({ name: '', parent_id: null, icon: '📍' })}>Add room</Button>} />
        ) : (
          <ul role="tree" aria-label="Locations" className="divide-y divide-line">
            {visible.map(l => {
              const open = !collapsed.has(l.id)
              return (
                <li key={l.id} role="treeitem" aria-level={l.depth + 1} aria-expanded={l.child_count ? open : undefined}
                  className={cn('group flex items-center gap-2 py-2 pr-2 hover:bg-ink/[0.03]', l.depth === 0 && 'bg-canvas/40')}
                  style={{ paddingLeft: `${12 + l.depth * 24}px` }}>
                  {l.child_count > 0 ? (
                    <IconButton icon={open ? ChevronDown : ChevronRight} label={open ? `Collapse ${l.name}` : `Expand ${l.name}`}
                      size="sm" className="h-7 w-7" onClick={() => toggle(l.id)} />
                  ) : (
                    <span className="flex h-7 w-7 items-center justify-center text-muted/50" aria-hidden>
                      {l.depth > 0 && <CornerDownRight size={14} />}
                    </span>
                  )}
                  {(l.depth === 0 || l.icon) && <span className="w-5 text-center leading-none" aria-hidden>{l.icon || '📍'}</span>}
                  <button type="button" onClick={() => navigate(`/inventory?loc=${l.id}`)}
                    className={cn('min-w-0 truncate text-left hover:underline', l.depth === 0 ? 'text-sm font-semibold text-ink' : 'text-sm text-ink')}>
                    {l.name}
                  </button>
                  <span className="ml-auto flex shrink-0 items-center gap-2">
                    {l.total_count > 0 && (
                      <Badge title={l.item_count !== l.total_count ? `${l.item_count} here, ${l.total_count - l.item_count} inside` : undefined}>
                        {l.total_count} item{l.total_count === 1 ? '' : 's'}
                      </Badge>
                    )}
                    <IconButton icon={Plus} label={`Add a spot inside ${l.name}`} size="sm"
                      className="opacity-100 lg:opacity-0 lg:group-hover:opacity-100 lg:focus:opacity-100"
                      onClick={() => setDraft({ name: '', parent_id: l.id, icon: '' })} />
                    <Menu label={`${l.name} options`} trigger={<IconButton icon={MoreHorizontal} label={`${l.name} options`} size="sm" />}
                      items={[
                        { label: 'Add a spot inside', icon: Plus, onSelect: () => setDraft({ name: '', parent_id: l.id, icon: '' }) },
                        { label: 'Rename or move', icon: Pencil, onSelect: () => setDraft({ id: l.id, name: l.name, parent_id: l.parent_id, icon: l.icon || '' }) },
                        { separator: true },
                        { label: 'Delete', icon: Trash2, danger: true, onSelect: () => setRemoving(l) },
                      ]} />
                  </span>
                </li>
              )
            })}
          </ul>
        )}
      </Panel>

      <Dialog open={!!draft} onClose={() => setDraft(null)} size="sm"
        title={draft?.id ? 'Rename or move' : draft?.parent_id != null ? 'Add a spot' : 'Add room'}
        description={!draft?.id && parentName ? `Inside ${parentName}` : undefined}
        footer={<>
          <Button variant="ghost" onClick={() => setDraft(null)}>Cancel</Button>
          <Button variant="primary" loading={saving} onClick={save}>{draft?.id ? 'Save changes' : 'Add'}</Button>
        </>}>
        {draft && (
          <form className="space-y-4" onSubmit={e => { e.preventDefault(); save() }}>
            <div className="flex items-end gap-3">
              {draft.parent_id == null && (
                <div className="flex flex-col gap-1.5">
                  <span className="text-ui font-medium text-ink">Icon</span>
                  <EmojiPicker value={draft.icon || '📍'} onChange={v => setDraft(d => d && { ...d, icon: v })} />
                </div>
              )}
              <Field label="Name" required className="flex-1">
                <Input autoFocus value={draft.name} onChange={e => setDraft(d => d && { ...d, name: e.target.value })}
                  placeholder={draft.parent_id == null ? 'Office' : 'Bookshelf, right side, third shelf up…'} />
              </Field>
            </div>
            {draft.id && (
              <Field label="Inside" hint="Move it, and everything in it, somewhere else">
                <Select value={draft.parent_id ?? ''} onChange={e => setDraft(d => d && { ...d, parent_id: e.target.value ? Number(e.target.value) : null })}>
                  <option value="">Nothing: it's a room</option>
                  {(locations || []).filter(l => !insideOf(draft.id!).has(l.id)).map(l => (
                    <option key={l.id} value={l.id}>{locationOptionLabel(l)}</option>
                  ))}
                </Select>
              </Field>
            )}
            <button type="submit" hidden />
          </form>
        )}
      </Dialog>

      <ConfirmDialog open={!!removing} onClose={() => setRemoving(null)} confirmLabel="Delete location"
        title={`Delete ${removing?.path_label}?`}
        description={removing && [
          removing.item_count ? `${removing.item_count} item${removing.item_count === 1 ? '' : 's'} stored here will move ${removing.parent_id != null ? `to ${byId.get(removing.parent_id)?.name}` : 'to No location'}.` : '',
          removing.child_count ? `The ${removing.child_count} spot${removing.child_count === 1 ? '' : 's'} inside it move up a level.` : '',
          !removing.item_count && !removing.child_count ? 'Nothing is stored here.' : '',
        ].filter(Boolean).join(' ')}
        onConfirm={async () => {
          try { await deleteLocation(removing!.id); toast.success('Location deleted'); load() }
          catch (e) { toast.error(errorText(e, "Couldn't delete the location")) }
        }} />
    </Page>
  )
}
