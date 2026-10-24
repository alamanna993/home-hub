import { useEffect, useState } from 'react'
import toast from 'react-hot-toast'
import { Link } from 'react-router-dom'
import { CalendarPlus } from 'lucide-react'
import { Button, Dialog, Field, Input, Select } from '../../components/ui'
import { cn } from '../../lib/utils'
import { errorText, planRecipe, type MealType, type PantrySummary } from '../../lib/api'

export function formatMinutes(min?: number | null) {
  if (!min) return null
  const h = Math.floor(min / 60), m = min % 60
  if (!h) return `${m} min`
  return m ? `${h} hr ${m} min` : `${h} hr`
}

/** "4" → "Serves 4"; "Makes 12" / "1 loaf" stay as written */
export function servesLabel(servings?: string | null) {
  if (!servings) return null
  return /^\d/.test(servings) && !/[a-z]{3,}/i.test(servings) ? `Serves ${servings}` : servings
}

export function ymd(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export function hostOf(url?: string | null) {
  if (!url) return null
  try { return new URL(url).hostname.replace(/^www\./, '') } catch { return null }
}

/** "6 of 8 on hand" with a segmented meter — one segment per ingredient */
export function PantryMeter({ pantry, compact }: { pantry?: PantrySummary; compact?: boolean }) {
  if (!pantry || !pantry.total) return null
  const ready = pantry.have === pantry.total
  const segments = Math.min(pantry.total, 12)
  const filled = Math.round((pantry.have / pantry.total) * segments)
  return (
    <div className="flex items-center gap-2" title={pantry.missing.length ? `Need: ${pantry.missing.join(', ')}` : 'Everything is on hand'}>
      <div className={cn('flex gap-0.5', compact ? 'w-16' : 'w-24')} aria-hidden>
        {Array.from({ length: segments }, (_, i) => (
          <span key={i} className={cn('h-1.5 flex-1 rounded-full', i < filled ? 'bg-action' : 'bg-line')} />
        ))}
      </div>
      <span className="text-xs text-muted tnum">
        {ready ? 'Everything on hand' : `${pantry.have} of ${pantry.total} on hand`}
      </span>
    </div>
  )
}

const MEALS: { id: MealType; label: string }[] = [
  { id: 'breakfast', label: 'Breakfast' }, { id: 'lunch', label: 'Lunch' },
  { id: 'dinner', label: 'Dinner' }, { id: 'snack', label: 'Snack' },
]

/** Put a recipe on the meal plan */
export function PlanDialog({ recipe, open, onClose, onPlanned }: {
  recipe: { id: number; title: string }; open: boolean; onClose: () => void; onPlanned?: () => void
}) {
  const [date, setDate] = useState(ymd(new Date()))
  const [mealType, setMealType] = useState<MealType>('dinner')
  const [saving, setSaving] = useState(false)
  useEffect(() => { if (open) { setDate(ymd(new Date())); setMealType('dinner') } }, [open])

  async function save() {
    setSaving(true)
    try {
      await planRecipe(recipe.id, date, mealType)
      const day = new Date(`${date}T12:00:00`).toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' })
      toast.success(t => (
        <span>
          Planned for {mealType} on {day}.{' '}
          <Link to="/meals" onClick={() => toast.dismiss(t.id)} className="font-medium text-action underline">View meals</Link>
        </span>
      ))
      onPlanned?.()
      onClose()
    } catch (e) {
      toast.error(errorText(e, "Couldn't plan that meal"))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onClose={onClose} size="sm" title="Plan as a meal"
      description={recipe.title}
      footer={<>
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button variant="primary" icon={CalendarPlus} loading={saving} onClick={save}>Add to meal plan</Button>
      </>}>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Date"><Input type="date" value={date} onChange={e => setDate(e.target.value)} /></Field>
        <Field label="Meal">
          <Select value={mealType} onChange={e => setMealType(e.target.value as MealType)}>
            {MEALS.map(m => <option key={m.id} value={m.id}>{m.label}</option>)}
          </Select>
        </Field>
      </div>
    </Dialog>
  )
}
