import { useEffect, useState, useCallback, useMemo } from 'react'
import { useSearchParams } from 'react-router-dom'
import { AlertTriangle, Edit2, Inbox, MapPin, Plus, Search, Trash2 } from 'lucide-react'
import { getItems, getCategories, getLocations, deleteItem, errorText, Item, Category, Location } from '../lib/api'
import ItemModal from '../components/ItemModal'
import {
  Badge, Button, ConfirmDialog, DataTable, EmptyState, Input, Page, PageHeader, Panel, Select, Skeleton, type Column,
} from '../components/ui'
import { cn } from '../lib/utils'
import toast from 'react-hot-toast'

interface Room {
  name: string
  icon?: string
  count: number
  subs: { id: number; name: string }[]
}

const SORTS: Record<string, { label: string; cmp: (a: Item, b: Item) => number }> = {
  name: { label: 'Name A to Z', cmp: (a, b) => a.name.localeCompare(b.name) },
  name_desc: { label: 'Name Z to A', cmp: (a, b) => b.name.localeCompare(a.name) },
  newest: { label: 'Newest entry', cmp: (a, b) => b.created_at.localeCompare(a.created_at) },
  oldest: { label: 'Oldest entry', cmp: (a, b) => a.created_at.localeCompare(b.created_at) },
  updated: {
    label: 'Recently updated',
    cmp: (a, b) => (b.updated_at || b.created_at).localeCompare(a.updated_at || a.created_at),
  },
  expiring: {
    // items with a date first, soonest on top; dateless ones after
    label: 'Expiring soonest',
    cmp: (a, b) => !a.expiration_date === !b.expiration_date
      ? (a.expiration_date || '').localeCompare(b.expiration_date || '')
      : (a.expiration_date ? -1 : 1),
  },
  qty_low: { label: 'Quantity: low first', cmp: (a, b) => (a.quantity ?? Infinity) - (b.quantity ?? Infinity) },
  qty_high: { label: 'Quantity: high first', cmp: (a, b) => (b.quantity ?? -Infinity) - (a.quantity ?? -Infinity) },
  category: {
    // uncategorized items go last
    label: 'Category A to Z',
    cmp: (a, b) => !a.category === !b.category
      ? (a.category?.name || '').localeCompare(b.category?.name || '')
      : (a.category ? -1 : 1),
  },
}

// Date-only strings ("2026-07-10") must not go through new Date() — UTC parsing can shift them a day
const fmtDay = (iso: string) => {
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
}

const where = (item: Item) => item.location
  ? item.location.name + (item.location.sublocation ? ` / ${item.location.sublocation}` : '') : '—'

function ItemStatus({ item }: { item: Item }) {
  if (item.is_expired) return <Badge tone="danger" icon={AlertTriangle}>Expired {fmtDay(item.expiration_date!)}</Badge>
  if (item.expires_soon) return <Badge tone="warn">Use by {fmtDay(item.expiration_date!)}</Badge>
  if (item.is_low_stock) return <Badge tone="warn">Running low</Badge>
  if (item.expiration_date) return <span className="text-ui text-muted">Use by {fmtDay(item.expiration_date)}</span>
  return null
}

