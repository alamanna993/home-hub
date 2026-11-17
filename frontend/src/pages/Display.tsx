import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import toast from 'react-hot-toast'
import { Check, ShoppingCart, UtensilsCrossed, X } from 'lucide-react'
import {
  completeChore, errorText, getChores, getEvents, getFamily, getMeals, getRecipe, getShopping, mediaUrl, uncompleteChore,
  type CalendarEvent, type Chore, type FamilyMember, type Meal, type Recipe,
} from '../lib/api'
import { EmeraldChatProvider, useEmeraldChat } from '../hooks/useEmeraldChat'
import EmeraldPanel from '../components/EmeraldPanel'
import { EmeraldMark } from '../components/EmeraldMark'
import PersonAvatar from '../components/PersonAvatar'
import { cn } from '../lib/utils'
import { formatTime, getUse24 } from '../lib/time'

const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
const NIGHT_FROM = 22   // dim from 10pm
const NIGHT_TO = 6      // until 6am

/** Keep the screen on: the Wake Lock API where the browser allows it (https), otherwise a looping
 *  video, the long-standing trick. Neither is certain on every tablet, so the page also says what to set. */
function useAwake() {
  const [method, setMethod] = useState<'lock' | 'video' | 'none'>('none')
  const video = useRef<HTMLVideoElement | null>(null)
  useEffect(() => {
    let lock: { release: () => Promise<void> } | null = null
    let cancelled = false
    const nav = navigator as Navigator & { wakeLock?: { request: (t: 'screen') => Promise<{ release: () => Promise<void> }> } }

    async function acquire() {
      if (nav.wakeLock) {
        try { lock = await nav.wakeLock.request('screen'); if (!cancelled) setMethod('lock'); return } catch { /* fall through */ }
      }
      try {
        const canvas = document.createElement('canvas')
        canvas.width = canvas.height = 16
        const ctx = canvas.getContext('2d')!
        const tick = setInterval(() => { ctx.fillStyle = Math.random() > 0.5 ? '#000' : '#010101'; ctx.fillRect(0, 0, 16, 16) }, 1000)
        const v = document.createElement('video')
        v.muted = true; v.loop = true; v.playsInline = true
        v.setAttribute('playsinline', ''); v.style.cssText = 'position:fixed;width:1px;height:1px;opacity:0.01;pointer-events:none'
        v.srcObject = canvas.captureStream(1)
        document.body.appendChild(v)
        await v.play()
        video.current = v
        if (!cancelled) setMethod('video')
        v.addEventListener('emptied', () => clearInterval(tick))
      } catch { /* leave it to the tablet's own setting */ }
    }
    acquire()
    // A tab that was hidden loses its lock; take it again on return
    const onVisible = () => { if (document.visibilityState === 'visible') acquire() }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      cancelled = true
      document.removeEventListener('visibilitychange', onVisible)
      lock?.release().catch(() => {})
      video.current?.remove()
    }
  }, [])
  return method
}

/** Full-screen family display for a tablet on the kitchen counter. */
export default function Display() {
  return (
    <EmeraldChatProvider>
      <DisplayScreen />
      <EmeraldPanel />
    </EmeraldChatProvider>
  )
}

