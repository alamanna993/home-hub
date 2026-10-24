import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { BookOpen, ChevronLeft, ChevronRight, Plus, X } from 'lucide-react'
import toast from 'react-hot-toast'
import { getMeals, createMeal, deleteMeal, getRecipes, errorText, Meal, MealType, Recipe } from '../lib/api'
import { Button, Dialog, Field, IconButton, Input, Page, PageHeader, Select } from '../components/ui'
import { EmeraldMark } from '../components/EmeraldMark'
import { useEmeraldChat } from '../hooks/useEmeraldChat'
import { cn } from '../lib/utils'

const MEAL_TYPES: { type: MealType; label: string }[] = [
  { type: 'breakfast', label: 'Breakfast' },
  { type: 'lunch', label: 'Lunch' },
  { type: 'dinner', label: 'Dinner' },
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
  const { openPanel } = useEmeraldChat()
  const [weekStart, setWeekStart] = useState(() => mondayOf(new Date()))
  // Phone day view starts on today (index within the Monday-based week)
  const [dayIdx, setDayIdx] = useState(() => (new Date().getDay() + 6) % 7)
  const [meals, setMeals] = useState<Meal[]>([])
  const [recipes, setRecipes] = useState<Recipe[]>([])
  const [editing, setEditing] = useState<{ date: string; type: MealType } | null>(null)
  const [title, setTitle] = useState('')
  const [notes, setNotes] = useState('')
  const [recipeId, setRecipeId] = useState('')
  const [saving, setSaving] = useState(false)

  const days = useMemo(() =>
    Array.from({ length: 7 }, (_, i) => { const d = new Date(weekStart); d.setDate(d.getDate() + i); return d }),
  [weekStart])

  const load = () => getMeals(ymd(days[0]), ymd(days[6])).then(setMeals).catch(() => {})
  useEffect(() => { load() }, [weekStart])
  useEffect(() => { getRecipes({ sort: 'title' }).then(setRecipes).catch(() => {}) }, [])

  const mealFor = (date: string, type: MealType) => meals.filter(m => m.date === date && m.meal_type === type)

  function openAdd(date: string, type: MealType) {
    setTitle(''); setNotes(''); setRecipeId(''); setEditing({ date, type })
  }

  async function add() {
    if (!editing || !title.trim()) return
    setSaving(true)
    try {
      await createMeal({ date: editing.date, meal_type: editing.type, title: title.trim(), notes: notes.trim() || undefined,
        recipe_id: recipeId ? Number(recipeId) : null })
      toast.success('Meal planned')
      setEditing(null); load()
    } catch (e) { toast.error(errorText(e, "Couldn't plan that meal")) } finally { setSaving(false) }
  }

  async function remove(m: Meal) {
    try {
      await deleteMeal(m.id)
      toast.success(`Removed ${m.title}`)
      load()
    } catch (e) { toast.error(errorText(e)) }
  }

  function shiftWeek(delta: number) {
    const d = new Date(weekStart); d.setDate(d.getDate() + delta * 7); setWeekStart(d)
  }

  const todayKey = ymd(new Date())
  const weekLabel = `${days[0].toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} to ${days[6].toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`
  const isThisWeek = ymd(weekStart) === ymd(mondayOf(new Date()))

  const MealChip = ({ m, compact }: { m: Meal; compact?: boolean }) => (
    <div className="group relative flex items-start gap-1.5 rounded-control border border-line bg-canvas px-2 py-1.5">
      {m.recipe_id && <BookOpen size={12} className="mt-0.5 shrink-0 text-action" aria-label="Saved recipe" />}
      <div className="min-w-0 flex-1">
        {m.recipe_id
          ? <Link to={`/recipes/${m.recipe_id}`} className={cn('block font-medium leading-tight text-ink hover:underline', compact ? 'text-ui' : 'text-sm')}>{m.title}</Link>
          : <p className={cn('font-medium leading-tight text-ink', compact ? 'text-ui' : 'text-sm')}>{m.title}</p>}
        {m.notes && <p className="truncate text-xs text-muted">{m.notes}</p>}
      </div>
      <IconButton icon={X} label={`Remove ${m.title}`} size="sm"
        className={cn('h-6 w-6 shrink-0 opacity-100 lg:opacity-0 lg:group-hover:opacity-100 lg:focus:opacity-100',
          compact ? 'absolute right-0.5 top-0.5 bg-canvas' : '-my-1 -mr-1')}
        onClick={() => remove(m)} />
    </div>
  )

  return (
    <Page className="max-w-[1440px]">
      <PageHeader title="Meals" description={`Week of ${weekLabel}`}
        actions={<>
          <Button onClick={() => openPanel('What can I make for dinner tonight?')}>
            <EmeraldMark size={16} className="text-emerald" />What can I make tonight?
          </Button>
          <div className="flex items-center gap-1">
            <IconButton icon={ChevronLeft} label="Previous week" variant="secondary" onClick={() => shiftWeek(-1)} />
            <Button onClick={() => { setWeekStart(mondayOf(new Date())); setDayIdx((new Date().getDay() + 6) % 7) }} disabled={isThisWeek}>This week</Button>
            <IconButton icon={ChevronRight} label="Next week" variant="secondary" onClick={() => shiftWeek(1)} />
          </div>
        </>} />

      {/* Phone: one day at a time */}
      <div className="space-y-3 lg:hidden">
        <div className="grid grid-cols-7 gap-1" role="tablist" aria-label="Day">
          {days.map((d, i) => {
            const key = ymd(d)
            return (
              <button key={key} role="tab" aria-selected={i === dayIdx} onClick={() => setDayIdx(i)}
                className={cn('rounded-control py-2 text-center transition-colors',
                  i === dayIdx ? 'bg-action text-action-on' : 'text-muted hover:text-ink',
                  key === todayKey && i !== dayIdx && 'ring-1 ring-action/50')}>
                <div className="text-xs">{d.toLocaleDateString(undefined, { weekday: 'short' })}</div>
                <div className="text-sm font-medium tnum">{d.getDate()}</div>
              </button>
            )
          })}
        </div>
        {(() => {
          const key = ymd(days[dayIdx])
          return MEAL_TYPES.map(({ type, label }) => (
            <section key={type} className="space-y-2 rounded-panel border border-line bg-surface p-3">
              <h2 className="text-ui font-semibold text-ink">{label}</h2>
              {mealFor(key, type).map(m => <MealChip key={m.id} m={m} />)}
              <Button size="sm" variant="ghost" icon={Plus} onClick={() => openAdd(key, type)} className="w-full">Add {label.toLowerCase()}</Button>
            </section>
          ))
        })()}
      </div>

      {/* Desktop: the week as a grid */}
      <div className="hidden overflow-hidden rounded-panel border border-line bg-surface lg:block">
        <div className="grid grid-cols-[96px_repeat(7,minmax(0,1fr))]">
          <div className="border-b border-line" />
          {days.map(d => {
            const key = ymd(d)
            const today = key === todayKey
            return (
              <div key={key} className={cn('border-b border-l border-line px-2 py-2 text-center', today && 'bg-action/[0.06]')}>
                <div className={cn('text-ui', today ? 'font-semibold text-action' : 'text-muted')}>{d.toLocaleDateString(undefined, { weekday: 'short' })}</div>
                <div className={cn('text-sm tnum', today ? 'font-semibold text-action' : 'text-ink')}>{d.getDate()}</div>
              </div>
            )
          })}
          {MEAL_TYPES.map(({ type, label }, row) => (
            <div key={type} className="contents">
              <div className={cn('px-3 py-2 text-ui font-medium text-muted', row < MEAL_TYPES.length - 1 && 'border-b border-line')}>{label}</div>
              {days.map(d => {
                const key = ymd(d)
                return (
                  <div key={`${key}-${type}`}
                    className={cn('group/cell flex min-h-24 flex-col gap-1 border-l border-line p-1.5',
                      row < MEAL_TYPES.length - 1 && 'border-b', key === todayKey && 'bg-action/[0.03]')}>
                    {mealFor(key, type).map(m => <MealChip key={m.id} m={m} compact />)}
                    <button type="button" onClick={() => openAdd(key, type)}
                      aria-label={`Add ${label.toLowerCase()} on ${d.toLocaleDateString(undefined, { weekday: 'long' })}`}
                      className="mt-auto flex items-center justify-center gap-1 rounded-control py-1 text-xs text-muted opacity-0 transition-opacity hover:bg-ink/[0.04] hover:text-ink focus:opacity-100 group-hover/cell:opacity-100">
                      <Plus size={12} aria-hidden /> Add
                    </button>
                  </div>
                )
              })}
            </div>
          ))}
        </div>
      </div>

      <Dialog open={!!editing} onClose={() => setEditing(null)} size="sm"
        title={editing ? `Plan ${editing.type}` : ''}
        description={editing ? new Date(`${editing.date}T00:00:00`).toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' }) : undefined}
        footer={<>
          <Button variant="ghost" onClick={() => setEditing(null)}>Cancel</Button>
          <Button variant="primary" loading={saving} disabled={!title.trim()} onClick={add}>Plan meal</Button>
        </>}>
        <form className="space-y-4" onSubmit={e => { e.preventDefault(); add() }}>
          {recipes.length > 0 && (
            <Field label="From your recipes" hint="Or type any meal below">
              <Select value={recipeId} onChange={e => {
                setRecipeId(e.target.value)
                const r = recipes.find(x => String(x.id) === e.target.value)
                if (r) setTitle(r.title)
              }}>
                <option value="">Not a saved recipe</option>
                {recipes.map(r => <option key={r.id} value={r.id}>{r.title}</option>)}
              </Select>
            </Field>
          )}
          <Field label="Meal" required>
            <Input autoFocus value={title} onChange={e => { setTitle(e.target.value); if (recipeId) setRecipeId('') }}
              placeholder="Spaghetti bolognese" />
          </Field>
          <Field label="Notes"><Input value={notes} onChange={e => setNotes(e.target.value)} placeholder="Optional" /></Field>
          <button type="submit" hidden />
        </form>
      </Dialog>
    </Page>
  )
}