export default function Inventory() {
  const [items, setItems] = useState<Item[]>([])
  const [categories, setCategories] = useState<Category[]>([])
  const [locations, setLocations] = useState<Location[]>([])
  const [unlocatedCount, setUnlocatedCount] = useState(0)
  const [search, setSearch] = useState('')
  const [catFilter, setCatFilter] = useState('')
  const [editItem, setEditItem] = useState<Item | null | undefined>(undefined)
  const [deleting, setDeleting] = useState<Item | null>(null)
  const [loading, setLoading] = useState(true)
  const [searchParams, setSearchParams] = useSearchParams()
  const roomFilter = searchParams.get('location') || ''
  const subFilter = searchParams.get('sub') || ''
  const [sort, setSort] = useState(() => {
    let saved: string | null = null
    try { saved = localStorage.getItem('hh_inv_sort') } catch { /* private mode */ }
    return saved && saved in SORTS ? saved : 'name'
  })
  const changeSort = (key: string) => {
    setSort(key)
    try { localStorage.setItem('hh_inv_sort', key) } catch { /* private mode */ }
  }

  const openRoom = (room: string) => {
    setSearch(''); setCatFilter('')
    setSearchParams(room ? { location: room } : {}, { replace: true })
  }
  const setSubFilter = (subId: string) => {
    setSearchParams(subId ? { location: roomFilter, sub: subId } : { location: roomFilter }, { replace: true })
  }

  // Items are shown when a room is open, or when searching from the rooms view
  const showingItems = Boolean(roomFilter || search)

  const load = useCallback(async () => {
    try {
      const jobs: Promise<void>[] = [
        getLocations().then(setLocations),
        getCategories().then(setCategories),
      ]
      if (showingItems) {
        const params: Record<string, unknown> = {}
        if (search) params.search = search
        if (catFilter) params.category_id = catFilter
        if (subFilter) params.location_id = subFilter
        else if (roomFilter === '__none__') params.unlocated = true
        else if (roomFilter) params.location_name = roomFilter
        jobs.push(getItems(params).then(setItems))
      } else {
        jobs.push(getItems({ unlocated: true }).then(i => setUnlocatedCount(i.length)))
      }
      await Promise.all(jobs)
    } catch {
      toast.error("The inventory couldn't load. Check that the server is running.")
    } finally {
      setLoading(false)
    }
  }, [search, catFilter, roomFilter, subFilter, showingItems])

  useEffect(() => { load() }, [load])

  // Group location rows into rooms: one tile per room name, sub-locations nested
  const rooms = useMemo<Room[]>(() => {
    const byName: Record<string, Room> = {}
    for (const l of locations) {
      const room = byName[l.name] ?? (byName[l.name] = { name: l.name, icon: l.icon, count: 0, subs: [] })
      if (!room.icon && l.icon) room.icon = l.icon
      room.count += l.item_count
      if (l.sublocation) room.subs.push({ id: l.id, name: l.sublocation })
    }
    return Object.values(byName)
  }, [locations])

  const currentRoom = rooms.find(r => r.name === roomFilter)

  const sortedItems = useMemo(() => {
    const cmp = (SORTS[sort] || SORTS.name).cmp
    // name as tiebreaker keeps equal-key items stable and scannable
    return [...items].sort((a, b) => cmp(a, b) || a.name.localeCompare(b.name))
  }, [items, sort])

  async function confirmDelete() {
    if (!deleting) return
    try {
      await deleteItem(deleting.id)
      toast.success(`Deleted ${deleting.name}`)
      load()
    } catch (e) {
      toast.error(errorText(e, "Couldn't delete that item"))
    }
  }

  const subName = currentRoom?.subs.find(s => String(s.id) === subFilter)?.name
  const title = roomFilter === '__none__' ? 'No location' : roomFilter || (search ? 'Search results' : 'Inventory')
  const description = showingItems
    ? `${items.length} item${items.length === 1 ? '' : 's'}${roomFilter === '__none__' ? ' waiting for a location'
        : subFilter ? ` in ${subName || 'this spot'}` : roomFilter ? ' in this room' : ' found'}`
    : `${rooms.length} location${rooms.length === 1 ? '' : 's'}. Open one to see what's inside.`

  const columns: Column<Item>[] = [
    {
      key: 'name', header: 'Item', sortValue: i => i.name.toLowerCase(),
      cell: i => (
        <div className="flex min-w-0 items-center gap-2.5">
          <span className="w-5 shrink-0 text-center leading-none" aria-hidden>{i.category?.icon || '📦'}</span>
          <div className="min-w-0">
            <p className="truncate font-medium text-ink">{i.name}</p>
            {(i.author || i.notes) && <p className="truncate text-xs text-muted">{i.author ? `by ${i.author}` : i.notes}</p>}
          </div>
        </div>
      ),
    },
    {
      key: 'category', header: 'Category', width: '10rem', hideBelow: 'lg', sortValue: i => i.category?.name ?? null,
      cell: i => <span className="text-muted">{i.category?.name || '—'}</span>,
    },
    { key: 'location', header: 'Location', width: '13rem', sortValue: i => where(i), cell: i => <span className="text-muted">{where(i)}</span> },
    {
      key: 'qty', header: 'Qty', width: '7rem', numeric: true, sortValue: i => i.quantity ?? null,
      cell: i => <span className={i.is_low_stock ? 'font-medium text-warn' : 'text-ink'}>{i.quantity ?? '—'}{i.unit ? ` ${i.unit}` : ''}</span>,
    },
    { key: 'status', header: 'Status', width: '11rem', sortValue: i => i.expiration_date ?? null, cell: i => <ItemStatus item={i} /> },
    {
      key: 'entered', header: 'Entered', width: '8rem', hideBelow: 'xl', sortValue: i => i.created_at,
      cell: i => <span className="text-muted">{fmtDay(i.created_at)}</span>,
    },
  ]

  return (
    <Page>
      <PageHeader
        breadcrumb={roomFilter ? [{ label: 'Inventory', to: '/inventory' }] : undefined}
        title={roomFilter && roomFilter !== '__none__'
          ? <span className="flex items-center gap-2"><span aria-hidden>{currentRoom?.icon || '📍'}</span>{title}</span>
          : title}
        description={description}
        actions={<Button variant="primary" icon={Plus} onClick={() => setEditItem(null)}>Add item</Button>}
      />

      {/* Toolbar */}
      <div className="mb-4 flex flex-col gap-2 sm:flex-row">
        <div className="relative flex-1 sm:max-w-sm">
          <Search size={16} aria-hidden className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
          <Input value={search} onChange={e => setSearch(e.target.value)} className="pl-9" aria-label="Search items"
            placeholder={roomFilter ? `Search in ${roomFilter === '__none__' ? 'unfiled items' : roomFilter}` : 'Search all items'} />
        </div>
        {showingItems && <>
          <Select aria-label="Filter by category" value={catFilter} onChange={e => setCatFilter(e.target.value)} className="sm:w-48">
            <option value="">All categories</option>
            {categories.map(c => <option key={c.id} value={c.id}>{c.icon} {c.name}</option>)}
          </Select>
          <Select aria-label="Sort items" value={sort} onChange={e => changeSort(e.target.value)} className="sm:ml-auto sm:w-48">
            {Object.entries(SORTS).map(([key, s]) => <option key={key} value={key}>{s.label}</option>)}
          </Select>
        </>}
      </div>

      {/* Spots inside the room */}
      {roomFilter && roomFilter !== '__none__' && (currentRoom?.subs.length ?? 0) > 0 && (
        <div className="mb-4 flex flex-wrap gap-1.5" role="group" aria-label="Spots in this room">
          {[{ id: '', name: `All of ${roomFilter}` }, ...currentRoom!.subs.map(s => ({ id: String(s.id), name: s.name }))].map(s => (
            <button key={s.id || 'all'} type="button" aria-pressed={subFilter === s.id}
              onClick={() => setSubFilter(subFilter === s.id ? '' : s.id)}
              className={cn('h-8 rounded-full border px-3 text-ui transition-colors',
                subFilter === s.id ? 'border-action bg-action/10 text-action' : 'border-line bg-surface text-muted hover:text-ink')}>
              {s.name}
            </button>
          ))}
        </div>
      )}

      {loading ? (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4">
          {[0, 1, 2, 3].map(i => <Skeleton key={i} className="h-28 rounded-panel" />)}
        </div>
      ) : !showingItems ? (
        rooms.length === 0 && unlocatedCount === 0 ? (
          <Panel padded={false}>
            <EmptyState icon={MapPin} title="No locations yet"
              description="Add rooms on the Locations page, or add an item and create its room as you go."
              action={<Button variant="primary" icon={Plus} onClick={() => setEditItem(null)}>Add item</Button>} />
          </Panel>
        ) : (
          <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4">
            {rooms.map(room => (
              <li key={room.name}>
                <button type="button" onClick={() => openRoom(room.name)}
                  className="flex h-full w-full flex-col rounded-panel border border-line bg-surface p-4 text-left transition-colors hover:border-muted/50">
                  <span className="mb-3 text-2xl leading-none" aria-hidden>{room.icon || '📍'}</span>
                  <span className="text-sm font-semibold text-ink">{room.name}</span>
                  <span className="mt-0.5 text-ui text-muted tnum">{room.count} item{room.count === 1 ? '' : 's'}</span>
                  {room.subs.length > 0 && <span className="mt-1 truncate text-xs text-muted">{room.subs.map(s => s.name).join(', ')}</span>}
                </button>
              </li>
            ))}
            {unlocatedCount > 0 && (
              <li>
                <button type="button" onClick={() => openRoom('__none__')}
                  className="flex h-full w-full flex-col rounded-panel border border-warn/40 bg-warn/[0.05] p-4 text-left transition-colors hover:border-warn">
                  <Inbox size={24} className="mb-3 text-warn" aria-hidden />
                  <span className="text-sm font-semibold text-ink">No location</span>
                  <span className="mt-0.5 text-ui text-muted">{unlocatedCount} item{unlocatedCount === 1 ? '' : 's'} waiting to be filed</span>
                </button>
              </li>
            )}
          </ul>
        )
      ) : (
        <Panel padded={false}>
          <DataTable columns={columns} rows={sortedItems} rowKey={i => i.id} caption={title}
            onRowClick={i => setEditItem(i)}
            rowActions={i => [
              { label: 'Edit', icon: Edit2, onSelect: () => setEditItem(i) },
              { separator: true },
              { label: 'Delete', icon: Trash2, danger: true, onSelect: () => setDeleting(i) },
            ]}
            mobileRow={i => (
              <div className="flex items-start gap-3">
                <span className="mt-0.5 w-5 text-center leading-none" aria-hidden>{i.category?.icon || '📦'}</span>
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium text-ink">{i.name}</p>
                  <p className="truncate text-ui text-muted">{where(i)}</p>
                  <div className="mt-1 empty:hidden"><ItemStatus item={i} /></div>
                </div>
                <span className={cn('text-sm tnum', i.is_low_stock ? 'font-medium text-warn' : 'text-ink')}>
                  {i.quantity ?? '—'}{i.unit ? ` ${i.unit}` : ''}
                </span>
              </div>
            )}
            empty={<EmptyState icon={Search} title="No items found"
              description="Try a different search, or add the item. You can also tell Emerald what you bought." />} />
        </Panel>
      )}

      {editItem !== undefined && (
        <ItemModal item={editItem} categories={categories} locations={locations}
          onClose={() => setEditItem(undefined)} onSaved={load} />
      )}
      <ConfirmDialog open={!!deleting} onClose={() => setDeleting(null)} onConfirm={confirmDelete}
        title={`Delete ${deleting?.name}?`} confirmLabel="Delete item"
        description="It's removed from the inventory for good. To keep it on the list for restocking, set the quantity to 0 instead." />
    </Page>
  )
}
