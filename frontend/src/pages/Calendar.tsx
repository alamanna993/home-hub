import { useEffect, useMemo, useState } from 'react'
import { Check, ChevronLeft, ChevronRight, Plus, RefreshCw, Trash2 } from 'lucide-react'
import toast from 'react-hot-toast'
import api, { getEvents, createEvent, deleteEvent, getChores, errorText, CalendarEvent, Chore } from '../lib/api'
import { Badge, Button, Dialog, EmptyState, Field, IconButton, Input, Page, PageHeader } from '../components/ui'
import { cn } from '../lib/utils'
import { getUse24, setUse24, formatTime } from '../lib/time'
import TimeSelect from '../components/TimeSelect'

// Event colors are the family's choice per event; ledger blue first
const COLORS = ['#2B4C7E', '#2B6CB0', '#B7791F', '#B83280', '#0987A0', '#C53030']
const DEFAULT_COLOR = COLORS[0]

function ymd(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export default function Calendar() {
  const [cursor, setCursor] = useState(() => { const d = new Date(); d.setDate(1); return d })
  const [events, setEvents] = useState<CalendarEvent[]>([])
  const [chores, setChores] = useState<Chore[]>([])
  const [selectedDay, setSelectedDay] = useState<string | null>(null)
  const [title, setTitle] = useState('')
  const [time, setTime] = useState('')
  const [endTime, setEndTime] = useState('')
  const [color, setColor] = useState(DEFAULT_COLOR)
  const [saving, setSaving] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const [use24, setUse24State] = useState(getUse24())

  function toggle24() {
    setUse24(!use24)
    setUse24State(!use24)
  }

  async function resync() {
    setSyncing(true)
    try {
      await api.post('/calendar/resync')
      load()
      toast.success('Synced calendars refreshed. Google and Outlook publish changes on their own schedule, which can lag 30 to 60 minutes.')
    } catch {
      toast.error("Couldn't refresh the synced calendars")
    } finally { setSyncing(false) }
  }

  const monthStart = useMemo(() => new Date(cursor.getFullYear(), cursor.getMonth(), 1), [cursor])
  const gridStart = useMemo(() => {
    const d = new Date(monthStart)
    d.setDate(d.getDate() - ((d.getDay() + 6) % 7)) // back to Monday
    return d
  }, [monthStart])

  const days = useMemo(() => Array.from({ length: 42 }, (_, i) => {
    const d = new Date(gridStart); d.setDate(d.getDate() + i); return d
  }), [gridStart])

  const load = () => {
    const end = new Date(gridStart); end.setDate(end.getDate() + 42)
    getEvents(gridStart.toISOString(), end.toISOString()).then(setEvents).catch(() => {})
    getChores().then(setChores).catch(() => {})
  }
  useEffect(() => { load() }, [gridStart])

  // Which chores land on a given day, and whether their check-off applies to it
  function choresFor(d: Date): { chore: Chore; done: boolean }[] {
    const now = new Date(); now.setHours(0, 0, 0, 0)
    const day = new Date(d); day.setHours(0, 0, 0, 0)
    const weekday = (day.getDay() + 6) % 7 // 0=Monday
    const sameWeek = (() => {
      const monday = new Date(now); monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7))
      const diff = (day.getTime() - monday.getTime()) / 86400000
      return diff >= 0 && diff < 7
    })()
    const result: { chore: Chore; done: boolean }[] = []
    for (const c of chores) {
      if (c.frequency === 'daily') {
        result.push({ chore: c, done: c.done_this_period && day.getTime() === now.getTime() })
      } else if (c.frequency === 'weekly' && c.day_of_week != null && c.day_of_week === weekday) {
        result.push({ chore: c, done: c.done_this_period && sameWeek })
      } else if (c.frequency === 'monthly' && day.getDate() === 1) {
        result.push({ chore: c, done: c.done_this_period && day.getMonth() === now.getMonth() && day.getFullYear() === now.getFullYear() })
      }
    }
    return result
  }

  const byDay = useMemo(() => {
    const map: Record<string, CalendarEvent[]> = {}
    for (const e of events) (map[e.start.slice(0, 10)] ||= []).push(e)
    return map
  }, [events])

  function openDay(key: string) {
    setTitle(''); setTime(''); setEndTime(''); setColor(DEFAULT_COLOR); setSelectedDay(key)
  }

  async function addEvent() {
    if (!selectedDay || !title.trim()) return
    if (time && endTime && endTime <= time) { toast.error('The end time has to be after the start time'); return }
    const start = time ? `${selectedDay}T${time}:00` : `${selectedDay}T00:00:00`
    const end = time && endTime ? `${selectedDay}T${endTime}:00` : undefined
    setSaving(true)
    try {
      await createEvent({ title: title.trim(), start, end, all_day: !time, color })
      toast.success('Event added')
      setSelectedDay(null); load()
    } catch (e) { toast.error(errorText(e, "Couldn't add the event")) } finally { setSaving(false) }
  }

  async function remove(e: CalendarEvent) {
    try { await deleteEvent(e.id); toast.success(`Removed ${e.title}`); load() } catch (err) { toast.error(errorText(err)) }
  }

  const todayKey = ymd(new Date())
  const monthLabel = cursor.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })
  const isThisMonth = cursor.getMonth() === new Date().getMonth() && cursor.getFullYear() === new Date().getFullYear()
  const timeRange = (e: CalendarEvent) => e.all_day ? 'All day'
    : formatTime(e.start.slice(11, 16), use24) + (e.end ? ` to ${formatTime(e.end.slice(11, 16), use24)}` : '')

  const EventRow = ({ e }: { e: CalendarEvent }) => (
    <li className="flex items-center gap-2.5 py-2">
      <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: e.color || DEFAULT_COLOR }} aria-hidden />
      <span className="min-w-0 flex-1 truncate text-sm text-ink">{e.title}</span>
      {e.read_only && <Badge>Synced</Badge>}
      <span className="text-ui text-muted tnum">{timeRange(e)}</span>
      {!e.read_only && <IconButton icon={Trash2} label={`Delete ${e.title}`} size="sm" onClick={() => remove(e)} />}
    </li>
  )
  const ChoreRow = ({ chore, done }: { chore: Chore; done: boolean }) => (
    <li className="flex items-center gap-2.5 py-2">
      <span className="w-5 text-center leading-none" aria-hidden>{chore.icon || '🧹'}</span>
      <span className={cn('min-w-0 flex-1 truncate text-sm', done ? 'text-muted line-through' : 'text-ink')}>{chore.title}</span>
      {done && <Check size={14} className="text-action" aria-label="Done" />}
      <span className="text-ui text-muted">{chore.assigned_to || 'Anyone'}</span>
    </li>
  )

  return (
    <Page className="max-w-[1440px]">
      <PageHeader title="Calendar" description={monthLabel}
        actions={<>
          <Button size="md" onClick={toggle24} title="Switch between 12-hour and 24-hour times">{use24 ? '24-hour' : '12-hour'}</Button>
          <IconButton icon={RefreshCw} label="Refresh synced calendars" variant="secondary" onClick={resync}
            className={syncing ? '[&_svg]:animate-spin' : undefined} disabled={syncing} />
          <div className="flex items-center gap-1">
            <IconButton icon={ChevronLeft} label="Previous month" variant="secondary"
              onClick={() => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() - 1, 1))} />
            <Button disabled={isThisMonth} onClick={() => { const d = new Date(); d.setDate(1); setCursor(d) }}>Today</Button>
            <IconButton icon={ChevronRight} label="Next month" variant="secondary"
              onClick={() => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1))} />
          </div>
          <Button variant="primary" icon={Plus} onClick={() => openDay(isThisMonth ? todayKey : ymd(monthStart))}>Add event</Button>
        </>} />

      {/* Phone: agenda */}
      <div className="space-y-2 lg:hidden">
        {(() => {
          const monthDays = days.filter(d => d.getMonth() === cursor.getMonth())
          const cards = monthDays.filter(d => {
            const key = ymd(d)
            return (byDay[key] || []).length > 0 || choresFor(d).length > 0 || key === todayKey
          })
          if (cards.length === 0) {
            return (
              <div className="rounded-panel border border-line bg-surface">
                <EmptyState title="Nothing this month" action={<Button icon={Plus} onClick={() => openDay(ymd(monthDays[0]))}>Add an event</Button>} />
              </div>
            )
          }
          return cards.map(d => {
            const key = ymd(d)
            const isToday = key === todayKey
            const dayEvents = byDay[key] || []
            const dayChores = choresFor(d)
            return (
              <section key={key} className={cn('rounded-panel border bg-surface px-3 pt-2.5', isToday ? 'border-action/50' : 'border-line')}>
                <header className="flex items-center gap-2.5">
                  <span className={cn('flex h-7 w-7 items-center justify-center rounded-full text-ui tnum',
                    isToday ? 'bg-action font-semibold text-action-on' : 'bg-canvas text-muted')}>{d.getDate()}</span>
                  <h2 className="flex-1 text-sm font-medium text-ink">
                    {d.toLocaleDateString(undefined, { weekday: 'long' })}{isToday && <span className="ml-1.5 text-ui text-action">Today</span>}
                  </h2>
                  <IconButton icon={Plus} label={`Add an event on ${d.toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' })}`}
                    size="sm" onClick={() => openDay(key)} />
                </header>
                {dayEvents.length === 0 && dayChores.length === 0
                  ? <p className="pb-3 pl-9 text-ui text-muted">Nothing planned</p>
                  : <ul className="divide-y divide-line pl-9">
                      {dayEvents.map(e => <EventRow key={e.id} e={e} />)}
                      {dayChores.map(c => <ChoreRow key={`c${c.chore.id}`} {...c} />)}
                    </ul>}
              </section>
            )
          })
        })()}
      </div>

      {/* Desktop: month grid */}
      <div className="hidden overflow-hidden rounded-panel border border-line bg-surface lg:block">
        <div className="grid grid-cols-7 border-b border-line">
          {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map(d => (
            <div key={d} className="px-2 py-2 text-ui font-medium text-muted">{d}</div>
          ))}
        </div>
        <div className="grid grid-cols-7">
          {days.map((d, i) => {
            const key = ymd(d)
            const inMonth = d.getMonth() === cursor.getMonth()
            const dayEvents = byDay[key] || []
            const dayChores = choresFor(d)
            const isToday = key === todayKey
            return (
              <button key={i} type="button" onClick={() => openDay(key)}
                aria-label={`${d.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })}: ${dayEvents.length} events`}
                className={cn('flex min-h-28 flex-col gap-0.5 border-line p-1.5 text-left transition-colors hover:bg-ink/[0.03]',
                  i % 7 !== 6 && 'border-r', i < 35 && 'border-b', !inMonth && 'bg-canvas/60', isToday && 'bg-action/[0.04]')}>
                <span className={cn('mb-0.5 inline-flex h-6 w-6 items-center justify-center rounded-full text-ui tnum',
                  isToday ? 'bg-action font-semibold text-action-on' : inMonth ? 'text-ink' : 'text-muted/60')}>{d.getDate()}</span>
                {dayEvents.slice(0, 3).map(e => (
                  <span key={e.id} className={cn('truncate rounded-sm border-l-2 px-1 py-0.5 text-xs text-ink', !inMonth && 'opacity-60')}
                    style={{ borderColor: e.color || DEFAULT_COLOR, background: `${e.color || DEFAULT_COLOR}14` }}>
                    {!e.all_day && <span className="mr-1 text-muted tnum">{formatTime(e.start.slice(11, 16), use24)}</span>}
                    {e.title}
                  </span>
                ))}
                {dayEvents.length > 3 && <span className="px-1 text-xs text-muted">{dayEvents.length - 3} more</span>}
                {dayChores.slice(0, 2).map(({ chore, done }) => (
                  <span key={`c${chore.id}`} className={cn('truncate rounded-sm border border-dashed border-line px-1 py-0.5 text-xs',
                    done ? 'text-muted line-through' : 'text-ink/80')}>
                    {chore.icon || '🧹'} {chore.title}
                  </span>
                ))}
                {dayChores.length > 2 && <span className="px-1 text-xs text-muted">{dayChores.length - 2} more chores</span>}
              </button>
            )
          })}
        </div>
      </div>

      <Dialog open={!!selectedDay} onClose={() => setSelectedDay(null)}
        title={selectedDay ? new Date(`${selectedDay}T00:00:00`).toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' }) : ''}
        footer={<>
          <Button variant="ghost" onClick={() => setSelectedDay(null)}>Close</Button>
          <Button variant="primary" icon={Plus} loading={saving} disabled={!title.trim()} onClick={addEvent}>Add event</Button>
        </>}>
        {selectedDay && (
          <div className="space-y-5">
            {((byDay[selectedDay] || []).length > 0 || choresFor(new Date(`${selectedDay}T00:00:00`)).length > 0) && (
              <ul className="divide-y divide-line rounded-control border border-line px-3">
                {(byDay[selectedDay] || []).map(e => <EventRow key={e.id} e={e} />)}
                {choresFor(new Date(`${selectedDay}T00:00:00`)).map(c => <ChoreRow key={`c${c.chore.id}`} {...c} />)}
              </ul>
            )}
            <form className="space-y-3" onSubmit={e => { e.preventDefault(); addEvent() }}>
              <Field label="New event">
                <Input autoFocus value={title} onChange={e => setTitle(e.target.value)} placeholder="Dentist appointment" />
              </Field>
              <div className="flex flex-wrap gap-x-6 gap-y-3">
                <div className="flex flex-col gap-1.5">
                  <span className="text-ui font-medium text-ink">Starts</span>
                  <TimeSelect value={time} onChange={setTime} use24={use24} emptyLabel="All day" />
                </div>
                <div className="flex flex-col gap-1.5">
                  <span className="text-ui font-medium text-ink">Ends</span>
                  <TimeSelect value={endTime} onChange={setEndTime} use24={use24} emptyLabel="In an hour" disabled={!time} />
                </div>
              </div>
              <fieldset>
                <legend className="mb-1.5 text-ui font-medium text-ink">Color</legend>
                <div className="flex gap-2">
                  {COLORS.map(c => (
                    <button key={c} type="button" onClick={() => setColor(c)} aria-label={`Color ${c}`} aria-pressed={color === c}
                      className={cn('h-7 w-7 rounded-full ring-offset-2 ring-offset-surface', color === c && 'ring-2 ring-ink')}
                      style={{ background: c }} />
                  ))}
                </div>
              </fieldset>
              <button type="submit" hidden />
            </form>
          </div>
        )}
      </Dialog>
    </Page>
  )
}
