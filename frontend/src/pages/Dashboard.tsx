import { ReactNode, useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { AlertTriangle, CalendarDays, CheckCircle2, ChevronRight, ClipboardList, RotateCcw, UtensilsCrossed } from 'lucide-react'
import {
  getChores, getEvents, getItems, getLocations, getMeals, getStats,
  type CalendarEvent, type Chore, type Item, type Location, type Meal, type Stats,
} from '../lib/api'
import { Badge, Button, DataTable, EmptyState, Page, PageHeader, Panel, Skeleton, type Column } from '../components/ui'
import { EmeraldMark } from '../components/EmeraldMark'
import { useEmeraldChat } from '../hooks/useEmeraldChat'
import { cn, timeAgo } from '../lib/utils'
import { getUse24, formatTime } from '../lib/time'

function ymd(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

const MEAL_ORDER = { breakfast: 0, lunch: 1, snack: 2, dinner: 3 }
const MEAL_TIME: Record<string, string> = { breakfast: '08:00', lunch: '12:00', snack: '15:00', dinner: '18:00' }

type Activity = Stats['recent_activity'][number]

const ROOM_FALLBACK_ICONS: Record<string, string> = {
  kitchen: '🍳', garage: '🚗', 'living room': '🛋️', basement: '🏚️', bedroom: '🛏️',
  office: '💻', bathroom: '🚿', laundry: '🧺', attic: '📦', closet: '🚪', workshop: '🔧',
}

export default function Dashboard() {
  const navigate = useNavigate()
  const { openPanel } = useEmeraldChat()
  const [stats, setStats] = useState<Stats | null>(null)
  const [locations, setLocations] = useState<Location[]>([])
  const [chores, setChores] = useState<Chore[]>([])
  const [meals, setMeals] = useState<Meal[]>([])
  const [events, setEvents] = useState<CalendarEvent[]>([])
  const [low, setLow] = useState<Item[]>([])
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
      getItems({ low_stock_only: true }).catch(() => []),
    ]).then(([s, l, c, m, e, lo]) => {
      setStats(s); setLocations(l); setChores(c); setMeals(m); setEvents(e); setLow(lo)
    }).catch(e => setError(e?.response?.data?.detail || e?.message || "The overview couldn't load"))
  }
  useEffect(() => { load() }, [])

  // Rooms (top-level locations), counting everything stored anywhere inside them
  const rooms = useMemo(() => {
    return locations.filter(l => l.depth === 0)
      .map(l => ({ id: l.id, name: l.name, icon: l.icon ?? undefined, count: l.total_count }))
      .sort((a, b) => b.count - a.count)
  }, [locations])

  // Chores that matter today (same rules as the calendar page)
  const todaysChores = useMemo(() => {
    const weekday = (new Date().getDay() + 6) % 7
    return chores.filter(c =>
      c.frequency === 'daily' ||
      (c.frequency === 'weekly' && (c.day_of_week == null || c.day_of_week === weekday)) ||
      (c.frequency === 'monthly' && new Date().getDate() === 1) ||
      (c.frequency === 'once' && !c.done_this_period))
  }, [chores])
  const choresDone = todaysChores.filter(c => c.done_this_period).length
  const dinner = meals.find(m => m.meal_type === 'dinner')

  // One time-ordered agenda: events, meals at their usual hour, then chores
  const agenda = useMemo(() => {
    const rows: { key: string; time: string | null; sort: string; icon: ReactNode; title: ReactNode; meta?: ReactNode; done?: boolean }[] = []
    for (const e of events) {
      rows.push({
        key: `e${e.id}`, time: e.all_day ? null : formatTime(e.start.slice(11, 16), getUse24()), sort: e.all_day ? '00:00' : e.start.slice(11, 16),
        icon: <span className="h-2 w-2 rounded-full" style={{ background: e.color || 'rgb(var(--action))' }} />,
        title: e.title, meta: e.all_day ? 'All day' : undefined,
      })
    }
    for (const m of [...meals].sort((a, b) => MEAL_ORDER[a.meal_type] - MEAL_ORDER[b.meal_type])) {
      rows.push({
        key: `m${m.id}`, time: null, sort: MEAL_TIME[m.meal_type],
        icon: <UtensilsCrossed size={14} className="text-muted" />,
        title: m.recipe_id ? <Link to={`/recipes/${m.recipe_id}`} className="hover:underline">{m.title}</Link> : m.title,
        meta: <span className="capitalize">{m.meal_type}</span>,
      })
    }
    for (const c of todaysChores) {
      rows.push({
        key: `c${c.id}`, time: null, sort: '99', done: c.done_this_period,
        icon: <span className="text-sm leading-none">{c.icon || '🧹'}</span>,
        title: c.title, meta: c.assigned_to || 'Anyone',
      })
    }
    return rows.sort((a, b) => a.sort.localeCompare(b.sort))
  }, [events, meals, todaysChores])

  if (error) {
    return (
      <Page>
        <Panel padded={false} className="mx-auto mt-10 max-w-md">
          <EmptyState icon={AlertTriangle} title="The overview couldn't load" description={error}
            action={<Button variant="primary" icon={RotateCcw} onClick={load}>Try again</Button>} />
        </Panel>
      </Page>
    )
  }

  const today = new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })

  const activityColumns: Column<Activity>[] = [
    { key: 'item', header: 'Item', cell: a => <span className="font-medium text-ink">{a.item}</span> },
    {
      key: 'action', header: 'Change', width: '7rem',
      cell: a => <Badge tone={a.action === 'deleted' ? 'danger' : a.action === 'created' ? 'action' : 'neutral'}>
        {a.action === 'created' ? 'Added' : a.action === 'updated' ? 'Updated' : 'Removed'}
      </Badge>,
    },
    { key: 'details', header: 'Details', hideBelow: 'lg', cell: a => <span className="text-muted">{a.details || '—'}</span> },
    { key: 'by', header: 'By', width: '8rem', hideBelow: 'xl', cell: a => <span className="text-muted">{a.by}</span> },
    { key: 'at', header: 'When', width: '6rem', numeric: true, cell: a => <span className="text-muted">{timeAgo(a.at)}</span> },
  ]

  return (
    <Page>
      <PageHeader title="Overview" description={today}
        actions={<Button onClick={() => openPanel()}>
          <EmeraldMark size={16} className="text-emerald" />Ask Emerald
        </Button>} />

      {/* Key numbers */}
      <Panel padded={false} className="mb-6">
        <div className="grid grid-cols-2 lg:grid-cols-4">
          <Kpi i={0} label="Items tracked" value={stats ? stats.total_items : null} to="/inventory" />
          <Kpi i={1} label="Running low" value={stats ? stats.low_stock_count : null} to="/alerts"
            tone={stats && stats.low_stock_count > 0 ? 'warn' : undefined}
            sub={stats ? (stats.low_stock_count ? 'Needs restocking' : 'Nothing low') : undefined} />
          <Kpi i={2} label="Chores today" value={stats ? (todaysChores.length ? `${choresDone} of ${todaysChores.length}` : 'None') : null} to="/chores"
            sub={todaysChores.length && choresDone === todaysChores.length ? 'All done' : undefined} />
          <Kpi i={3} label="Dinner tonight" value={stats ? (dinner ? null : 'Not planned') : null} to={dinner?.recipe_id ? `/recipes/${dinner.recipe_id}` : '/meals'}
            text={dinner?.title} />
        </div>
      </Panel>

      <div className="grid items-start gap-6 lg:grid-cols-3">
        <Panel title="Today" className="lg:col-span-2" padded={false}
          actions={<Button size="sm" variant="ghost" onClick={() => navigate('/calendar')}>Open calendar</Button>}>
          {!stats ? (
            <div className="space-y-3 p-4">{[0, 1, 2].map(i => <Skeleton key={i} className="h-5" />)}</div>
          ) : agenda.length === 0 ? (
            <EmptyState icon={CalendarDays} title="Nothing on today" description="No events, meals, or chores are scheduled." />
          ) : (
            <ul className="divide-y divide-line">
              {agenda.map(r => (
                <li key={r.key} className="grid grid-cols-[1rem_1fr_auto] items-center gap-3 px-4 py-2.5 text-sm sm:grid-cols-[4.5rem_1rem_1fr_auto]">
                  <span className="hidden text-ui text-muted tnum sm:block">{r.time ?? ''}</span>
                  <span className="flex justify-center">{r.icon}</span>
                  <span className={cn('min-w-0 truncate text-ink', r.done && 'text-muted line-through')}>{r.title}</span>
                  <span className="flex items-center gap-1.5 text-ui text-muted">
                    {r.done && <CheckCircle2 size={14} className="text-action" aria-label="Done" />}
                    {r.time && <span className="tnum sm:hidden">{r.time}</span>}{r.meta}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <div className="space-y-6">
          <Panel title="Running low" padded={false}
            actions={low.length > 0 && <Button size="sm" variant="ghost" onClick={() => navigate('/alerts')}>See all</Button>}>
            {low.length === 0 ? (
              <p className="px-4 py-3 text-sm text-muted">{stats ? 'Nothing is running low.' : ' '}</p>
            ) : (
              <ul className="divide-y divide-line">
                {low.slice(0, 6).map(i => (
                  <li key={i.id} className="flex items-center gap-3 px-4 py-2 text-sm">
                    <span className="min-w-0 flex-1 truncate text-ink">{i.name}</span>
                    <span className="text-ui text-warn tnum">{i.open_label ?? `${i.quantity ?? 0}${i.unit ? ` ${i.unit}` : ''} left`}</span>
                  </li>
                ))}
              </ul>
            )}
          </Panel>

          <Panel title="Rooms" padded={false}
            actions={<Button size="sm" variant="ghost" onClick={() => navigate('/locations')}>Manage</Button>}>
            {rooms.length === 0 ? (
              <p className="px-4 py-3 text-sm text-muted">No rooms yet. <Link to="/locations" className="text-action hover:underline">Add one</Link>.</p>
            ) : (
              <ul className="divide-y divide-line">
                {rooms.slice(0, 8).map(room => (
                  <li key={room.id}>
                    <Link to={`/inventory?loc=${room.id}`}
                      className="flex items-center gap-3 px-4 py-2 text-sm hover:bg-ink/[0.03]">
                      <span className="w-5 text-center leading-none" aria-hidden>{room.icon || ROOM_FALLBACK_ICONS[room.name.toLowerCase()] || '📍'}</span>
                      <span className="flex-1 text-ink">{room.name}</span>
                      <span className="text-ui text-muted tnum">{room.count}</span>
                      <ChevronRight size={14} className="text-muted" aria-hidden />
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </div>
      </div>

      <Panel title="Recent activity" padded={false} className="mt-6"
        actions={<ClipboardList size={16} className="text-muted" aria-hidden />}>
        <DataTable columns={activityColumns} rows={stats?.recent_activity.slice(0, 10) || []} rowKey={a => `${a.at}${a.item}${a.action}`}
          loading={!stats} caption="Recent inventory activity"
          empty={<EmptyState title="No activity yet" description="Changes to the inventory show up here." />} />
      </Panel>
    </Page>
  )
}

/** One cell of the 2×2 (phone) / 1×4 (desktop) key-number grid; `i` places the dividers */
function Kpi({ i, label, value, sub, text, to, tone }: {
  i: number; label: string; value: ReactNode | null; sub?: string; text?: string; to: string; tone?: 'warn'
}) {
  return (
    <Link to={to} className={cn('group block border-line px-4 py-3.5 hover:bg-ink/[0.03] lg:px-5',
      i % 2 === 0 && 'border-r', i < 2 && 'border-b lg:border-b-0', i === 1 && 'lg:border-r')}>
      <span className="block text-ui text-muted">{label}</span>
      <span className="mt-1 block">
        {text ? (
          <span className="block truncate text-base font-semibold text-ink group-hover:underline">{text}</span>
        ) : value === null && !text ? (
          <Skeleton className="h-7 w-16" />
        ) : (
          <span className={cn('block text-2xl font-semibold text-ink tnum', tone === 'warn' && 'text-warn')}>{value}</span>
        )}
        {sub && <span className="mt-0.5 block text-xs text-muted">{sub}</span>}
      </span>
    </Link>
  )
}
