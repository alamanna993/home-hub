import { useEffect, useState, useCallback, useMemo } from 'react'
import { useSearchParams } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { Plus, Search, Trash2, Edit2, AlertTriangle, ArrowLeft, Inbox } from 'lucide-react'
import { getItems, getCategories, getLocations, deleteItem, Item, Category, Location } from '../lib/api'
import ItemModal from '../components/ItemModal'
import { cn } from '../lib/utils'
import toast from 'react-hot-toast'

interface Room {
  name: string
  icon?: string
  count: number
  subs: { id: number; name: string }[]
}

export default function Inventory() {
  const [items, setItems] = useState<Item[]>([])
  const [categories, setCategories] = useState<Category[]>([])
  const [locations, setLocations] = useState<Location[]>([])
  const [unlocatedCount, setUnlocatedCount] = useState(0)
  const [search, setSearch] = useState('')
  const [catFilter, setCatFilter] = useState('')
  const [editItem, setEditItem] = useState<Item | null | undefined>(undefined)
  const [loading, setLoading] = useState(true)
  const [searchParams, setSearchParams] = useSearchParams()
  const roomFilter = searchParams.get('location') || ''
  const subFilter = searchParams.get('sub') || ''

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
      toast.error('Could not load inventory — is the backend running?')
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

  const chip = (active: boolean) => cn(
    'flex items-center gap-1.5 px-3.5 py-2 rounded-full text-sm font-medium border transition-all whitespace-nowrap',
    active
      ? 'bg-accent/20 border-accent text-accent'
      : 'bg-surface-card border-surface-border text-surface-muted hover:text-white hover:border-surface-muted'
  )

  // Date-only strings ("2026-07-10") must not go through new Date() — UTC parsing can shift them a day
  const fmtDay = (iso: string) => {
    const [y, m, d] = iso.slice(0, 10).split('-').map(Number)
    return new Date(y, m - 1, d).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
  }

  async function handleDelete(item: Item) {
    if (!confirm(`Delete "${item.name}"?`)) return
    await deleteItem(item.id)
    toast.success('Item deleted')
    load()
  }

  const title = roomFilter === '__none__' ? '📭 No location'
    : roomFilter ? `${currentRoom?.icon || '📍'} ${roomFilter}`
    : search ? 'Search results'
    : 'Inventory'

  return (
    <div className="p-6 space-y-5">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          {roomFilter && (
            <button onClick={() => openRoom('')}
              className="flex items-center gap-1.5 text-surface-muted hover:text-white text-xs font-medium mb-1.5 transition-all">
              <ArrowLeft size={13} /> All locations
            </button>
          )}
          <h2 className="text-white text-2xl font-bold truncate">{title}</h2>
          <p className="text-surface-muted text-sm mt-1">
            {showingItems
              ? `${items.length} item${items.length === 1 ? '' : 's'}${
                  roomFilter === '__none__' ? ' without a location'
                    : subFilter ? ` in ${currentRoom?.subs.find(s => String(s.id) === subFilter)?.name || 'this spot'}`
                    : roomFilter ? ' in this room' : ' found'}`
              : `${rooms.length} location${rooms.length === 1 ? '' : 's'} — tap one to see what's inside`}
          </p>
        </div>
        <button onClick={() => setEditItem(null)}
          className="flex items-center gap-2 bg-accent hover:bg-accent-hover text-white text-sm font-medium px-4 py-2 rounded-lg transition-all shadow-glow flex-shrink-0">
          <Plus size={16} /> Add Item
        </button>
      </div>

      {/* Search */}
      <div className="relative">
        <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-surface-muted" />
        <input className="w-full bg-surface-card border border-surface-border rounded-lg pl-9 pr-3 py-2.5 text-white text-sm focus:outline-none focus:border-accent"
          placeholder={roomFilter ? `Search in ${roomFilter === '__none__' ? 'unfiled items' : roomFilter}…` : 'Search all items…'}
          value={search} onChange={e => setSearch(e.target.value)} />
      </div>

      {/* Sub-location chips (inside a room) */}
      {roomFilter && roomFilter !== '__none__' && (currentRoom?.subs.length ?? 0) > 0 && (
        <div className="flex gap-2 flex-wrap">
          <button className={chip(!subFilter)} onClick={() => setSubFilter('')}>
            <span>{currentRoom?.icon || '📍'}</span> All of {roomFilter}
          </button>
          {currentRoom!.subs.map(s => (
            <button key={s.id} className={chip(subFilter === String(s.id))}
              onClick={() => setSubFilter(subFilter === String(s.id) ? '' : String(s.id))}>
              <span>🗄️</span> {s.name}
            </button>
          ))}
        </div>
      )}

      {/* Category chips (only when looking at items) */}
      {showingItems && (
        <div className="flex gap-2 flex-wrap">
          <button className={chip(!catFilter)} onClick={() => setCatFilter('')}>🏷️ All Categories</button>
          {categories.map(c => (
            <button key={c.id} className={chip(catFilter === String(c.id))}
              onClick={() => setCatFilter(catFilter === String(c.id) ? '' : String(c.id))}>
              <span>{c.icon || '🏷️'}</span> {c.name}
            </button>
          ))}
        </div>
      )}

      {loading ? (
        <div className="flex justify-center py-16">
          <div className="w-8 h-8 border-2 border-accent border-t-transparent rounded-full animate-spin" />
        </div>
      ) : !showingItems ? (
        /* ------- Location tiles ------- */
        rooms.length === 0 && unlocatedCount === 0 ? (
          <div className="text-center py-16 text-surface-muted">
            <p className="text-4xl mb-3">📍</p>
            <p className="text-sm">No locations yet — create rooms on the Locations page, or just add an item.</p>
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-4 gap-4">
            <AnimatePresence>
              {rooms.map((room, i) => (
                <motion.button key={room.name}
                  initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: i * 0.03 }}
                  onClick={() => openRoom(room.name)}
                  className="bg-surface-card border border-surface-border rounded-2xl p-5 shadow-card text-left hover:border-accent transition-all group">
                  <div className="text-3xl mb-3">{room.icon || '📍'}</div>
                  <p className="text-white font-semibold text-sm leading-snug">{room.name}</p>
                  <p className="text-surface-muted text-xs mt-1">
                    {room.count} item{room.count === 1 ? '' : 's'}
                  </p>
                  {room.subs.length > 0 && (
                    <p className="text-surface-muted text-xs mt-0.5 truncate">
                      🗄️ {room.subs.map(s => s.name).join(', ')}
                    </p>
                  )}
                </motion.button>
              ))}
              {unlocatedCount > 0 && (
                <motion.button key="__none__"
                  initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: rooms.length * 0.03 }}
                  onClick={() => openRoom('__none__')}
                  className="bg-surface-card border border-orange-500/40 rounded-2xl p-5 shadow-card text-left hover:border-orange-400 transition-all">
                  <div className="mb-3"><Inbox size={30} className="text-orange-400" /></div>
                  <p className="text-white font-semibold text-sm leading-snug">No location</p>
                  <p className="text-surface-muted text-xs mt-1">
                    {unlocatedCount} item{unlocatedCount === 1 ? '' : 's'} waiting to be filed
                  </p>
                </motion.button>
              )}
            </AnimatePresence>
          </div>
        )
      ) : items.length === 0 ? (
        <div className="text-center py-16 text-surface-muted">
          <p className="text-4xl mb-3">📭</p>
          <p className="text-sm">No items found. Add one or text the bot!</p>
        </div>
      ) : (
        /* ------- Items grid ------- */
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
          <AnimatePresence>
            {items.map((item, i) => (
              <motion.div key={item.id}
                initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.03 }}
                className={`bg-surface-card border rounded-2xl p-4 shadow-card group relative ${
                  item.is_expired ? 'border-red-500/40'
                    : item.is_low_stock || item.expires_soon ? 'border-orange-500/40'
                    : 'border-surface-border'
                }`}
              >
                {(item.is_low_stock || item.is_expired || item.expires_soon) && (
                  <div className="absolute top-3 right-3">
                    <AlertTriangle size={14} className={item.is_expired ? 'text-red-400' : 'text-orange-400'} />
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
                  {item.expiration_date && (
                    <p className={item.is_expired ? 'text-red-400 font-medium' : item.expires_soon ? 'text-orange-400 font-medium' : ''}>
                      ⏳ {item.is_expired ? 'Expired' : 'Expires'} {fmtDay(item.expiration_date)}
                    </p>
                  )}
                  <p>📅 Entered {fmtDay(item.created_at)}</p>
                  {item.notes && <p className="text-surface-muted truncate">💬 {item.notes}</p>}
                </div>
                <div className="flex gap-2 mt-3 opacity-100 lg:opacity-0 lg:group-hover:opacity-100 lg:focus-within:opacity-100 transition-opacity">
                  <button onClick={() => setEditItem(item)}
                    className="flex-1 flex items-center justify-center gap-1.5 text-xs py-2.5 rounded-lg border border-surface-border text-surface-muted hover:text-white hover:border-accent transition-all">
                    <Edit2 size={14} /> Edit
                  </button>
                  <button onClick={() => handleDelete(item)}
                    className="flex-1 flex items-center justify-center gap-1.5 text-xs py-2.5 rounded-lg border border-surface-border text-surface-muted hover:text-red-400 hover:border-red-500/40 transition-all">
                    <Trash2 size={14} /> Delete
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
