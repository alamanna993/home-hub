import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import toast from 'react-hot-toast'
import { RotateCcw, Trash2 } from 'lucide-react'
import { Button, DataTable, EmptyState, Page, PageHeader, Panel, type Column } from '../../components/ui'
import { errorText, getRecipeTrash, restoreRecipe, type Recipe } from '../../lib/api'

export default function RecipeTrash() {
  const navigate = useNavigate()
  const [rows, setRows] = useState<Recipe[] | null>(null)
  const [restoring, setRestoring] = useState<number | null>(null)

  useEffect(() => { getRecipeTrash().then(setRows).catch(() => setRows([])) }, [])

  async function restore(r: Recipe) {
    setRestoring(r.id)
    try {
      await restoreRecipe(r.id)
      setRows(rs => rs?.filter(x => x.id !== r.id) ?? null)
      toast.success(t => (
        <span>
          Restored “{r.title}”.{' '}
          <button type="button" className="font-medium text-action hover:underline"
            onClick={() => { toast.dismiss(t.id); navigate(`/recipes/${r.id}`) }}>Open it</button>
        </span>
      ))
    } catch (e) {
      toast.error(errorText(e, "Couldn't restore that recipe"))
    } finally {
      setRestoring(null)
    }
  }

  const columns: Column<Recipe>[] = [
    { key: 'title', header: 'Recipe', sortValue: r => r.title.toLowerCase(), cell: r => <span className="font-medium text-ink">{r.title}</span> },
    {
      key: 'deleted', header: 'Deleted', width: '10rem', sortValue: r => r.deleted_at || '',
      cell: r => r.deleted_at ? new Date(r.deleted_at + 'Z').toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : '—',
    },
    {
      key: 'left', header: 'Removed for good in', width: '11rem', numeric: true, sortValue: r => r.days_left ?? 0,
      cell: r => <span className={r.days_left !== undefined && r.days_left <= 3 ? 'text-warn' : undefined}>
        {r.days_left === 1 ? '1 day' : `${r.days_left ?? '—'} days`}
      </span>,
    },
    {
      key: 'restore', header: <span className="sr-only">Restore</span>, width: '8rem',
      cell: r => (
        <Button size="sm" icon={RotateCcw} loading={restoring === r.id}
          onClick={e => { e.stopPropagation(); restore(r) }}>Restore</Button>
      ),
    },
  ]

  return (
    <Page>
      <PageHeader
        breadcrumb={[{ label: 'Recipes', to: '/recipes' }]}
        title="Recently deleted"
        description="Deleted recipes stay here for 30 days, then they're removed for good."
      />
      <Panel padded={false}>
        <DataTable columns={columns} rows={rows || []} rowKey={r => r.id} loading={rows === null}
          initialSort={{ key: 'deleted', dir: 'desc' }} caption="Recently deleted recipes"
          empty={<EmptyState icon={Trash2} title="Nothing here" description="Recipes you delete show up here so you can bring them back." />} />
      </Panel>
    </Page>
  )
}
