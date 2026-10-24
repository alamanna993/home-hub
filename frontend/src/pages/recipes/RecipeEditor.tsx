import { ClipboardEvent, KeyboardEvent, useEffect, useRef, useState } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import toast from 'react-hot-toast'
import { ArrowDown, ArrowUp, Download, Plus, X } from 'lucide-react'
import {
  Badge, Button, Field, IconButton, Input, Page, PageHeader, Panel, Skeleton, Tabs, Textarea,
} from '../../components/ui'
import { EmeraldMark } from '../../components/EmeraldMark'
import {
  createRecipe, errorText, getRecipe, importRecipe, updateRecipe, type RecipeDraft,
} from '../../lib/api'
import { hostOf } from './shared'

const EMPTY: RecipeDraft = {
  title: '', description: '', servings: '', prep_minutes: null, cook_minutes: null,
  ingredients: [''], steps: [''], tags: [], cuisine: '', source_url: '', image_url: '', notes: '', favorite: false,
}

type ImportMode = 'link' | 'text'

export default function RecipeEditor() {
  const { id } = useParams()
  const editing = id !== undefined
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const [draft, setDraft] = useState<RecipeDraft | null>(editing ? null : EMPTY)
  const [tagText, setTagText] = useState('')
  const [saving, setSaving] = useState(false)
  const [titleError, setTitleError] = useState<string | null>(null)
  const [importMode, setImportMode] = useState<ImportMode>('link')
  const [importUrl, setImportUrl] = useState('')
  const [importText, setImportText] = useState('')
  const [importing, setImporting] = useState(false)
  const [importError, setImportError] = useState<string | null>(null)
  const [importedBy, setImportedBy] = useState<RecipeDraft['imported_by'] | null>(null)
  const importRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!editing) return
    getRecipe(Number(id)).then(r => {
      setDraft({ ...r, ingredients: r.ingredients.length ? r.ingredients : [''], steps: r.steps.length ? r.steps : [''] })
      setTagText(r.tags.join(', '))
    }).catch(() => { toast.error('That recipe could not be loaded'); navigate('/recipes') })
  }, [id])

  useEffect(() => { if (params.get('import')) importRef.current?.focus() }, [])

  if (!draft) {
    return <Page><Skeleton className="mb-6 h-9 w-1/2" /><Skeleton className="h-96 rounded-panel" /></Page>
  }

  const set = <K extends keyof RecipeDraft>(key: K, value: RecipeDraft[K]) => setDraft(d => d && { ...d, [key]: value })

  async function runImport() {
    setImporting(true); setImportError(null)
    try {
      const data = importMode === 'link'
        ? await importRecipe({ url: importUrl.trim() })
        : await importRecipe({ text: importText, url: importUrl.trim() || undefined })
      setDraft({
        ...EMPTY, ...data,
        ingredients: data.ingredients.length ? data.ingredients : [''],
        steps: data.steps.length ? data.steps : [''],
      })
      setTagText(data.tags.join(', '))
      setImportedBy(data.imported_by || null)
      setTitleError(null)
      toast.success('Recipe filled in. Check it over, then save.')
    } catch (e) {
      setImportError(errorText(e, "Couldn't import that recipe"))
    } finally {
      setImporting(false)
    }
  }

  async function save() {
    if (!draft) return
    if (!draft.title.trim()) { setTitleError('Give the recipe a name'); return }
    setSaving(true)
    const payload: RecipeDraft = {
      ...draft,
      ingredients: draft.ingredients.map(s => s.trim()).filter(Boolean),
      steps: draft.steps.map(s => s.trim()).filter(Boolean),
      tags: tagText.split(',').map(t => t.trim()).filter(Boolean),
    }
    delete payload.imported_by
    try {
      const saved = editing ? await updateRecipe(Number(id), payload) : await createRecipe(payload)
      toast.success(editing ? 'Changes saved' : 'Recipe saved')
      navigate(`/recipes/${saved.id}`)
    } catch (e) {
      toast.error(errorText(e, "Couldn't save the recipe"))
    } finally {
      setSaving(false)
    }
  }

  const minutes = (v: string) => (v === '' ? null : Math.max(0, Math.round(Number(v)) || 0))

  return (
    <Page className="pb-28">
      <PageHeader
        breadcrumb={[{ label: 'Recipes', to: '/recipes' }, ...(editing ? [{ label: draft.title || 'Recipe', to: `/recipes/${id}` }] : [])]}
        title={editing ? 'Edit recipe' : 'New recipe'}
        description={editing ? undefined : 'Import it from a link or pasted text, or type it in.'}
      />

      <div className="max-w-3xl space-y-5">
        {!editing && (
          <Panel title="Import" description="HomeHub reads the recipe and fills in the form below. Nothing is saved until you save."
            actions={importedBy && (importedBy === 'emerald'
              ? <Badge tone="emerald"><EmeraldMark size={12} />Filled in by Emerald</Badge>
              : <Badge tone="action">Imported from {hostOf(draft.source_url) || 'the page'}</Badge>)}>
            <Tabs label="Import from" value={importMode} onChange={m => { setImportMode(m); setImportError(null) }}
              tabs={[{ id: 'link', label: 'From a link' }, { id: 'text', label: 'Paste text' }]} className="mb-4" />
            {importMode === 'link' ? (
              <form className="flex flex-col gap-2 sm:flex-row sm:items-start" onSubmit={e => { e.preventDefault(); runImport() }}>
                <Field label="Recipe link" hideLabel error={importError} className="flex-1">
                  <Input ref={importRef} type="url" inputMode="url" value={importUrl} onChange={e => setImportUrl(e.target.value)}
                    placeholder="https://www.example.com/best-lasagna" />
                </Field>
                <Button type="submit" variant="primary" icon={Download} loading={importing} disabled={!importUrl.trim()}>
                  {importing ? 'Reading the page' : 'Import'}
                </Button>
              </form>
            ) : (
              <form className="space-y-2" onSubmit={e => { e.preventDefault(); runImport() }}>
                <Field label="Recipe text" hint="Paste the whole recipe. Emerald sorts out the ingredients and steps." error={importError}>
                  <Textarea rows={7} value={importText} onChange={e => setImportText(e.target.value)}
                    placeholder={'Grandma\'s banana bread\n3 ripe bananas\n1/3 cup melted butter\n…'} />
                </Field>
                <div className="flex justify-end">
                  <Button type="submit" variant="primary" loading={importing} disabled={importText.trim().length < 20}>
                    {!importing && <EmeraldMark size={16} />}
                    {importing ? 'Emerald is reading it' : 'Fill in with Emerald'}
                  </Button>
                </div>
              </form>
            )}
          </Panel>
        )}

        <Panel title="Basics">
          <div className="grid gap-4 sm:grid-cols-6">
            <Field label="Name" required error={titleError} className="sm:col-span-6">
              <Input value={draft.title} onChange={e => { set('title', e.target.value); setTitleError(null) }}
                placeholder="Weeknight fried rice" />
            </Field>
            <Field label="Short description" className="sm:col-span-6">
              <Textarea rows={2} value={draft.description || ''} onChange={e => set('description', e.target.value)}
                placeholder="What it is and why the family likes it" />
            </Field>
            <Field label="Serves" hint="e.g. 4, or Makes 12" className="sm:col-span-2">
              <Input value={draft.servings || ''} onChange={e => set('servings', e.target.value)} />
            </Field>
            <Field label="Prep (minutes)" className="sm:col-span-2">
              <Input type="number" min={0} inputMode="numeric" value={draft.prep_minutes ?? ''}
                onChange={e => set('prep_minutes', minutes(e.target.value))} />
            </Field>
            <Field label="Cook (minutes)" className="sm:col-span-2">
              <Input type="number" min={0} inputMode="numeric" value={draft.cook_minutes ?? ''}
                onChange={e => set('cook_minutes', minutes(e.target.value))} />
            </Field>
            <Field label="Cuisine" className="sm:col-span-2">
              <Input value={draft.cuisine || ''} onChange={e => set('cuisine', e.target.value)} placeholder="Italian" />
            </Field>
            <Field label="Tags" hint="Separate with commas" className="sm:col-span-4">
              <Input value={tagText} onChange={e => setTagText(e.target.value)} placeholder="dinner, quick, vegetarian" />
            </Field>
          </div>
        </Panel>

        <Panel title="Ingredients" description="One per line, with amounts. End a line with a colon to start a group, like “For the sauce:”.">
          <LineList values={draft.ingredients} onChange={v => set('ingredients', v)} addLabel="Add ingredient"
            placeholder="2 cups cooked rice" itemLabel="Ingredient" />
        </Panel>

        <Panel title="Method" description="One step per box, in order.">
          <LineList values={draft.steps} onChange={v => set('steps', v)} addLabel="Add step" multiline numbered
            placeholder="Scramble the eggs in a hot pan." itemLabel="Step" />
        </Panel>

        <Panel title="More">
          <div className="grid gap-4">
            <Field label="Family notes">
              <Textarea rows={3} value={draft.notes || ''} onChange={e => set('notes', e.target.value)}
                placeholder="Double the garlic. Sam likes it without peas." />
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Photo link">
                <Input type="url" value={draft.image_url || ''} onChange={e => set('image_url', e.target.value)} placeholder="https://" />
              </Field>
              <Field label="Source link">
                <Input type="url" value={draft.source_url || ''} onChange={e => set('source_url', e.target.value)} placeholder="https://" />
              </Field>
            </div>
          </div>
        </Panel>
      </div>

      {/* Sticky save bar */}
      <div className="fixed inset-x-0 bottom-0 z-20 border-t border-line bg-surface/95 pb-[env(safe-area-inset-bottom)] backdrop-blur lg:left-[60px] xl:left-60">
        <div className="flex max-w-[calc(48rem+4rem)] items-center justify-end gap-2 px-4 py-3 lg:px-8">
          <Button variant="ghost" onClick={() => navigate(editing ? `/recipes/${id}` : '/recipes')}>Cancel</Button>
          <Button variant="primary" loading={saving} onClick={save}>{editing ? 'Save changes' : 'Save recipe'}</Button>
        </div>
      </div>
    </Page>
  )
}

