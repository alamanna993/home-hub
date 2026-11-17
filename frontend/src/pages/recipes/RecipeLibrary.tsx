import { FormEvent, useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import toast from 'react-hot-toast'
import { BookOpen, Clock, Link2, LayoutGrid, List, Plus, Search, Star, Trash2, Users } from 'lucide-react'
import {
  Badge, Button, DataTable, EmptyState, IconButton, Input, Page, PageHeader, Panel, Select, Skeleton,
  type Column,
} from '../../components/ui'
import { EmeraldMark } from '../../components/EmeraldMark'
import { useEmeraldChat } from '../../hooks/useEmeraldChat'
import { chat, errorText, getRecipes, getRecipeTrash, mediaUrl, type Recipe, type RecipeSort } from '../../lib/api'
import { cn, timeAgo } from '../../lib/utils'
import { formatMinutes, PantryMeter, servesLabel } from './shared'

type View = 'grid' | 'list'
const VIEW_KEY = 'hh_recipes_view'

function readView(): View {
  try { return localStorage.getItem(VIEW_KEY) === 'list' ? 'list' : 'grid' } catch { return 'grid' }
}

const SORTS: { id: RecipeSort; label: string }[] = [
  { id: 'recent', label: 'Recently updated' },
  { id: 'cookable', label: 'Most on hand' },
  { id: 'quick', label: 'Quickest' },
  { id: 'title', label: 'A to Z' },
]

export default function RecipeLibrary() {
  const navigate = useNavigate()
  const { openPanel } = useEmeraldChat()
  const [recipes, setRecipes] = useState<Recipe[] | null>(null)
  const [trashCount, setTrashCount] = useState(0)
  const [query, setQuery] = useState('')
  const [tag, setTag] = useState<string | null>(null)
  const [sort, setSort] = useState<RecipeSort>('recent')
  const [view, setView] = useState<View>(readView)
  const [link, setLink] = useState('')
  const [fetching, setFetching] = useState(false)

  // Paste a link and Emerald goes and gets the recipe, photo included
  async function saveFromLink(e: FormEvent) {
    e.preventDefault()
    const url = link.trim()
    if (!url || fetching) return
    setFetching(true)
    try {
      const r = await chat(url)
      const saved = r.recipes?.[0] ?? r.recipe
      if (saved) { toast.success(`Saved “${saved.title}”`); setLink(''); navigate(`/recipes/${saved.id}`) }
      else toast(r.reply, { duration: 7000 })
    } catch (err) { toast.error(errorText(err, "Couldn't get that recipe")) }
    finally { setFetching(false) }
  }

  useEffect(() => {
    getRecipes({ sort }).then(setRecipes).catch(() => setRecipes([]))
  }, [sort])
  useEffect(() => { getRecipeTrash().then(t => setTrashCount(t.length)).catch(() => {}) }, [])
  useEffect(() => { try { localStorage.setItem(VIEW_KEY, view) } catch { /* private mode */ } }, [view])

  const tags = useMemo(() => {
    const counts = new Map<string, number>()
    for (const r of recipes || []) for (const t of r.tags) counts.set(t, (counts.get(t) || 0) + 1)
    return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12).map(([t]) => t)
  }, [recipes])

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase()
    return (recipes || []).filter(r =>
      (!tag || r.tags.includes(tag)) &&
      (!q || [r.title, r.description, r.cuisine, ...r.tags, ...r.ingredients]
        .some(v => v?.toLowerCase().includes(q))))
  }, [recipes, query, tag])

  const ready = (recipes || []).filter(r => r.pantry && r.pantry.total > 0 && r.pantry.have === r.pantry.total).length

  const columns: Column<Recipe>[] = [
    {
      key: 'title', header: 'Recipe', sortValue: r => r.title.toLowerCase(),
      cell: r => (
        <div className="flex min-w-0 items-center gap-2">
          {r.favorite && <Star size={14} className="shrink-0 fill-honey text-honey" aria-label="Favorite" />}
          <span className="truncate font-medium text-ink">{r.title}</span>
        </div>
      ),
    },
    { key: 'time', header: 'Time', width: '7rem', sortValue: r => r.total_minutes, cell: r => formatMinutes(r.total_minutes) || '—' },
    { key: 'serves', header: 'Serves', width: '6rem', hideBelow: 'xl', cell: r => r.servings || '—' },
    {
      key: 'pantry', header: 'On hand', width: '13rem',
      sortValue: r => (r.pantry?.total ? r.pantry.have / r.pantry.total : null),
      cell: r => <PantryMeter pantry={r.pantry} compact />,
    },
    {
      key: 'tags', header: 'Tags', hideBelow: 'lg',
      cell: r => <div className="flex flex-wrap gap-1">{r.tags.slice(0, 3).map(t => <Badge key={t}>{t}</Badge>)}</div>,
    },
    { key: 'updated', header: 'Updated', width: '7rem', hideBelow: 'xl', sortValue: r => r.updated_at || '', cell: r => r.updated_at ? timeAgo(r.updated_at) : '—' },
  ]

  return (
    <Page>
      <PageHeader
        title="Recipes"
        description={recipes
          ? `${recipes.length} saved${ready ? `, ${ready} with everything on hand` : ''}`
          : 'Your family cookbook'}
        actions={<>
          {trashCount > 0 && (
            <Button variant="ghost" icon={Trash2} onClick={() => navigate('/recipes/trash')}>
              Recently deleted <span className="text-muted tnum">{trashCount}</span>
            </Button>
          )}
          <Button variant="primary" icon={Plus} onClick={() => navigate('/recipes/new')}>New recipe</Button>
        </>}
      />

      <form onSubmit={saveFromLink} className="mb-5 flex flex-col gap-2 rounded-panel border border-emerald/30 bg-emerald/[0.06] p-3 sm:flex-row">
        <div className="relative flex-1">
          <Link2 size={18} aria-hidden className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-emerald" />
          <Input type="url" inputMode="url" value={link} onChange={e => setLink(e.target.value)}
            placeholder="Paste a recipe link" aria-label="Recipe link" className="pl-10" disabled={fetching} />
        </div>
        <Button type="submit" variant="primary" loading={fetching} disabled={!link.trim()}>
          {fetching ? 'Getting the recipe…' : 'Save recipe'}
        </Button>
      </form>

      {/* Toolbar */}
      <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-center">
        <div className="relative lg:w-80">
          <Search size={16} aria-hidden className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
          <Input value={query} onChange={e => setQuery(e.target.value)} placeholder="Search recipes or ingredients"
            aria-label="Search recipes" className="pl-9" />
        </div>
        <div className="flex items-center gap-2 lg:ml-auto">
          <Select value={sort} onChange={e => setSort(e.target.value as RecipeSort)} aria-label="Sort recipes" className="w-44">
            {SORTS.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
          </Select>
          <div className="flex rounded-control border border-line bg-surface p-0.5" role="group" aria-label="View">
            <IconButton icon={LayoutGrid} label="Grid view" size="sm" aria-pressed={view === 'grid'}
              onClick={() => setView('grid')} className={cn('h-8 w-8', view === 'grid' && 'bg-ink/[0.07] text-ink')} />
            <IconButton icon={List} label="List view" size="sm" aria-pressed={view === 'list'}
              onClick={() => setView('list')} className={cn('h-8 w-8', view === 'list' && 'bg-ink/[0.07] text-ink')} />
          </div>
        </div>
      </div>

      {tags.length > 0 && (
        <div className="-mx-4 mb-5 flex gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none] md:mx-0 md:flex-wrap md:px-0" role="group" aria-label="Filter by tag">
          {tags.map(t => (
            <button key={t} type="button" aria-pressed={tag === t} onClick={() => setTag(tag === t ? null : t)}
              className={cn('h-10 shrink-0 rounded-full border px-4 text-ui transition-colors',
                tag === t ? 'border-action bg-action/10 text-action' : 'border-line bg-surface text-muted hover:text-ink')}>
              {t}
            </button>
          ))}
        </div>
      )}

      {recipes === null ? (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {[0, 1, 2].map(i => <Skeleton key={i} className="h-64 rounded-panel" />)}
        </div>
      ) : recipes.length === 0 ? (
        <Panel padded={false}>
          <EmptyState icon={BookOpen} title="No recipes yet"
            description="Save the dishes your family makes. Paste a link from a recipe site, type one in, or ask Emerald to save one."
            action={<>
              <Button variant="primary" icon={Plus} onClick={() => navigate('/recipes/new')}>Write one</Button>
            </>} />
        </Panel>
      ) : shown.length === 0 ? (
        <Panel padded={false}>
          <EmptyState icon={Search} title="No recipes match"
            description="Try another word, or clear the tag filter."
            action={<Button onClick={() => { setQuery(''); setTag(null) }}>Clear filters</Button>} />
        </Panel>
      ) : view === 'list' ? (
        <Panel padded={false}>
          <DataTable columns={columns} rows={shown} rowKey={r => r.id} onRowClick={r => navigate(`/recipes/${r.id}`)}
            caption="Saved recipes" />
        </Panel>
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {shown.map(r => <RecipeCard key={r.id} recipe={r} />)}
        </ul>
      )}

      {recipes && recipes.length > 0 && (
        <p className="mt-6 flex items-center gap-2 text-ui text-muted">
          <EmeraldMark size={14} className="text-emerald" />
          Emerald can save recipes from chat too.
          <button type="button" className="font-medium text-action hover:underline"
            onClick={() => openPanel('What can I make for dinner tonight?')}>
            Ask what you can make tonight
          </button>
        </p>
      )}
    </Page>
  )
}

