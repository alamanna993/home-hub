import { useEffect, useState, useCallback, useMemo } from 'react'
import { useSearchParams } from 'react-router-dom'
import { AlertTriangle, ChevronRight, Edit2, Inbox, MapPin, Minus, PackageCheck, Plus, Search, Trash2 } from 'lucide-react'
import { getItems, getCategories, getLocations, deleteItem, useItem as consumeItem, errorText, Item, Category, Location } from '../lib/api'
import ItemModal from '../components/ItemModal'
import {
  Badge, Button, ConfirmDialog, DataTable, EmptyState, Input, Page, PageHeader, Panel, Select, Skeleton, type Column,
} from '../components/ui'
import { cn } from '../lib/utils'
import toast from 'react-hot-toast'

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

const SEP = ' › '

/** Where an item is, relative to the location being viewed: inside Office, 'Bookshelf › Right side' */
const whereFrom = (item: Item, here?: Location) => {
  const path = item.location?.path
  if (!path) return '—'
  if (!here) return path.join(SEP)
  const rest = path.slice(here.path.length)
  return rest.length ? rest.join(SEP) : 'Here'
}

function ItemStatus({ item }: { item: Item }) {
  if (item.is_expired) return <Badge tone="danger" icon={AlertTriangle}>Expired {fmtDay(item.expiration_date!)}</Badge>
  if (item.expires_soon) return <Badge tone="warn">Use by {fmtDay(item.expiration_date!)}</Badge>
  if (item.is_low_stock) return <Badge tone="warn">Running low</Badge>
  if (item.expiration_date) return <span className="text-ui text-muted">Use by {fmtDay(item.expiration_date)}</span>
  return null
}