/** Editable list of lines: Enter adds a row, pasting several lines splits them into rows */
function LineList({ values, onChange, addLabel, placeholder, multiline, numbered, itemLabel }: {
  values: string[]; onChange: (v: string[]) => void; addLabel: string; placeholder: string
  multiline?: boolean; numbered?: boolean; itemLabel: string
}) {
  const refs = useRef<(HTMLInputElement | HTMLTextAreaElement | null)[]>([])
  const [focusIndex, setFocusIndex] = useState<number | null>(null)
  useEffect(() => {
    if (focusIndex !== null) { refs.current[focusIndex]?.focus(); setFocusIndex(null) }
  }, [focusIndex, values.length])

  const update = (i: number, v: string) => onChange(values.map((x, j) => (j === i ? v : x)))
  const insertAfter = (i: number, items: string[] = ['']) => {
    onChange([...values.slice(0, i + 1), ...items, ...values.slice(i + 1)])
    setFocusIndex(i + items.length)
  }
  const remove = (i: number) => {
    const next = values.filter((_, j) => j !== i)
    onChange(next.length ? next : [''])
    setFocusIndex(Math.max(0, i - 1))
  }
  const move = (i: number, dir: -1 | 1) => {
    const j = i + dir
    if (j < 0 || j >= values.length) return
    const next = [...values]; [next[i], next[j]] = [next[j], next[i]]
    onChange(next); setFocusIndex(j)
  }

  function onKeyDown(e: KeyboardEvent, i: number) {
    if (e.key === 'Enter' && !(multiline && e.shiftKey)) { e.preventDefault(); insertAfter(i) }
    if (e.key === 'Backspace' && !values[i] && values.length > 1) { e.preventDefault(); remove(i) }
  }
  function onPaste(e: ClipboardEvent, i: number) {
    const lines = e.clipboardData.getData('text').split(/\r?\n/).map(l => l.replace(/^\s*(?:[-•*]|\d+[.)])\s+/, '').trim()).filter(Boolean)
    if (lines.length < 2) return
    e.preventDefault()
    const [first, ...rest] = lines
    const next = [...values]
    next[i] = (values[i] ? values[i] + ' ' : '') + first
    onChange([...next.slice(0, i + 1), ...rest, ...next.slice(i + 1)])
    setFocusIndex(i + rest.length)
  }

  let n = 0
  return (
    <div className="space-y-2">
      <ol className="space-y-2">
        {values.map((value, i) => {
          const heading = value.trim().endsWith(':')
          if (!heading) n += 1
          const common = {
            value, placeholder: i === 0 ? placeholder : undefined,
            'aria-label': heading ? `Group heading ${i + 1}` : `${itemLabel} ${n}`,
            onChange: (e: { target: { value: string } }) => update(i, e.target.value),
            onKeyDown: (e: KeyboardEvent) => onKeyDown(e, i),
            onPaste: (e: ClipboardEvent) => onPaste(e, i),
          }
          return (
            <li key={i} className="group flex items-start gap-2">
              {numbered && (
                <span className="w-6 shrink-0 pt-2 text-right font-serif text-base text-muted tnum" aria-hidden>
                  {heading ? '' : n}
                </span>
              )}
              {multiline
                ? <Textarea ref={el => { refs.current[i] = el }} rows={2} {...common} className="flex-1" />
                : <Input ref={el => { refs.current[i] = el }} {...common} className={heading ? 'flex-1 font-semibold' : 'flex-1'} />}
              <div className="flex shrink-0 opacity-100 lg:opacity-0 lg:group-focus-within:opacity-100 lg:group-hover:opacity-100">
                <IconButton icon={ArrowUp} label={`Move ${itemLabel.toLowerCase()} up`} size="sm" onClick={() => move(i, -1)} disabled={i === 0} />
                <IconButton icon={ArrowDown} label={`Move ${itemLabel.toLowerCase()} down`} size="sm" onClick={() => move(i, 1)} disabled={i === values.length - 1} />
                <IconButton icon={X} label={`Remove ${itemLabel.toLowerCase()}`} size="sm" onClick={() => remove(i)} />
              </div>
            </li>
          )
        })}
      </ol>
      <Button size="sm" variant="ghost" icon={Plus} onClick={() => insertAfter(values.length - 1)}
        className={numbered ? 'ml-8' : undefined}>{addLabel}</Button>
    </div>
  )
}