function RecipeCard({ recipe: r }: { recipe: Recipe }) {
  const [imageFailed, setImageFailed] = useState(false)
  const time = formatMinutes(r.total_minutes)
  return (
    <li>
      <Link to={`/recipes/${r.id}`}
        className="group flex h-full flex-col overflow-hidden rounded-panel border border-line bg-surface transition-colors hover:border-muted/50">
        <div className="relative aspect-[4/3] overflow-hidden border-b border-line bg-canvas sm:aspect-[16/9]">
          {r.image_url && !imageFailed ? (
            <img src={mediaUrl(r.image_url, true)} alt="" loading="lazy" onError={() => setImageFailed(true)}
              className="h-full w-full object-cover" />
          ) : (
            // No photo: the title itself, set in the reader's serif
            <div className="flex h-full items-end p-4">
              <span className="line-clamp-2 font-serif text-2xl leading-tight text-ink/25">{r.title}</span>
            </div>
          )}
          {r.favorite && (
            <span className="absolute right-2 top-2 flex h-7 w-7 items-center justify-center rounded-full bg-surface/90">
              <Star size={14} className="fill-honey text-honey" aria-label="Favorite" />
            </span>
          )}
        </div>
        <div className="flex flex-1 flex-col gap-2 p-4">
          <h3 className="font-semibold leading-snug text-ink group-hover:underline">{r.title}</h3>
          {(time || r.servings) && (
            <p className="flex items-center gap-3 text-ui text-muted">
              {time && <span className="inline-flex items-center gap-1"><Clock size={13} aria-hidden />{time}</span>}
              {r.servings && <span className="inline-flex items-center gap-1"><Users size={13} aria-hidden />{servesLabel(r.servings)}</span>}
            </p>
          )}
          <div className="mt-auto pt-1"><PantryMeter pantry={r.pantry} /></div>
        </div>
      </Link>
    </li>
  )
}
