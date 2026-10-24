import { useEffect, useState } from 'react'
import { Pencil, Plus, Tag, Trash2 } from 'lucide-react'
import axios from 'axios'
import toast from 'react-hot-toast'
import { getCategories, createCategory, updateCategory, errorText, Category } from '../lib/api'
import EmojiPicker from '../components/EmojiPicker'
import {
  Button, ConfirmDialog, DataTable, Dialog, EmptyState, Field, Input, Page, PageHeader, Panel, type Column,
} from '../components/ui'
import { cn } from '../lib/utils'

// Category colors are data the family picks (shown as a swatch), not UI chrome
const COLORS = ['#2B4C7E', '#2F855A', '#2B6CB0', '#B7791F', '#B83280', '#6B46C1', '#0987A0', '#5A7D1A', '#C53030', '#5A6575']

type Draft = { id?: number; name: string; icon: string; color: string }

export default function Categories() {
  const [cats, setCats] = useState<Category[] | null>(null)
  const [draft, setDraft] = useState<Draft | null>(null)
  const [saving, setSaving] = useState(false)
  const [removing, setRemoving] = useState<Category | null>(null)

  const load = () => getCategories().then(setCats).catch(() => setCats([]))
  useEffect(() => { load() }, [])

  async function save() {
    if (!draft?.name.trim()) { toast.error('Give the category a name'); return }
    setSaving(true)
    try {
      const data = { name: draft.name.trim(), icon: draft.icon, color: draft.color }
      if (draft.id) await updateCategory(draft.id, data)
      else await createCategory(data)
      toast.success(draft.id ? 'Category updated' : 'Category added')
      setDraft(null); load()
    } catch (e) { toast.error(errorText(e, "Couldn't save the category")) } finally { setSaving(false) }
  }

  const edit = (c: Category) => setDraft({ id: c.id, name: c.name, icon: c.icon || '📦', color: c.color || COLORS[0] })

  const columns: Column<Category>[] = [
    {
      key: 'name', header: 'Category', sortValue: c => c.name.toLowerCase(),
      cell: c => (
        <span className="flex items-center gap-2.5">
          <span className="w-5 text-center leading-none" aria-hidden>{c.icon || '📦'}</span>
          <span className="font-medium text-ink">{c.name}</span>
        </span>
      ),
    },
    {
      key: 'color', header: 'Color', width: '8rem',
      cell: c => <span className="inline-block h-3 w-8 rounded-full" style={{ background: c.color || COLORS[COLORS.length - 1] }} aria-label="Category color" />,
    },
  ]

  return (
    <Page>
      <PageHeader title="Categories" description="Kinds of things you keep, like Groceries, Tools, or Books."
        actions={<Button variant="primary" icon={Plus} onClick={() => setDraft({ name: '', icon: '📦', color: COLORS[0] })}>Add category</Button>} />

      <Panel padded={false} className="max-w-3xl">
        <DataTable columns={columns} rows={cats || []} rowKey={c => c.id} loading={cats === null}
          initialSort={{ key: 'name', dir: 'asc' }} caption="Categories" onRowClick={edit}
          rowActions={c => [
            { label: 'Edit', icon: Pencil, onSelect: () => edit(c) },
            { separator: true },
            { label: 'Delete', icon: Trash2, danger: true, onSelect: () => setRemoving(c) },
          ]}
          empty={<EmptyState icon={Tag} title="No categories yet" description="Categories group the inventory and set sensible defaults, like stock tracking for groceries." />} />
      </Panel>

      <Dialog open={!!draft} onClose={() => setDraft(null)} size="sm" title={draft?.id ? 'Edit category' : 'Add category'}
        footer={<>
          <Button variant="ghost" onClick={() => setDraft(null)}>Cancel</Button>
          <Button variant="primary" loading={saving} onClick={save}>{draft?.id ? 'Save changes' : 'Add category'}</Button>
        </>}>
        {draft && (
          <form className="space-y-4" onSubmit={e => { e.preventDefault(); save() }}>
            <div className="flex items-end gap-3">
              <div className="flex flex-col gap-1.5">
                <span className="text-ui font-medium text-ink">Icon</span>
                <EmojiPicker value={draft.icon} onChange={v => setDraft(d => d && { ...d, icon: v })} />
              </div>
              <Field label="Name" required className="flex-1">
                <Input autoFocus value={draft.name} onChange={e => setDraft(d => d && { ...d, name: e.target.value })} placeholder="Camping gear" />
              </Field>
            </div>
            <fieldset>
              <legend className="mb-1.5 text-ui font-medium text-ink">Color</legend>
              <div className="flex flex-wrap gap-2">
                {COLORS.map(c => (
                  <button key={c} type="button" onClick={() => setDraft(d => d && { ...d, color: c })}
                    aria-label={`Color ${c}`} aria-pressed={draft.color === c}
                    className={cn('h-7 w-7 rounded-full ring-offset-2 ring-offset-surface', draft.color === c && 'ring-2 ring-ink')}
                    style={{ background: c }} />
                ))}
              </div>
            </fieldset>
            <button type="submit" hidden />
          </form>
        )}
      </Dialog>

      <ConfirmDialog open={!!removing} onClose={() => setRemoving(null)} confirmLabel="Delete category"
        title={`Delete ${removing?.name}?`} description="Items in this category keep their other details and become uncategorized."
        onConfirm={async () => {
          try { await axios.delete(`/api/categories/${removing!.id}`); toast.success('Category deleted'); load() }
          catch (e) { toast.error(errorText(e, "Couldn't delete the category")) }
        }} />
    </Page>
  )
}