/** "1 package" with what's left in the opened one underneath ("1 bagel left", "¼ left") */
function Quantity({ item: i, align = 'right' }: { item: Item; align?: 'right' | 'left' }) {
  return (
    <div className={align === 'right' ? 'text-right' : undefined}>
      <span className={cn('text-sm tnum', i.is_low_stock ? 'font-medium text-warn' : 'text-ink')}>
        {i.quantity ?? '—'}{i.unit ? ` ${i.unit}` : ''}
      </span>
      {i.open_label && (
        <span className={cn('mt-0.5 flex items-center gap-1.5 text-xs text-muted', align === 'right' && 'justify-end')}>
          {i.open_fraction != null && (
            <span className="h-1 w-8 overflow-hidden rounded-full bg-line" aria-hidden>
              <span className="block h-full bg-action" style={{ width: `${Math.max(6, i.open_fraction * 100)}%` }} />
            </span>
          )}
          {i.open_label}{(i.quantity ?? 0) > 1 ? ' in the open one' : ''}
        </span>
      )}
    </div>
  )
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
  // ?loc=<id> opens a location (and everything inside it); ?loc=none shows unfiled items.
  // Older links used ?location=<room name>.
  const legacyRoom = searchParams.get('location')
  const locParam = searchParams.get('loc') || (legacyRoom === '__none__' ? 'none' : '')
  const [sort, setSort] = useState(() => {
    let saved: string | null = null
    try { saved = localStorage.getItem('hh_inv_sort') } catch { /* private mode */ }
    return saved && saved in SORTS ? saved : 'name'
  })
  const changeSort = (key: string) => {
    setSort(key)
    try { localStorage.setItem('hh_inv_sort', key) } catch { /* private mode */ }
  }

  const openLoc = (loc: string) => {
    setSearch(''); setCatFilter('')
    setSearchParams(loc ? { loc } : {})
  }

  // Map an old ?location=<room name> link onto the room's id once locations load
  useEffect(() => {
    if (!legacyRoom || legacyRoom === '__none__' || !locations.length) return
    const room = locations.find(l => l.depth === 0 && l.name.toLowerCase() === legacyRoom.toLowerCase())
    setSearchParams(room ? { loc: String(room.id) } : {}, { replace: true })
  }, [legacyRoom, locations])

  // Items are shown when a location is open, or when searching from the rooms view
  const showingItems = Boolean(locParam || search)

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
        if (locParam === 'none') params.unlocated = true
        else if (locParam) params.location_id = locParam   // includes everything inside it
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
  }, [search, catFilter, locParam, showingItems])

  useEffect(() => { load() }, [load])

  const rooms = useMemo(() => locations.filter(l => l.depth === 0), [locations])
  const current = locParam && locParam !== 'none' ? locations.find(l => String(l.id) === locParam) : undefined
  const children = current ? locations.filter(l => l.parent_id === current.id) : []
  // Breadcrumb: Inventory › Office › Bookshelf (the current level is the title)
  const ancestors = useMemo(() => {
    const out: Location[] = []
    let p = current?.parent_id ?? null
    while (p != null) {
      const loc = locations.find(l => l.id === p)
      if (!loc) break
      out.unshift(loc)
      p = loc.parent_id
    }
    return out
  }, [current, locations])
  const roomIcon = (ancestors[0] ?? current)?.icon || '📍'

  const sortedItems = useMemo(() => {
    const cmp = (SORTS[sort] || SORTS.name).cmp
    // name as tiebreaker keeps equal-key items stable and scannable
    return [...items].sort((a, b) => cmp(a, b) || a.name.localeCompare(b.name))
  }, [items, sort])

  async function consume(item: Item, what: 'one' | 'opened') {
    try {
      const updated = await consumeItem(item.id, what)
      toast.success(`${updated.name}: ${updated.open_label ?? `${updated.quantity ?? 0}${updated.unit ? ` ${updated.unit}` : ''} left`}`)
      load()
    } catch (e) {
      toast.error(errorText(e, "Couldn't update that item"))
    }
  }

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

  const title = locParam === 'none' ? 'No location' : current?.name || (search ? 'Search results' : 'Inventory')
  const description = showingItems
    ? `${items.length} item${items.length === 1 ? '' : 's'}${locParam === 'none' ? ' waiting for a location'
        : current ? (current.child_count ? ' here and in the spots inside' : ' here') : ' found'}`
    : `${rooms.length} room${rooms.length === 1 ? '' : 's'}. Open one to see what's inside.`

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
    {
      key: 'location', header: current ? 'Where inside' : 'Location', width: '15rem', sortValue: i => whereFrom(i, current),
      cell: i => <span className="text-muted">{whereFrom(i, current)}</span>,
    },
    {
      key: 'qty', header: 'Qty', width: '11rem', numeric: true, sortValue: i => i.quantity ?? null,
      cell: i => <Quantity item={i} />,
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
        breadcrumb={locParam ? [{ label: 'Inventory', to: '/inventory' }, ...ancestors.map(a => ({ label: a.name, to: `/inventory?loc=${a.id}` }))] : undefined}
        title={current
          ? <span className="flex items-center gap-2"><span aria-hidden>{roomIcon}</span>{title}</span>
          : title}
        description={description}
        actions={<Button variant="primary" icon={Plus} onClick={() => setEditItem(null)}>Add item</Button>}
      />

      {/* Toolbar */}
      <div className="mb-4 flex flex-col gap-2 sm:flex-row">
        <div className="relative flex-1 sm:max-w-sm">
          <Search size={16} aria-hidden className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
          <Input value={search} onChange={e => setSearch(e.target.value)} className="pl-9" aria-label="Search items"
            placeholder={locParam ? `Search in ${locParam === 'none' ? 'unfiled items' : title}` : 'Search all items'} />
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

      {/* Spots inside the current location: open one to narrow down */}
      {children.length > 0 && (
        <nav className="mb-4 flex flex-wrap items-center gap-1.5" aria-label={`Spots inside ${title}`}>
          <span className="mr-1 text-ui text-muted">Inside:</span>
          {children.map(c => (
            <button key={c.id} type="button" onClick={() => openLoc(String(c.id))}
              className="inline-flex h-8 items-center gap-1.5 rounded-full border border-line bg-surface px-3 text-ui text-ink transition-colors hover:border-action hover:text-action">
              {c.name}
              {c.total_count > 0 && <span className="text-muted tnum">{c.total_count}</span>}
              {c.child_count > 0 && <ChevronRight size={13} className="text-muted" aria-hidden />}
            </button>
          ))}
        </nav>
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
            {rooms.map(room => {
              const spots = locations.filter(l => l.parent_id === room.id)
              return (
                <li key={room.id}>
                  <button type="button" onClick={() => openLoc(String(room.id))}
                    className="flex h-full w-full flex-col rounded-panel border border-line bg-surface p-4 text-left transition-colors hover:border-muted/50">
                    <span className="mb-3 text-2xl leading-none" aria-hidden>{room.icon || '📍'}</span>
                    <span className="text-sm font-semibold text-ink">{room.name}</span>
                    <span className="mt-0.5 text-ui text-muted tnum">{room.total_count} item{room.total_count === 1 ? '' : 's'}</span>
                    {spots.length > 0 && <span className="mt-1 truncate text-xs text-muted">{spots.map(sp => sp.name).join(', ')}</span>}
                  </button>
                </li>
              )
            })}
            {unlocatedCount > 0 && (
              <li>
                <button type="button" onClick={() => openLoc('none')}
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
              ...(i.pack_unit && (i.open_amount != null || i.pack_size)
                ? [{ label: `Use one ${i.pack_unit}`, icon: Minus, onSelect: () => consume(i, 'one') }] : []),
              ...(i.open_amount != null
                ? [{ label: 'Finished the open one', icon: PackageCheck, onSelect: () => consume(i, 'opened') }] : []),
              { separator: true },
              { label: 'Delete', icon: Trash2, danger: true, onSelect: () => setDeleting(i) },
            ]}
            mobileRow={i => (
              <div className="flex items-start gap-3">
                <span className="mt-0.5 w-5 text-center leading-none" aria-hidden>{i.category?.icon || '📦'}</span>
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium text-ink">{i.name}</p>
                  <p className="truncate text-ui text-muted">{i.location ? whereFrom(i, current) : i.category?.name || 'No location'}</p>
                  <div className="mt-1 empty:hidden"><ItemStatus item={i} /></div>
                </div>
                <Quantity item={i} />
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
