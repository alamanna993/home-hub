import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import toast from 'react-hot-toast'
import {
  CalendarPlus, Check, ChefHat, ExternalLink, MoreHorizontal, Pencil, Star, Trash2, X,
} from 'lucide-react'
import { Badge, Button, EmptyState, IconButton, Menu, Page, PageHeader, Panel, Skeleton } from '../../components/ui'
import {
  deleteRecipe, errorText, getRecipe, restoreRecipe, updateRecipe, type PantryLine, type Recipe,
} from '../../lib/api'
import { cn } from '../../lib/utils'
import { formatMinutes, hostOf, PantryMeter, PlanDialog, servesLabel } from './shared'

export default function RecipeDetail() {
  const { id } = useParams()
  const navigate = useNavigate()
  const [recipe, setRecipe] = useState<Recipe | null>(null)
  const [missing, setMissing] = useState(false)
  const [planOpen, setPlanOpen] = useState(false)
  const [cooking, setCooking] = useState(false)
  const [gotIngredients, setGotIngredients] = useState<Set<number>>(new Set())
  const [doneSteps, setDoneSteps] = useState<Set<number>>(new Set())
  const wakeLock = useRef<{ release: () => Promise<void> } | null>(null)

  function load() {
    getRecipe(Number(id)).then(setRecipe).catch(() => setMissing(true))
  }
  useEffect(load, [id])

  // Cook mode keeps the screen awake while hands are busy
  useEffect(() => {
    const nav = navigator as Navigator & { wakeLock?: { request: (t: 'screen') => Promise<{ release: () => Promise<void> }> } }
    if (cooking && nav.wakeLock) {
      nav.wakeLock.request('screen').then(l => { wakeLock.current = l }).catch(() => {})
    }
    return () => { wakeLock.current?.release().catch(() => {}); wakeLock.current = null }
  }, [cooking])

  if (missing) {
    return (
      <Page>
        <PageHeader title="Recipe not found" breadcrumb={[{ label: 'Recipes', to: '/recipes' }]} />
        <Panel padded={false}>
          <EmptyState icon={ChefHat} title="This recipe isn't in the cookbook"
            description="It may have been deleted. Deleted recipes stay in Recently deleted for 30 days."
            action={<>
              <Button onClick={() => navigate('/recipes/trash')}>Open Recently deleted</Button>
              <Button variant="primary" onClick={() => navigate('/recipes')}>Back to recipes</Button>
            </>} />
        </Panel>
      </Page>
    )
  }
  if (!recipe) {
    return (
      <Page>
        <Skeleton className="mb-3 h-4 w-24" />
        <Skeleton className="mb-8 h-9 w-2/3" />
        <div className="grid gap-6 lg:grid-cols-[320px_1fr]">
          <Skeleton className="h-80 rounded-panel" /><Skeleton className="h-96 rounded-panel" />
        </div>
      </Page>
    )
  }

  const r = recipe
  const lines: PantryLine[] = r.pantry_lines || r.ingredients.map(text => ({ text, status: 'missing' as const }))
  let stepNumber = 0

  async function toggleFavorite() {
    const next = !r.favorite
    setRecipe({ ...r, favorite: next })
    try { await updateRecipe(r.id, { favorite: next }) } catch (e) {
      setRecipe({ ...r, favorite: !next }); toast.error(errorText(e))
    }
  }

  async function remove() {
    try {
      await deleteRecipe(r.id)
      navigate('/recipes')
      toast(t => (
        <span className="flex items-center gap-3">
          Moved “{r.title}” to Recently deleted.
          <button type="button" className="font-medium text-action hover:underline"
            onClick={async () => {
              toast.dismiss(t.id)
              await restoreRecipe(r.id)
              toast.success('Recipe restored')
              navigate(`/recipes/${r.id}`)
            }}>
            Undo
          </button>
        </span>
      ), { duration: 8000 })
    } catch (e) {
      toast.error(errorText(e, "Couldn't delete that recipe"))
    }
  }

  const toggle = (set: Set<number>, setter: (s: Set<number>) => void, i: number) => {
    const next = new Set(set)
    if (next.has(i)) next.delete(i)
    else next.add(i)
    setter(next)
  }

  const facts = [
    { label: 'Prep', value: formatMinutes(r.prep_minutes) },
    { label: 'Cook', value: formatMinutes(r.cook_minutes) },
    { label: 'Total', value: formatMinutes(r.total_minutes) },
    { label: 'Yield', value: servesLabel(r.servings) },
  ].filter(f => f.value)

  return (
    <Page className={cn(cooking && 'max-w-[1440px]')}>
      <PageHeader
        breadcrumb={[{ label: 'Recipes', to: '/recipes' }]}
        title={<span className="font-serif text-3xl font-semibold tracking-normal">{r.title}</span>}
        actions={<>
          <Button variant={cooking ? 'primary' : 'secondary'} icon={cooking ? X : ChefHat} onClick={() => setCooking(!cooking)}>
            {cooking ? 'Done cooking' : 'Cook mode'}
          </Button>
          <Button icon={CalendarPlus} onClick={() => setPlanOpen(true)}>Plan as meal</Button>
          <Button icon={Pencil} onClick={() => navigate(`/recipes/${r.id}/edit`)}>Edit</Button>
          <Menu label="More recipe actions"
            trigger={<IconButton icon={MoreHorizontal} label="More recipe actions" variant="secondary" />}
            items={[
              { label: r.favorite ? 'Remove from favorites' : 'Add to favorites', icon: Star, onSelect: toggleFavorite },
              { separator: true },
              { label: 'Delete recipe', icon: Trash2, danger: true, onSelect: remove,
                hint: 'Restorable for 30 days' },
            ]} />
        </>}
      />

      {cooking && (
        <p className="-mt-2 mb-5 text-ui text-muted">
          Cook mode: tap ingredients as you gather them and steps as you finish them. The screen stays on.
        </p>
      )}

      {/* Summary strip */}
      <div className="mb-6 flex flex-col gap-5 lg:flex-row lg:items-start">
        <div className="min-w-0 flex-1 space-y-4">
          {r.description && (
            <p className="max-w-[62ch] font-serif text-[17px] leading-7 text-ink/90">{r.description}</p>
          )}
          {facts.length > 0 && (
            <dl className="flex flex-wrap gap-x-8 gap-y-3">
              {facts.map(f => (
                <div key={f.label}>
                  <dt className="text-xs text-muted">{f.label}</dt>
                  <dd className="text-sm font-medium text-ink tnum">{f.value}</dd>
                </div>
              ))}
            </dl>
          )}
          <div className="flex flex-wrap items-center gap-2">
            {r.favorite && <Badge tone="warn" icon={Star}>Favorite</Badge>}
            {r.cuisine && <Badge>{r.cuisine}</Badge>}
            {r.tags.map(t => <Badge key={t}>{t}</Badge>)}
            {r.source_url && (
              <a href={r.source_url} target="_blank" rel="noreferrer"
                className="inline-flex items-center gap-1 text-ui text-action hover:underline">
                {hostOf(r.source_url) || 'Source'} <ExternalLink size={12} aria-hidden />
              </a>
            )}
          </div>
          {r.planned && r.planned.length > 0 && (
            <p className="text-ui text-muted">
              On the meal plan:{' '}
              {r.planned.map((p, i) => (
                <span key={p.id}>
                  {i > 0 && ', '}
                  <Link to="/meals" className="text-action hover:underline">
                    {new Date(`${p.date}T12:00:00`).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })} {p.meal_type}
                  </Link>
                </span>
              ))}
            </p>
          )}
        </div>
        {r.image_url && !cooking && (
          <img src={r.image_url} alt="" className="aspect-[4/3] w-full rounded-panel border border-line object-cover lg:w-80"
            onError={e => { (e.target as HTMLImageElement).style.display = 'none' }} />
        )}
      </div>

      <div className="grid items-start gap-6 lg:grid-cols-[340px_1fr]">
        {/* Ingredients */}
        <Panel title="Ingredients" padded={false} className="lg:sticky lg:top-4"
          actions={<PantryMeter pantry={r.pantry} compact />}>
          {lines.length === 0 ? (
            <p className="p-4 text-sm text-muted">No ingredients yet. <Link className="text-action hover:underline" to={`/recipes/${r.id}/edit`}>Add some</Link>.</p>
          ) : (
            <ul className="divide-y divide-line">
              {lines.map((line, i) => line.status === 'heading' ? (
                <li key={i} className="bg-canvas/60 px-4 pb-1.5 pt-3 text-ui font-semibold text-ink">{line.text.replace(/:$/, '')}</li>
              ) : (
                <li key={i}>
                  <button type="button" onClick={() => toggle(gotIngredients, setGotIngredients, i)}
                    aria-pressed={gotIngredients.has(i)}
                    className="flex w-full items-start gap-3 px-4 py-2.5 text-left hover:bg-ink/[0.03]">
                    <span className={cn('mt-1 flex h-4 w-4 shrink-0 items-center justify-center rounded border',
                      gotIngredients.has(i) ? 'border-action bg-action text-action-on' : 'border-muted/50')}>
                      {gotIngredients.has(i) && <Check size={12} strokeWidth={3} aria-hidden />}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className={cn('block font-serif text-[16px] leading-6 text-ink', cooking && 'text-[18px] leading-7',
                        gotIngredients.has(i) && 'text-muted line-through decoration-muted/60')}>
                        {line.text}
                      </span>
                      <PantryNote line={line} />
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        {/* Method */}
        <div className="space-y-6">
          <Panel title="Method" padded={false}>
            {r.steps.length === 0 ? (
              <p className="p-4 text-sm text-muted">No steps yet.</p>
            ) : (
              <ol className="divide-y divide-line">
                {r.steps.map((step, i) => {
                  if (step.trim().endsWith(':') && step.length < 60) {
                    return <li key={i} className="bg-canvas/60 px-5 pb-2 pt-4 text-ui font-semibold text-ink">{step.replace(/:$/, '')}</li>
                  }
                  stepNumber += 1
                  const done = doneSteps.has(i)
                  return (
                    <li key={i}>
                      <button type="button" onClick={() => toggle(doneSteps, setDoneSteps, i)} aria-pressed={done}
                        className="grid w-full grid-cols-[2.5rem_1fr] gap-2 px-5 py-4 text-left hover:bg-ink/[0.03]">
                        <span className={cn('font-serif text-2xl leading-7 tnum', done ? 'text-action' : 'text-muted/70')} aria-hidden>
                          {done ? <Check size={22} className="mt-0.5" /> : stepNumber}
                        </span>
                        <span className={cn('max-w-[68ch] font-serif text-[17px] leading-7 text-ink',
                          cooking && 'text-[20px] leading-8', done && 'text-muted')}>
                          <span className="sr-only">Step {stepNumber}{done ? ', done' : ''}: </span>{step}
                        </span>
                      </button>
                    </li>
                  )
                })}
              </ol>
            )}
          </Panel>

          {r.notes && (
            <Panel title="Family notes">
              <p className="whitespace-pre-line font-serif text-[16px] leading-7 text-ink">{r.notes}</p>
            </Panel>
          )}
        </div>
      </div>

      <PlanDialog recipe={r} open={planOpen} onClose={() => setPlanOpen(false)} onPlanned={load} />
    </Page>
  )
}

function PantryNote({ line }: { line: PantryLine }) {
  if (line.status === 'have') {
    return (
      <span className="mt-0.5 flex items-center gap-1.5 text-xs text-muted">
        <span className="h-1.5 w-1.5 rounded-full bg-action" aria-hidden />
        On hand{line.location ? ` in ${line.location}` : ''}
      </span>
    )
  }
  if (line.status === 'missing') {
    return (
      <span className="mt-0.5 flex items-center gap-1.5 text-xs text-warn">
        <span className="h-1.5 w-1.5 rounded-full border border-warn" aria-hidden />
        Not in the house
      </span>
    )
  }
  if (line.status === 'staple') return <span className="mt-0.5 block text-xs text-muted">Pantry staple</span>
  return null
}
