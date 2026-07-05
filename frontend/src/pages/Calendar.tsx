import { useEffect, useMemo, useState } from 'react'
import { ChevronLeft, ChevronRight, Plus, Trash2, X } from 'lucide-react'
import toast from 'react-hot-toast'
import { getEvents, createEvent, deleteEvent, getChores, CalendarEvent, Chore } from '../lib/api'
import { cn } from '../lib/utils'

const COLORS = ['#6366f1', '#22c55e', '#f59e0b', '#ec4899', '#06b6d4', '#ef4444']

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
  const [color, setColor] = useState(COLORS[0])

  const monthStart = useMemo(() => new Date(cursor.getFullYear(), cursor.getMonth(), 1), [cursor])
  const gridStart = useMemo(() => {
    const d = new Date(monthStart)
    d.setDate(d.getDate() - ((d.getDay() + 6) % 7)) // back to Monday
    return d
  }, [monthStart])

  const days = useMemo(() => {
    const list: Date[] = []
    for (let i = 0; i < 42; i++) {
      const d = new Date(gridStart)
      d.setDate(d.getDate() + i)
      list.push(d)
    }
    return list
  }, [gridStart])

  const load = () => {
    const end = new Date(gridStart); end.setDate(end.getDate() + 42)
    getEvents(gridStart.toISOString(), end.toISOString()).then(setEvents)
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
    for (const e of events) {
      const key = e.start.slice(0, 10)
      ;(map[key] ||= []).push(e)
    }
    return map
  }, [events])

  async function addEvent() {
    if (!selectedDay || !title.trim()) return
    const start = time ? `${selectedDay}T${time}:00` : `${selectedDay}T00:00:00`
    await createEvent({ title: title.trim(), start, all_day: !time, color })
    toast.success('Event added')
    setTitle(''); setTime(''); setSelectedDay(null)
    load()
  }

  async function remove(id: number) {
    await deleteEvent(id)
    toast.success('Event removed')
    load()
  }

  const todayKey = ymd(new Date())
  const monthLabel = cursor.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })

  return (
    <div className="p-6 space-y-5">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-white text-2xl font-bold">Calendar</h2>
          <p className="text-surface-muted text-sm mt-1">Family events and appointments</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() - 1, 1))}
            className="p-2 rounded-lg bg-surface-card border border-surface-border text-surface-muted hover:text-white transition-all">
            <ChevronLeft size={16} />
          </button>
          <span className="text-white font-medium min-w-40 text-center">{monthLabel}</span>
          <button onClick={() => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1))}
            className="p-2 rounded-lg bg-surface-card border border-surface-border text-surface-muted hover:text-white transition-all">
            <ChevronRight size={16} />
          </button>
        </div>
      </div>

      <div className="bg-surface-card border border-surface-border rounded-2xl overflow-hidden">
        <div className="grid grid-cols-7 border-b border-surface-border">
          {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map(d => (
            <div key={d} className="px-2 py-2 text-center text-xs font-medium text-surface-muted">{d}</div>
          ))}
        </div>
        <div className="grid grid-cols-7">
          {days.map((d, i) => {
            const key = ymd(d)
            const inMonth = d.getMonth() === cursor.getMonth()
            const dayEvents = byDay[key] || []
            return (
              <button key={i} onClick={() => setSelectedDay(key)}
                className={cn(
                  'min-h-24 p-1.5 border-b border-r border-surface-border text-left align-top transition-all hover:bg-white/5',
                  !inMonth && 'opacity-35',
                )}>
                <span className={cn(
                  'inline-flex w-6 h-6 items-center justify-center rounded-full text-xs',
                  key === todayKey ? 'bg-accent text-white font-bold' : 'text-surface-muted'
                )}>
                  {d.getDate()}
                </span>
                <div className="mt-1 space-y-0.5">
                  {dayEvents.slice(0, 3).map(e => (
                    <div key={e.id} className={cn('text-[11px] text-white truncate rounded px-1 py-0.5', e.read_only && 'opacity-80 italic')}
                      style={{ background: `${e.color || '#6366f1'}33`, borderLeft: `2px solid ${e.color || '#6366f1'}` }}>
                      {!e.all_day && <span className="opacity-70 mr-1">{e.start.slice(11, 16)}</span>}
                      {e.title}
                    </div>
                  ))}
                  {dayEvents.length > 3 && (
                    <div className="text-[10px] text-surface-muted px-1">+{dayEvents.length - 3} more</div>
                  )}
                  {choresFor(d).slice(0, 3).map(({ chore, done }) => (
                    <div key={`c${chore.id}`}
                      className={cn('text-[11px] truncate rounded px-1 py-0.5 border border-dashed',
                        done ? 'text-green-400/70 border-green-500/30 line-through' : 'text-green-300 border-green-500/40 bg-green-500/10')}>
                      {done ? '✅' : (chore.icon || '🧹')} {chore.title}
                    </div>
                  ))}
                </div>
              </button>
            )
          })}
        </div>
      </div>

      {selectedDay && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4" onClick={() => setSelectedDay(null)}>
          <div className="bg-surface-card border border-surface-border rounded-2xl p-5 w-full max-w-md space-y-4"
            onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <h3 className="text-white font-semibold">
                {new Date(`${selectedDay}T00:00:00`).toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })}
              </h3>
              <button onClick={() => setSelectedDay(null)} className="text-surface-muted hover:text-white"><X size={18} /></button>
            </div>

            {((byDay[selectedDay] || []).length > 0 || choresFor(new Date(`${selectedDay}T00:00:00`)).length > 0) && (
              <div className="space-y-1.5">
                {(byDay[selectedDay] || []).map(e => (
                  <div key={e.id} className="flex items-center gap-2 bg-surface rounded-lg px-3 py-2 group">
                    <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: e.color || '#6366f1' }} />
                    <span className={cn('text-white text-sm flex-1 truncate', e.read_only && 'italic')}>{e.title}</span>
                    {e.read_only && <span className="text-surface-muted text-[10px]">synced</span>}
                    {!e.all_day && <span className="text-surface-muted text-xs">{e.start.slice(11, 16)}</span>}
                    {!e.read_only && (
                      <button onClick={() => remove(e.id)} className="text-surface-muted hover:text-red-400"><Trash2 size={14} /></button>
                    )}
                  </div>
                ))}
                {choresFor(new Date(`${selectedDay}T00:00:00`)).map(({ chore, done }) => (
                  <div key={`c${chore.id}`} className="flex items-center gap-2 bg-green-500/5 border border-dashed border-green-500/30 rounded-lg px-3 py-2">
                    <span className="text-base">{done ? '✅' : (chore.icon || '🧹')}</span>
                    <span className={cn('text-sm flex-1 truncate', done ? 'text-green-400/70 line-through' : 'text-green-300')}>
                      {chore.title}{chore.assigned_to ? ` — ${chore.assigned_to}` : ''}
                    </span>
                    <span className="text-surface-muted text-[10px]">chore</span>
                  </div>
                ))}
              </div>
            )}

            <div className="space-y-3">
              <input autoFocus className="w-full bg-surface border border-surface-border rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-accent"
                placeholder="Event title" value={title} onChange={e => setTitle(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && addEvent()} />
              <div className="flex gap-3 items-center">
                <input type="time" className="bg-surface border border-surface-border rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-accent"
                  value={time} onChange={e => setTime(e.target.value)} />
                <div className="flex gap-1.5">
                  {COLORS.map(c => (
                    <button key={c} onClick={() => setColor(c)}
                      className={cn('w-6 h-6 rounded-full transition-all', color === c && 'ring-2 ring-white ring-offset-2 ring-offset-surface-card')}
                      style={{ background: c }} />
                  ))}
                </div>
              </div>
              <button onClick={addEvent} disabled={!title.trim()}
                className="w-full flex items-center justify-center gap-2 bg-accent hover:bg-accent-hover text-white text-sm font-medium px-4 py-2 rounded-lg transition-all disabled:opacity-50">
                <Plus size={15} /> Add Event
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
