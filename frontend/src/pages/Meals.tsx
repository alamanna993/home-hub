import { useEffect, useMemo, useState } from 'react'
import { ChevronLeft, ChevronRight, Plus, Sparkles, Trash2, X } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import toast from 'react-hot-toast'
import { getMeals, createMeal, deleteMeal, Meal, MealType } from '../lib/api'
import { cn } from '../lib/utils'

const MEAL_TYPES: { type: MealType; label: string; icon: string }[] = [
  { type: 'breakfast', label: 'Breakfast', icon: '🍳' },
  { type: 'lunch', label: 'Lunch', icon: '🥪' },
  { type: 'dinner', label: 'Dinner', icon: '🍽️' },
]

function ymd(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function mondayOf(d: Date) {
  const m = new Date(d)
  m.setDate(m.getDate() - ((m.getDay() + 6) % 7))
  m.setHours(0, 0, 0, 0)
  return m
}

export default function Meals() {
  const [weekStart, setWeekStart] = useState(() => mondayOf(new Date()))
  // Phone day view starts on today (index within the Monday-based week)
  const [dayIdx, setDayIdx] = useState(() => (new Date().getDay() + 6) % 7)
  const [meals, setMeals] = useState<Meal[]>([])
  const [editing, setEditing] = useState<{ date: string; type: MealType } | null>(null)
  const [title, setTitle] = useState('')
  const [notes, setNotes] = useState('')
  const navigate = useNavigate()

  const days = useMemo(() =>
    Array.from({ length: 7 }, (_, i) => { const d = new Date(weekStart); d.setDate(d.getDate() + i); return d }),
  [weekStart])

  const load = () => getMeals(ymd(days[0]), ymd(days[6])).then(setMeals)
  useEffect(() => { load() }, [weekStart])

  const mealFor = (date: string, type: MealType) =>
    meals.filter(m => m.date === date && m.meal_type === type)

  async function add() {
    if (!editing || !title.trim()) return
    await createMeal({ date: editing.date, meal_type: editing.type, title: title.trim(), notes: notes.trim() || undefined })
    toast.success('Meal planned')
    setTitle(''); setNotes(''); setEditing(null)
    load()
  }

  async function remove(id: number) {
    await deleteMeal(id)
    toast.success('Meal removed')
    load()
  }

  function shiftWeek(delta: number) {
    const d = new Date(weekStart); d.setDate(d.getDate() + delta * 7); setWeekStart(d)
  }

  const todayKey = ymd(new Date())
  const weekLabel = `${days[0].toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} – ${days[6].toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`

  return (
    <div className="p-4 sm:p-6 space-y-5">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-white text-2xl font-bold">Meal Planner</h2>
          <p className="text-surface-muted text-sm mt-1">Plan the week's meals</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => navigate('/chat?prompt=What can I make for dinner tonight?')}
            className="flex items-center gap-2 bg-accent/15 hover:bg-accent/25 text-accent text-sm font-medium px-3 py-2 rounded-lg transition-all">
            <Sparkles size={15} /> What can I make tonight?
          </button>
          <button onClick={() => shiftWeek(-1)}
            className="p-2 rounded-lg bg-surface-card border border-surface-border text-surface-muted hover:text-white transition-all">
            <ChevronLeft size={16} />
          </button>
          <span className="text-white font-medium min-w-36 text-center text-sm">{weekLabel}</span>
          <button onClick={() => shiftWeek(1)}
            className="p-2 rounded-lg bg-surface-card border border-surface-border text-surface-muted hover:text-white transition-all">
            <ChevronRight size={16} />
          </button>
        </div>
      </div>

      {/* Phone: one day at a time */}
      <div className="lg:hidden space-y-3">
        <div className="grid grid-cols-7 gap-1">
          {days.map((d, i) => {
            const key = ymd(d)
            return (
              <button key={key} onClick={() => setDayIdx(i)}
                className={cn(
                  'py-2 rounded-lg text-center transition-all',
                  i === dayIdx ? 'bg-accent/15 text-accent font-semibold' : 'text-surface-muted hover:text-white',
                  key === todayKey && i !== dayIdx && 'ring-1 ring-accent/40'
                )}>
                <div className="text-xs">{d.toLocaleDateString(undefined, { weekday: 'short' })}</div>
                <div className="text-sm">{d.getDate()}</div>
              </button>
            )
          })}
        </div>
        {(() => {
          const key = ymd(days[dayIdx])
          return MEAL_TYPES.map(({ type, label, icon }) => (
            <div key={type} className="bg-surface-card border border-surface-border rounded-xl p-3 space-y-2">
              <div className="flex items-center gap-2 text-surface-muted text-sm font-medium">
                <span>{icon}</span> {label}
              </div>
              {mealFor(key, type).map(m => (
                <div key={m.id} className="bg-accent/10 border border-accent/20 rounded-lg px-3 py-2 flex items-start gap-2">
                  <div className="flex-1 min-w-0">
                    <p className="text-white text-sm font-medium leading-snug">{m.title}</p>
                    {m.notes && <p className="text-surface-muted text-xs mt-0.5">{m.notes}</p>}
                  </div>
                  <button onClick={() => remove(m.id)}
                    className="p-2 -m-1 text-surface-muted hover:text-red-400 flex-shrink-0">
                    <Trash2 size={14} />
                  </button>
                </div>
              ))}
              <button onClick={() => setEditing({ date: key, type })}
                className="w-full py-2.5 rounded-lg border border-dashed border-surface-border text-surface-muted active:border-accent active:text-accent flex items-center justify-center gap-1.5 text-sm transition-all">
                <Plus size={14} /> Add {label.toLowerCase()}
              </button>
            </div>
          ))
        })()}
      </div>

      {/* Desktop: full week grid */}
      <div className="hidden lg:block overflow-x-auto">
        <div className="min-w-[760px] grid grid-cols-[90px_repeat(7,1fr)] gap-2">
          <div />
          {days.map(d => {
            const key = ymd(d)
            return (
              <div key={key} className={cn('text-center py-2 rounded-lg text-sm', key === todayKey ? 'bg-accent/15 text-accent font-semibold' : 'text-surface-muted')}>
                <div>{d.toLocaleDateString(undefined, { weekday: 'short' })}</div>
                <div className="text-xs opacity-75">{d.getDate()}</div>
              </div>
            )
          })}

          {MEAL_TYPES.map(({ type, label, icon }) => (
            <div key={type} className="contents">
              <div className="flex items-center gap-1.5 text-surface-muted text-xs font-medium">
                <span>{icon}</span> {label}
              </div>
              {days.map(d => {
                const key = ymd(d)
                const cellMeals = mealFor(key, type)
                return (
                  <div key={`${key}-${type}`}
                    className="bg-surface-card border border-surface-border rounded-xl p-2 min-h-20 flex flex-col gap-1 group/cell">
                    {cellMeals.map(m => (
                      <div key={m.id} className="bg-accent/10 border border-accent/20 rounded-lg px-2 py-1 group flex items-start gap-1">
                        <div className="flex-1 min-w-0">
                          <p className="text-white text-xs font-medium leading-tight">{m.title}</p>
                          {m.notes && <p className="text-surface-muted text-[10px] truncate">{m.notes}</p>}
                        </div>
                        <button onClick={() => remove(m.id)}
                          className="opacity-100 lg:opacity-0 lg:group-hover:opacity-100 p-1.5 -m-1 text-surface-muted hover:text-red-400 flex-shrink-0 transition-opacity">
                          <Trash2 size={12} />
                        </button>
                      </div>
                    ))}
                    <button onClick={() => setEditing({ date: key, type })}
                      className="opacity-100 lg:opacity-0 lg:group-hover/cell:opacity-100 flex items-center justify-center gap-1 text-surface-muted hover:text-accent text-[11px] py-1.5 transition-all">
                      <Plus size={12} /> add
                    </button>
                  </div>
                )
              })}
            </div>
          ))}
        </div>
      </div>

      {editing && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4" onClick={() => setEditing(null)}>
          <div className="bg-surface-card border border-surface-border rounded-2xl p-5 w-full max-w-md space-y-4 max-h-modal overflow-y-auto"
            onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <h3 className="text-white font-semibold capitalize">
                {editing.type} — {new Date(`${editing.date}T00:00:00`).toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' })}
              </h3>
              <button onClick={() => setEditing(null)} className="text-surface-muted hover:text-white"><X size={18} /></button>
            </div>
            <input autoFocus className="w-full bg-surface border border-surface-border rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-accent"
              placeholder="Meal (e.g. Spaghetti Bolognese)" value={title} onChange={e => setTitle(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && add()} />
            <input className="w-full bg-surface border border-surface-border rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-accent"
              placeholder="Notes (optional)" value={notes} onChange={e => setNotes(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && add()} />
            <button onClick={add} disabled={!title.trim()}
              className="w-full flex items-center justify-center gap-2 bg-accent hover:bg-accent-hover text-white text-sm font-medium px-4 py-2 rounded-lg transition-all disabled:opacity-50">
              <Plus size={15} /> Plan Meal
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
