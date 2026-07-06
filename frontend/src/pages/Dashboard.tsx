import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { motion } from 'framer-motion'
import { AlertTriangle, Clock } from 'lucide-react'
import { getStats, getLocations, getChores, getMeals, getEvents, Stats, Location, Chore, Meal, CalendarEvent } from '../lib/api'
import StatCard from '../components/StatCard'
import { timeAgo } from '../lib/utils'

function ymd(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

const ROOM_FALLBACK_ICONS: Record<string, string> = {
  kitchen: '🍳', garage: '🚗', 'living room': '🛋️', basement: '🏚️', bedroom: '🛏️',
  office: '💻', bathroom: '🚿', laundry: '🧺', attic: '📦', closet: '🚪',
}

export default function Dashboard() {
  const navigate = useNavigate()
  const [stats, setStats] = useState<Stats | null>(null)
  const [locations, setLocations] = useState<Location[]>([])
  const [chores, setChores] = useState<Chore[]>([])
  const [meals, setMeals] = useState<Meal[]>([])
  const [events, setEvents] = useState<CalendarEvent[]>([])
  const [error, setError] = useState<string | null>(null)

  function load() {
    setError(null)
    const today = new Date()
    const start = new Date(today); start.setHours(0, 0, 0, 0)
    const end = new Date(start); end.setDate(end.getDate() + 1)
    Promise.all([
      getStats(),
      getLocations(),
      getChores().catch(() => []),
      getMeals(ymd(today), ymd(today)).catch(() => []),
      getEvents(start.toISOString(), end.toISOString()).catch(() => []),
    ]).then(([s, l, c, m, e]) => {
      setStats(s); setLocations(l); setChores(c); setMeals(m); setEvents(e)
    }).catch(e => setError(e?.response?.data?.detail || e?.message || 'Could not load stats'))
  }
  useEffect(() => { load() }, [])

  // Group sub-locations (Kitchen/Pantry, Kitchen/Fridge…) into one room tile
  const rooms = useMemo(() => {
    const map: Record<string, { name: string; icon?: string; count: number }> = {}
    for (const l of locations) {
      const room = (map[l.name] ||= { name: l.name, icon: undefined, count: 0 })
      room.count += l.item_count
      if (!room.icon && l.icon) room.icon = l.icon
    }
    return Object.values(map).sort((a, b) => b.count - a.count)
  }, [locations])

  // Chores that matter today (same rules as the calendar page)
  const todaysChores = useMemo(() => {
    const weekday = (new Date().getDay() + 6) % 7
    return chores.filter(c =>
      c.frequency === 'daily' ||
      (c.frequency === 'weekly' && (c.day_of_week == null || c.day_of_week === weekday)) ||
      (c.frequency === 'monthly' && new Date().getDate() === 1) ||
      (c.frequency === 'once' && !c.done_this_period)
    )
  }, [chores])
  const choresDone = todaysChores.filter(c => c.done_this_period).length

  const dinner = meals.find(m => m.meal_type === 'dinner')

  if (error) {
    return (
      <div className="p-6">
        <div className="bg-surface-card border border-red-500/30 rounded-2xl p-6 max-w-md mx-auto mt-16 text-center space-y-3">
          <p className="text-3xl">⚠️</p>
          <p className="text-white font-medium text-sm">Couldn't load the dashboard</p>
          <p className="text-surface-muted text-xs">{error}</p>
          <button onClick={load}
            className="bg-accent hover:bg-accent-hover text-white text-sm font-medium px-5 py-2 rounded-lg transition-all">
            Retry
          </button>
        </div>
      </div>
    )
  }

  if (!stats) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-8 h-8 border-2 border-accent border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  return (
    <div className="p-6 space-y-6">
      <div>
        <h2 className="text-white text-2xl font-bold">Dashboard</h2>
        <p className="text-surface-muted text-sm mt-1">
          {new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })}
        </p>
      </div>

      <div className="grid grid-cols-2 xl:grid-cols-4 gap-4">
        <StatCard label="Total Items" value={stats.total_items} icon="📦" color="#6366f1" />
        <StatCard
          label="Low Stock" value={stats.low_stock_count} icon="⚠️" color="#f59e0b"
          alert={stats.low_stock_count > 0}
          sub={stats.low_stock_count > 0 ? 'needs restocking' : 'all good'}
        />
        <StatCard label="Chores Today" value={todaysChores.length ? `${choresDone}/${todaysChores.length}` : '—'}
          icon="✅" color="#22c55e"
          sub={todaysChores.length && choresDone === todaysChores.length ? 'all done! 🎉' : undefined} />
        <StatCard label="Dinner Tonight" value={dinner ? '' : '—'} icon="🍽️" color="#ec4899"
          sub={dinner ? dinner.title : 'nothing planned yet'} />
      </div>

      {/* Rooms — tap to browse that room's inventory */}
      <div>
        <h3 className="text-white font-semibold mb-3">Rooms</h3>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3">
          {rooms.map((room, i) => (
            <motion.button key={room.name}
              initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.04 }}
              onClick={() => navigate(`/inventory?location=${encodeURIComponent(room.name)}`)}
              className="bg-surface-card border border-surface-border hover:border-accent rounded-2xl p-4 flex flex-col items-center gap-2 shadow-card transition-all hover:scale-[1.03] active:scale-95">
              <span className="text-4xl leading-none">
                {room.icon || ROOM_FALLBACK_ICONS[room.name.toLowerCase()] || '📍'}
              </span>
              <span className="text-white text-sm font-semibold text-center leading-tight">{room.name}</span>
              <span className="text-surface-muted text-xs">{room.count} item{room.count === 1 ? '' : 's'}</span>
            </motion.button>
          ))}
          {rooms.length === 0 && (
            <p className="text-surface-muted text-sm col-span-full">No rooms yet — add some on the Locations page.</p>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Today */}
        <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }}
          className="bg-surface-card border border-surface-border rounded-2xl p-5 shadow-card">
          <h3 className="text-white font-semibold mb-4">📅 Today</h3>
          <div className="space-y-2">
            {events.map(e => (
              <div key={e.id} className="flex items-center gap-2.5 text-sm">
                <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: e.color || '#6366f1' }} />
                {!e.all_day && <span className="text-surface-muted text-xs font-mono">{e.start.slice(11, 16)}</span>}
                <span className="text-white truncate">{e.title}</span>
              </div>
            ))}
            {meals.map(m => (
              <div key={`m${m.id}`} className="flex items-center gap-2.5 text-sm">
                <span className="text-base">🍽️</span>
                <span className="text-surface-muted text-xs capitalize">{m.meal_type}</span>
                <span className="text-white truncate">{m.title}</span>
              </div>
            ))}
            {todaysChores.filter(c => !c.done_this_period).map(c => (
              <div key={`c${c.id}`} className="flex items-center gap-2.5 text-sm">
                <span className="text-base">{c.icon || '🧹'}</span>
                <span className="text-white truncate">{c.title}</span>
                {c.assigned_to && <span className="text-surface-muted text-xs ml-auto">{c.assigned_to}</span>}
              </div>
            ))}
            {events.length === 0 && meals.length === 0 && todaysChores.filter(c => !c.done_this_period).length === 0 && (
              <p className="text-surface-muted text-sm">Nothing on the schedule — enjoy the quiet! ✨</p>
            )}
          </div>
        </motion.div>

        {/* Recent Activity */}
        <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}
          className="bg-surface-card border border-surface-border rounded-2xl p-5 shadow-card">
          <h3 className="text-white font-semibold mb-4 flex items-center gap-2">
            <Clock size={16} className="text-accent" /> Recent Activity
          </h3>
          {stats.recent_activity.length > 0 ? (
            <div className="space-y-3">
              {stats.recent_activity.slice(0, 8).map((a, i) => (
                <div key={i} className="flex items-start gap-3 text-sm">
                  <span className="mt-0.5 text-base">
                    {a.action === 'created' ? '✅' : a.action === 'updated' ? '✏️' : '🗑️'}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-white font-medium truncate">{a.item}</p>
                    <p className="text-surface-muted text-xs">{a.details}</p>
                  </div>
                  <span className="text-surface-muted text-xs flex-shrink-0 mt-0.5">{timeAgo(a.at)}</span>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-surface-muted text-sm">No activity yet.</p>
          )}
        </motion.div>
      </div>

      {/* Low Stock Alert Banner */}
      {stats.low_stock_count > 0 && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}
          onClick={() => navigate('/alerts')}
          className="bg-orange-500/10 border border-orange-500/30 rounded-2xl p-4 flex items-center gap-3 cursor-pointer hover:bg-orange-500/15 transition-all">
          <AlertTriangle size={20} className="text-orange-400 flex-shrink-0" />
          <div>
            <p className="text-orange-300 font-medium text-sm">
              {stats.low_stock_count} item{stats.low_stock_count > 1 ? 's are' : ' is'} running low
            </p>
            <p className="text-orange-400/70 text-xs mt-0.5">Tap to see what needs restocking.</p>
          </div>
        </motion.div>
      )}
    </div>
  )
}