function DisplayScreen() {
  const { openPanel } = useEmeraldChat()
  const awake = useAwake()
  const [now, setNow] = useState(() => new Date())
  const [chores, setChores] = useState<Chore[]>([])
  const [meals, setMeals] = useState<Meal[]>([])
  const [events, setEvents] = useState<CalendarEvent[]>([])
  const [family, setFamily] = useState<FamilyMember[]>([])
  const [shopping, setShopping] = useState(0)
  const [dinnerRecipe, setDinnerRecipe] = useState<Recipe | null>(null)
  const [wakeUntil, setWakeUntil] = useState(0)

  const load = useCallback(() => {
    const day = new Date()
    const start = new Date(day); start.setHours(0, 0, 0, 0)
    const end = new Date(start); end.setDate(end.getDate() + 1)
    Promise.all([
      getChores().catch(() => null), getMeals(ymd(day), ymd(day)).catch(() => null),
      getEvents(start.toISOString(), end.toISOString()).catch(() => null), getFamily().catch(() => null),
      getShopping().catch(() => null),
    ]).then(([c, m, e, f, s]) => {
      if (c) setChores(c)
      if (m) {
        setMeals(m)
        const dinner = m.find(x => x.meal_type === 'dinner' && x.recipe_id)
        if (dinner?.recipe_id) getRecipe(dinner.recipe_id).then(setDinnerRecipe).catch(() => {})
        else setDinnerRecipe(null)
      }
      if (e) setEvents(e)
      if (f) setFamily(f)
      if (s) setShopping(s.filter(l => !l.checked).length)
    })
  }, [])

  useEffect(() => {
    load()
    const refresh = setInterval(load, 60000)
    const clock = setInterval(() => setNow(new Date()), 15000)
    return () => { clearInterval(refresh); clearInterval(clock) }
  }, [load])

  const hour = now.getHours()
  const night = (hour >= NIGHT_FROM || hour < NIGHT_TO) && now.getTime() > wakeUntil

  const todays = useMemo(() => {
    const weekday = (now.getDay() + 6) % 7
    return chores.filter(c =>
      c.frequency === 'daily' ||
      (c.frequency === 'weekly' && (c.day_of_week == null || c.day_of_week === weekday)) ||
      (c.frequency === 'monthly' && now.getDate() === 1) ||
      (c.frequency === 'once' && !c.done_this_period))
  }, [chores, now])
  const person = (name?: string) => family.find(f => f.name === name)
  const dinner = meals.find(m => m.meal_type === 'dinner')
  const agenda = [...events].sort((a, b) => (a.all_day === b.all_day ? a.start.localeCompare(b.start) : a.all_day ? -1 : 1))
  const photo = mediaUrl(dinnerRecipe?.image_url)

  async function tick(c: Chore) {
    setChores(cur => cur.map(x => (x.id === c.id ? { ...x, done_this_period: !c.done_this_period } : x)))
    try {
      const updated = c.done_this_period ? await uncompleteChore(c.id) : await completeChore(c.id, c.assigned_to || undefined)
      setChores(cur => cur.map(x => (x.id === c.id ? updated : x)))
    } catch (e) { toast.error(errorText(e)); load() }
  }

  const time = now.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit', hour12: !getUse24() })

  return (
    <div
      className={cn('h-app overflow-y-auto bg-canvas text-ink transition-[filter] duration-700 lg:overflow-hidden', night && 'brightness-[0.4]')}
      onPointerDown={() => night && setWakeUntil(Date.now() + 2 * 60 * 1000)}
    >
      <div className="flex min-h-full flex-col gap-5 p-5 pt-[max(1.25rem,env(safe-area-inset-top))] lg:h-full lg:p-8">
        <header className="flex items-start justify-between gap-4">
          <div>
            <p className="text-6xl font-semibold leading-none tnum sm:text-7xl lg:text-8xl">{time}</p>
            <p className="mt-2 text-xl font-medium text-honey sm:text-2xl">
              {now.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => openPanel()}
              className="flex h-14 items-center gap-2.5 rounded-full bg-emerald px-6 text-lg font-medium text-emerald-on active:scale-95"
            >
              <EmeraldMark size={24} /> Ask Emerald
            </button>
            <Link to="/" aria-label="Leave the kitchen display" className="flex h-14 w-14 items-center justify-center rounded-full border border-line bg-surface text-muted">
              <X size={24} aria-hidden />
            </Link>
          </div>
        </header>

        <div className="grid min-h-0 flex-1 gap-5 lg:grid-cols-12">
          <section aria-labelledby="d-events" className="flex min-h-0 flex-col rounded-panel border border-line bg-surface p-5 lg:col-span-4">
            <h2 id="d-events" className="mb-3 text-lg font-semibold text-muted">On today</h2>
            {agenda.length === 0 ? (
              <p className="my-auto text-center text-2xl text-muted">A free day</p>
            ) : (
              <ul className="min-h-0 flex-1 space-y-3 overflow-y-auto">
                {agenda.map(e => (
                  <li key={e.id} className="flex items-center gap-3">
                    <span className="h-12 w-1.5 shrink-0 rounded-full" style={{ background: e.color || 'rgb(var(--action))' }} aria-hidden />
                    <div className="min-w-0">
                      <p className="truncate text-2xl font-medium">{e.title}</p>
                      <p className="text-lg text-muted tnum">{e.all_day ? 'All day' : formatTime(e.start.slice(11, 16), getUse24())}</p>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section aria-labelledby="d-chores" className="flex min-h-0 flex-col rounded-panel border border-line bg-surface p-5 lg:col-span-4">
            <h2 id="d-chores" className="mb-3 text-lg font-semibold text-muted">
              Chores · {todays.filter(c => c.done_this_period).length} of {todays.length}
            </h2>
            {todays.length === 0 ? (
              <p className="my-auto text-center text-2xl text-muted">Nothing to do today</p>
            ) : (
              <ul className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)] content-start gap-3 overflow-y-auto">
                {todays.map(c => {
                  const p = person(c.assigned_to)
                  return (
                    <li key={c.id}>
                      <button
                        type="button"
                        role="checkbox"
                        aria-checked={c.done_this_period}
                        onClick={() => tick(c)}
                        className={cn(
                          'flex min-h-[72px] w-full items-center gap-4 rounded-panel border px-4 text-left transition-colors',
                          c.done_this_period ? 'border-action/40 bg-action/10' : 'border-line bg-canvas active:bg-ink/[0.06]',
                        )}
                      >
                        {c.assigned_to
                          ? <PersonAvatar name={c.assigned_to} icon={p?.icon} photo={p?.photo_url} size={44} />
                          : <span className="flex h-11 w-11 items-center justify-center rounded-full bg-ink/[0.07] text-xl" aria-hidden>{c.icon || '🧹'}</span>}
                        <span className="min-w-0 flex-1">
                          <span className={cn("block line-clamp-2 text-2xl font-medium leading-tight", c.done_this_period && "text-muted line-through")}>{c.title}</span>
                          <span className="block text-base text-muted">{c.assigned_to || 'Anyone'}</span>
                        </span>
                        <span className={cn(
                          'flex h-10 w-10 shrink-0 items-center justify-center rounded-full border-2',
                          c.done_this_period ? 'border-action bg-action text-action-on' : 'border-muted/60',
                        )}>
                          {c.done_this_period && <Check size={22} strokeWidth={3} aria-hidden />}
                        </span>
                      </button>
                    </li>
                  )
                })}
              </ul>
            )}
          </section>

          <div className="flex min-h-0 flex-col gap-5 lg:col-span-4">
            <Link
              to={dinner?.recipe_id ? `/recipes/${dinner.recipe_id}` : '/meals'}
              className="relative flex min-h-[260px] flex-1 overflow-hidden rounded-panel border border-line bg-surface"
            >
              {photo && <img src={photo} alt="" className="absolute inset-0 h-full w-full object-cover" />}
              <div className={cn('relative mt-auto w-full p-5', photo ? 'bg-gradient-to-t from-black/75 to-transparent pt-16 text-white' : 'my-auto text-center')}>
                {!photo && <UtensilsCrossed size={40} aria-hidden className="mx-auto mb-3 text-honey" />}
                <p className="text-base font-medium uppercase tracking-wide opacity-80">Dinner tonight</p>
                <p className="text-3xl font-semibold leading-tight">{dinner ? dinner.title : 'Not planned yet'}</p>
              </div>
            </Link>
            <Link to="/shopping" className="flex h-20 shrink-0 items-center gap-4 rounded-panel border border-line bg-surface px-5">
              <ShoppingCart size={30} aria-hidden className="text-action" />
              <span className="flex-1 text-2xl font-medium">Shopping list</span>
              <span className="text-3xl font-semibold tnum">{shopping}</span>
            </Link>
          </div>
        </div>

        {awake === 'none' && (
          <p className="text-center text-sm text-muted">
            To keep this screen on, set the tablet to stay awake while charging (or Auto-Lock to Never).
          </p>
        )}
      </div>
    </div>
  )
}
