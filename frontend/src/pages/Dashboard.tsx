import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import toast from 'react-hot-toast'
import {
  AlertTriangle, CalendarDays, Check, ChevronRight, RotateCcw, ShoppingCart, Sparkles, UtensilsCrossed,
} from 'lucide-react'
import {
  completeChore, errorText, getChores, getEvents, getItems, getMeals, getRecipe, getShopping, mediaUrl, uncompleteChore,
  type CalendarEvent, type Chore, type Item, type Meal, type Recipe,
} from '../lib/api'
import { Button, EmptyState, Page, Panel, Skeleton } from '../components/ui'
import { EmeraldMark } from '../components/EmeraldMark'
import { useEmeraldChat } from '../hooks/useEmeraldChat'
import { useAuth } from '../hooks/useAuth'
import { cn } from '../lib/utils'
import { getUse24, formatTime } from '../lib/time'

function ymd(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function greeting(hour: number) {
  return hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening'
}

/** Today: tonight's dinner, what's on, who has what to do, and what Emerald noticed. */
export default function Dashboard() {
  const navigate = useNavigate()
  const { openPanel } = useEmeraldChat()
  const { username } = useAuth()
  const [chores, setChores] = useState<Chore[] | null>(null)
  const [meals, setMeals] = useState<Meal[] | null>(null)
  const [events, setEvents] = useState<CalendarEvent[] | null>(null)
  const [items, setItems] = useState<Item[] | null>(null)
  const [shoppingCount, setShoppingCount] = useState<number | null>(null)
  const [dinnerRecipe, setDinnerRecipe] = useState<Recipe | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(() => {
    setError(null)
    const today = new Date()
    const start = new Date(today); start.setHours(0, 0, 0, 0)
    const end = new Date(start); end.setDate(end.getDate() + 1)
    Promise.all([
      getChores().catch(() => []),
      getMeals(ymd(today), ymd(today)).catch(() => []),
      getEvents(start.toISOString(), end.toISOString()).catch(() => []),
      getItems().catch(() => { throw new Error("The server didn't answer") }),
      getShopping().catch(() => []),
    ]).then(([c, m, e, i, s]) => {
      setChores(c); setMeals(m); setEvents(e); setItems(i)
      setShoppingCount(s.filter(l => !l.checked).length)
      const dinner = m.find(x => x.meal_type === 'dinner' && x.recipe_id)
      if (dinner?.recipe_id) getRecipe(dinner.recipe_id).then(setDinnerRecipe).catch(() => setDinnerRecipe(null))
      else setDinnerRecipe(null)
    }).catch(e => setError(e?.message || "Today couldn't load"))
  }, [])
  useEffect(() => {
    load()
    const timer = setInterval(load, 60000)   // a shared screen stays current
    return () => clearInterval(timer)
  }, [load])

  const todaysChores = useMemo(() => {
    const weekday = (new Date().getDay() + 6) % 7
    return (chores ?? []).filter(c =>
      c.frequency === 'daily' ||
      (c.frequency === 'weekly' && (c.day_of_week == null || c.day_of_week === weekday)) ||
      (c.frequency === 'monthly' && new Date().getDate() === 1) ||
      (c.frequency === 'once' && !c.done_this_period))
  }, [chores])
  const choresDone = todaysChores.filter(c => c.done_this_period).length
  const dinner = (meals ?? []).find(m => m.meal_type === 'dinner')
  const low = (items ?? []).filter(i => i.is_low_stock)
  const expiring = (items ?? []).filter(i => i.expires_soon && !i.is_expired)
  const expired = (items ?? []).filter(i => i.is_expired)

  async function tick(c: Chore) {
    setChores(cur => cur && cur.map(x => (x.id === c.id ? { ...x, done_this_period: !c.done_this_period } : x)))
    try {
      const updated = c.done_this_period ? await uncompleteChore(c.id) : await completeChore(c.id, c.assigned_to || username || undefined)
      setChores(cur => cur && cur.map(x => (x.id === c.id ? updated : x)))
    } catch (e) { toast.error(errorText(e)); load() }
  }

  // Things Emerald noticed, each opening Emerald with the right question
  const nudges = useMemo(() => {
    const n: { key: string; text: string; ask: string }[] = []
    if (meals && !dinner) n.push({ key: 'dinner', text: 'Nothing planned for dinner', ask: 'What can I make for dinner tonight?' })
    if (expired.length) n.push({ key: 'expired', text: `${expired[0].name}${expired.length > 1 ? ` and ${expired.length - 1} more are` : ' is'} past the date`, ask: 'What has expired?' })
    if (expiring.length) n.push({ key: 'exp', text: `${expiring[0].name}${expiring.length > 1 ? ` and ${expiring.length - 1} more` : ''} expire${expiring.length > 1 ? '' : 's'} soon`, ask: 'What recipes could use the food that expires soon?' })
    return n
  }, [meals, dinner, expired, expiring])

  if (error) {
    return (
      <Page>
        <Panel padded={false} className="mx-auto mt-10 max-w-md">
          <EmptyState icon={AlertTriangle} title="Today couldn't load" description={error}
            action={<Button variant="primary" icon={RotateCcw} onClick={load}>Try again</Button>} />
        </Panel>
      </Page>
    )
  }

  const now = new Date()
  const dateText = now.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })
  const photo = mediaUrl(dinnerRecipe?.image_url)
  const loaded = meals !== null && chores !== null && events !== null

  const agenda = [...(events ?? [])].sort((a, b) => (a.all_day === b.all_day ? a.start.localeCompare(b.start) : a.all_day ? -1 : 1))

  return (
    <Page className="space-y-5">
      <header>
        <p className="text-sm font-medium text-honey">{dateText}</p>
        <h1 className="text-2xl font-semibold text-ink">{greeting(now.getHours())}{username ? `, ${username}` : ''}</h1>
      </header>

      {/* Tonight's dinner: the one big thing on the screen */}
      {!loaded ? (
        <Skeleton className="h-52 w-full rounded-panel" />
      ) : (
        <Link
          to={dinner?.recipe_id ? `/recipes/${dinner.recipe_id}` : '/meals'}
          className="group relative block overflow-hidden rounded-panel border border-line bg-surface"
        >
          {photo ? (
            <div className="relative h-52 sm:h-64">
              <img src={photo} alt="" className="h-full w-full object-cover" />
              <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/10 to-transparent" aria-hidden />
              <div className="absolute inset-x-0 bottom-0 p-4 text-white">
                <p className="text-xs font-medium uppercase tracking-wide opacity-90">Dinner tonight</p>
                <p className="text-xl font-semibold leading-tight">{dinner?.title}</p>
              </div>
            </div>
          ) : (
            <div className="flex items-center gap-4 p-5">
              <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-honey/15 text-honey">
                <UtensilsCrossed size={26} aria-hidden />
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-xs font-medium uppercase tracking-wide text-muted">Dinner tonight</p>
                <p className="truncate text-xl font-semibold text-ink">{dinner ? dinner.title : 'Not planned yet'}</p>
                {!dinner && <p className="text-sm text-muted">Tap to plan something</p>}
              </div>
              <ChevronRight size={20} aria-hidden className="text-muted" />
            </div>
          )}
        </Link>
      )}

      {nudges.length > 0 && (
        <ul className="space-y-2" aria-label="Emerald noticed">
          {nudges.map(n => (
            <li key={n.key}>
              <button
                type="button"
                onClick={() => openPanel(n.ask)}
                className="flex min-h-12 w-full items-center gap-3 rounded-panel border border-emerald/30 bg-emerald/[0.07] px-4 py-2 text-left"
              >
                <EmeraldMark size={20} className="text-emerald" />
                <span className="flex-1 text-sm text-ink">{n.text}</span>
                <span className="flex items-center gap-1 text-xs font-medium text-emerald">Ask <Sparkles size={12} aria-hidden /></span>
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="grid items-start gap-5 md:grid-cols-2">
        <Panel title="On today" padded={false}
          actions={<Button size="sm" variant="ghost" onClick={() => navigate('/calendar')}>Calendar</Button>}>
          {!loaded ? (
            <div className="space-y-3 p-4">{[0, 1].map(i => <Skeleton key={i} className="h-5" />)}</div>
          ) : agenda.length === 0 ? (
            <EmptyState icon={CalendarDays} title="A free day" description="Nothing on the calendar." className="py-8" />
          ) : (
            <ul className="divide-y divide-line">
              {agenda.map(e => (
                <li key={e.id} className="flex min-h-14 items-center gap-3 px-4 py-2">
                  <span className="h-8 w-1 shrink-0 rounded-full" style={{ background: e.color || 'rgb(var(--action))' }} aria-hidden />
                  <span className="min-w-0 flex-1 truncate text-base text-ink">{e.title}</span>
                  <span className="text-sm text-muted tnum">{e.all_day ? 'All day' : formatTime(e.start.slice(11, 16), getUse24())}</span>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel
          title={`Chores${todaysChores.length ? ` · ${choresDone} of ${todaysChores.length}` : ''}`}
          padded={false}
          actions={<Button size="sm" variant="ghost" onClick={() => navigate('/chores')}>All chores</Button>}
        >
          {!loaded ? (
            <div className="space-y-3 p-4">{[0, 1].map(i => <Skeleton key={i} className="h-5" />)}</div>
          ) : todaysChores.length === 0 ? (
            <EmptyState title="No chores today" className="py-8" />
          ) : (
            <ul className="divide-y divide-line">
              {todaysChores.map(c => (
                <li key={c.id}>
                  <button
                    type="button"
                    role="checkbox"
                    aria-checked={c.done_this_period}
                    onClick={() => tick(c)}
                    className="flex min-h-14 w-full items-center gap-3 px-4 py-2 text-left active:bg-ink/[0.04]"
                  >
                    <span className={cn(
                      'flex h-7 w-7 shrink-0 items-center justify-center rounded-full border-2 transition-colors',
                      c.done_this_period ? 'border-action bg-action text-action-on' : 'border-muted/60',
                    )}>
                      {c.done_this_period && <Check size={16} strokeWidth={3} aria-hidden />}
                    </span>
                    <span className="text-lg leading-none" aria-hidden>{c.icon || '🧹'}</span>
                    <span className={cn('min-w-0 flex-1 truncate text-base text-ink', c.done_this_period && 'text-muted line-through')}>{c.title}</span>
                    <span className="text-xs text-muted">{c.assigned_to || 'Anyone'}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <Link to="/shopping" className="flex min-h-16 items-center gap-3 rounded-panel border border-line bg-surface px-4 py-3 active:bg-ink/[0.04]">
          <ShoppingCart size={22} aria-hidden className="text-action" />
          <span className="flex-1">
            <span className="block text-base font-medium text-ink">Shopping list</span>
            <span className="block text-sm text-muted">{shoppingCount === null ? ' ' : shoppingCount ? `${shoppingCount} to buy` : 'Nothing to buy'}</span>
          </span>
          <ChevronRight size={18} aria-hidden className="text-muted" />
        </Link>
        <Link to="/alerts" className="flex min-h-16 items-center gap-3 rounded-panel border border-line bg-surface px-4 py-3 active:bg-ink/[0.04]">
          <AlertTriangle size={22} aria-hidden className={low.length ? 'text-warn' : 'text-muted'} />
          <span className="flex-1">
            <span className="block text-base font-medium text-ink">Running low</span>
            <span className="block truncate text-sm text-muted">
              {items === null ? ' ' : low.length ? low.slice(0, 3).map(i => i.name).join(', ') + (low.length > 3 ? ` +${low.length - 3}` : '') : 'Nothing is low'}
            </span>
          </span>
          <ChevronRight size={18} aria-hidden className="text-muted" />
        </Link>
      </div>
    </Page>
  )
}
