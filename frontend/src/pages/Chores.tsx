import { useEffect, useMemo, useState } from 'react'
import { ArrowLeftRight, Check, ClipboardList, History, MoreHorizontal, Pencil, Plus, RotateCcw, Trash2, UserPlus, X } from 'lucide-react'
import toast from 'react-hot-toast'
import {
  getChores, createChore, completeChore, uncompleteChore, deleteChore, updateChore, deleteChoreCompletion, reassignChore, Chore,
  getFamily, createFamilyMember, updateFamilyMember, deleteFamilyMember, FamilyMember, getPastChores, clearPastChores, PastChore,
  errorText,
} from '../lib/api'
import EmojiPicker from '../components/EmojiPicker'
import {
  Badge, Button, ConfirmDialog, Dialog, EmptyState, Field, IconButton, Input, Menu, Page, PageHeader, Panel, Select, Tabs,
} from '../components/ui'
import { cn } from '../lib/utils'

const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']
const FREQ_LABEL: Record<string, string> = { once: 'One-time', daily: 'Daily', weekly: 'Weekly', biweekly: 'Every 2 weeks', monthly: 'Monthly' }

type ChoreForm = { title: string; icon: string; assigned_to: string; frequency: string; day_of_week: string }
const EMPTY_FORM: ChoreForm = { title: '', icon: '🧹', assigned_to: '', frequency: 'weekly', day_of_week: '' }

export default function Chores() {
  const [chores, setChores] = useState<Chore[]>([])
  const [members, setMembers] = useState<FamilyMember[]>([])
  const [past, setPast] = useState<PastChore[]>([])
  const [showAllPast, setShowAllPast] = useState(false)

  // Chore dialog: null = closed, 'new' = adding, a Chore = editing it
  const [choreDialog, setChoreDialog] = useState<Chore | 'new' | null>(null)
  const [form, setForm] = useState<ChoreForm>(EMPTY_FORM)
  const [saving, setSaving] = useState(false)
  const [reassign, setReassign] = useState<Chore | null>(null)
  const [reassignScope, setReassignScope] = useState<'period' | 'permanent'>('period')
  const [removing, setRemoving] = useState<Chore | null>(null)
  const [renaming, setRenaming] = useState<{ id: number; title: string } | null>(null)
  const [clearing, setClearing] = useState(false)

  // Family member dialog: null = closed, 'new' = adding
  const [memberDialog, setMemberDialog] = useState<FamilyMember | 'new' | null>(null)
  const [memberForm, setMemberForm] = useState({ name: '', icon: '🙂' })
  const [removingMember, setRemovingMember] = useState<FamilyMember | null>(null)

  const load = () => {
    getChores().then(setChores).catch(() => {})
    getFamily().then(setMembers).catch(() => {})
    getPastChores().then(setPast).catch(() => {})
  }
  useEffect(() => { load() }, [])

  function openNew(person = '') {
    setForm({ ...EMPTY_FORM, assigned_to: person }); setChoreDialog('new')
  }
  function openEdit(chore: Chore) {
    setForm({
      title: chore.title, icon: chore.icon || '🧹',
      // edit the real owner, not a temporary stand-in
      assigned_to: (chore.override_active ? chore.original_assigned_to : chore.assigned_to) || '',
      frequency: chore.frequency,
      day_of_week: chore.day_of_week != null ? String(chore.day_of_week) : '',
    })
    setChoreDialog(chore)
  }

  async function saveChore() {
    if (!form.title.trim()) { toast.error('Give the chore a name'); return }
    const weekly = form.frequency === 'weekly' || form.frequency === 'biweekly'
    const day = weekly && form.day_of_week !== '' ? Number(form.day_of_week) : undefined
    setSaving(true)
    try {
      if (choreDialog === 'new') {
        await createChore({ title: form.title.trim(), icon: form.icon, assigned_to: form.assigned_to || undefined, frequency: form.frequency, day_of_week: day })
        toast.success('Chore added')
      } else if (choreDialog) {
        await updateChore(choreDialog.id, { title: form.title.trim(), icon: form.icon, assigned_to: form.assigned_to, frequency: form.frequency, day_of_week: day })
        toast.success('Chore updated')
      }
      setChoreDialog(null); load()
    } catch (e) { toast.error(errorText(e, "Couldn't save the chore")) } finally { setSaving(false) }
  }

  async function doReassign(person: string) {
    if (!reassign) return
    try {
      const updated = await reassignChore(reassign.id, person || null, reassignScope === 'permanent')
      toast.success(updated.override_active
        ? `${updated.title} is ${person}'s for now, then goes back to ${updated.original_assigned_to || 'anyone'}`
        : `${updated.title} is now ${person || 'anyone'}'s`)
      setReassign(null); load()
    } catch (e) { toast.error(errorText(e)) }
  }

  async function toggle(chore: Chore) {
    try {
      const updated = chore.done_this_period ? await uncompleteChore(chore.id) : await completeChore(chore.id)
      if (!chore.done_this_period) toast.success(`Checked off ${chore.title}`)
      // A checked-off one-time chore leaves the chart for the history section
      if (updated.frequency === 'once' && updated.done_this_period) setChores(cs => cs.filter(c => c.id !== updated.id))
      else setChores(cs => cs.map(c => c.id === updated.id ? updated : c))
      getPastChores().then(setPast).catch(() => {})
    } catch (e) { toast.error(errorText(e)) }
  }

  async function restore(p: PastChore) {
    try {
      await deleteChoreCompletion(p.id)
      toast.success(p.frequency === 'once' ? `${p.title} is back on the chart` : 'Check-off undone')
      load()
    } catch (e) { toast.error(errorText(e)) }
  }

  async function saveMember() {
    if (!memberForm.name.trim()) { toast.error('Enter a name'); return }
    try {
      if (memberDialog === 'new') await createFamilyMember({ name: memberForm.name.trim(), icon: memberForm.icon })
      else if (memberDialog) await updateFamilyMember(memberDialog.id, { name: memberForm.name.trim(), icon: memberForm.icon })
      toast.success(memberDialog === 'new' ? `Added ${memberForm.name.trim()}` : 'Saved')
      setMemberDialog(null); load()
    } catch (e) { toast.error(errorText(e, "Couldn't save that person")) }
  }

  const byPerson = useMemo(() => {
    const map: Record<string, Chore[]> = {}
    for (const m of members) map[m.name] = []   // every family member gets their own section
    for (const c of chores) (map[c.assigned_to || 'Anyone'] ||= []).push(c)
    return Object.entries(map).sort(([a], [b]) => a === 'Anyone' ? 1 : b === 'Anyone' ? -1 : a.localeCompare(b))
  }, [chores, members])

  const memberIcon = (name: string) => members.find(m => m.name === name)?.icon
  const doneCount = chores.filter(c => c.done_this_period).length
  const weekly = form.frequency === 'weekly' || form.frequency === 'biweekly'

  return (
    <Page>
      <PageHeader title="Chores" description={chores.length ? `${doneCount} of ${chores.length} done this period` : 'Who does what, checked off as it gets done.'}
        actions={<>
          <Button icon={UserPlus} onClick={() => { setMemberForm({ name: '', icon: '🙂' }); setMemberDialog('new') }}>Add person</Button>
          <Button variant="primary" icon={Plus} onClick={() => openNew()}>Add chore</Button>
        </>} />

      {members.length > 0 && (
        <div className="mb-5 flex flex-wrap items-center gap-1.5" aria-label="Family">
          {members.map(m => (
            <Menu key={m.id} label={`${m.name} options`}
              trigger={
                <button type="button" className="flex h-8 items-center gap-1.5 rounded-full border border-line bg-surface pl-2 pr-3 text-ui text-ink hover:border-muted/50">
                  <span aria-hidden>{m.icon || '🙂'}</span>{m.name}
                </button>
              }
              items={[
                { label: 'Edit', icon: Pencil, onSelect: () => { setMemberForm({ name: m.name, icon: m.icon || '🙂' }); setMemberDialog(m) } },
                { label: `Add a chore for ${m.name}`, icon: Plus, onSelect: () => openNew(m.name) },
                { separator: true },
                { label: 'Remove from family', icon: X, danger: true, onSelect: () => setRemovingMember(m) },
              ]} />
          ))}
        </div>
      )}

      {byPerson.length === 0 ? (
        <Panel padded={false}>
          <EmptyState icon={ClipboardList} title="No chores yet"
            description="Add the people in the house, then give everyone their chores. Emerald can add chores from chat too."
            action={<>
              <Button icon={UserPlus} onClick={() => { setMemberForm({ name: '', icon: '🙂' }); setMemberDialog('new') }}>Add person</Button>
              <Button variant="primary" icon={Plus} onClick={() => openNew()}>Add chore</Button>
            </>} />
        </Panel>
      ) : (
        <div className="grid items-start gap-5 lg:grid-cols-2">
          {byPerson.map(([name, personChores]) => {
            const done = personChores.filter(c => c.done_this_period).length
            return (
              <Panel key={name} padded={false}
                title={<span className="flex items-center gap-2">{memberIcon(name) && <span aria-hidden>{memberIcon(name)}</span>}{name}</span>}
                actions={personChores.length > 0
                  ? <Badge tone={done === personChores.length ? 'action' : 'neutral'}>{done} of {personChores.length} done</Badge>
                  : <Button size="sm" variant="ghost" icon={Plus} onClick={() => openNew(name === 'Anyone' ? '' : name)}>Add chore</Button>}>
                {personChores.length === 0 ? (
                  <p className="px-4 py-3 text-sm text-muted">No chores yet.</p>
                ) : (
                  <ul className="divide-y divide-line">
                    {personChores.map(chore => {
                      const isDone = chore.done_this_period
                      return (
                        <li key={chore.id} className="group flex items-center gap-3 px-4 py-2.5">
                          <button type="button" onClick={() => toggle(chore)} aria-pressed={isDone}
                            aria-label={isDone ? `Undo ${chore.title}` : `Mark ${chore.title} done`}
                            className={cn('flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-2 transition-colors',
                              isDone ? 'border-action bg-action text-action-on' : 'border-muted/50 hover:border-action')}>
                            {isDone && <Check size={14} strokeWidth={3} aria-hidden />}
                          </button>
                          <span className="w-6 text-center text-xl leading-none" aria-hidden>{chore.icon || '🧹'}</span>
                          <div className="min-w-0 flex-1">
                            <p className={cn('truncate text-sm font-medium', isDone ? 'text-muted line-through' : 'text-ink')}>{chore.title}</p>
                            <p className="truncate text-xs text-muted">
                              {FREQ_LABEL[chore.frequency]}
                              {(chore.frequency === 'weekly' || chore.frequency === 'biweekly') && chore.day_of_week != null && `, ${DAYS[chore.day_of_week]}`}
                              {chore.override_active && ` (covering for ${chore.original_assigned_to || 'anyone'})`}
                              {isDone && chore.last_completed_by && `. Done by ${chore.last_completed_by}`}
                            </p>
                          </div>
                          <Menu label={`${chore.title} options`}
                            trigger={<IconButton icon={MoreHorizontal} label={`${chore.title} options`} size="sm" />}
                            items={[
                              { label: 'Edit', icon: Pencil, onSelect: () => openEdit(chore) },
                              { label: 'Hand to someone else', icon: ArrowLeftRight, onSelect: () => { setReassign(chore); setReassignScope('period') } },
                              { separator: true },
                              { label: 'Delete', icon: Trash2, danger: true, onSelect: () => setRemoving(chore) },
                            ]} />
                        </li>
                      )
                    })}
                  </ul>
                )}
              </Panel>
            )
          })}
        </div>
      )}

      {past.length > 0 && (
        <Panel className="mt-6" padded={false}
          title={<span className="flex items-center gap-2"><History size={16} className="text-muted" aria-hidden />History</span>}
          actions={<Button size="sm" variant="ghost" icon={Trash2} onClick={() => setClearing(true)}>Clear history</Button>}>
          <ul className="divide-y divide-line">
            {(showAllPast ? past : past.slice(0, 8)).map(p => (
              <li key={p.id} className="group flex items-center gap-3 px-4 py-2 text-sm">
                <span className="w-6 text-center leading-none" aria-hidden>{p.icon || '✅'}</span>
                <span className="min-w-0 flex-1 truncate text-ink">{p.title}</span>
                {p.completed_by && <span className="text-ui text-muted">{p.completed_by}</span>}
                <span className="w-28 text-right text-ui text-muted tnum">
                  {/* completed_at is naive UTC from the backend — pin it so local rendering is right */}
                  {new Date(p.completed_at.endsWith('Z') ? p.completed_at : p.completed_at + 'Z')
                    .toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })}
                </span>
                <IconButton icon={Pencil} label={`Rename ${p.title}`} size="sm" onClick={() => setRenaming({ id: p.chore_id, title: p.title })}
                  className="opacity-100 lg:opacity-0 lg:group-hover:opacity-100 lg:focus:opacity-100" />
                <IconButton icon={RotateCcw} label="It wasn't done: undo this check-off" size="sm" onClick={() => restore(p)}
                  className="opacity-100 lg:opacity-0 lg:group-hover:opacity-100 lg:focus:opacity-100" />
              </li>
            ))}
          </ul>
          {past.length > 8 && (
            <div className="border-t border-line px-4 py-2">
              <Button size="sm" variant="ghost" onClick={() => setShowAllPast(s => !s)}>{showAllPast ? 'Show fewer' : `Show all ${past.length}`}</Button>
            </div>
          )}
        </Panel>
      )}

      {/* Add / edit chore */}
      <Dialog open={!!choreDialog} onClose={() => setChoreDialog(null)} size="sm" title={choreDialog === 'new' ? 'Add chore' : 'Edit chore'}
        footer={<>
          <Button variant="ghost" onClick={() => setChoreDialog(null)}>Cancel</Button>
          <Button variant="primary" loading={saving} onClick={saveChore}>{choreDialog === 'new' ? 'Add chore' : 'Save changes'}</Button>
        </>}>
        <form className="space-y-4" onSubmit={e => { e.preventDefault(); saveChore() }}>
          <div className="flex items-end gap-3">
            <div className="flex flex-col gap-1.5">
              <span className="text-ui font-medium text-ink">Icon</span>
              <EmojiPicker value={form.icon} onChange={v => setForm(f => ({ ...f, icon: v }))} />
            </div>
            <Field label="Chore" required className="flex-1">
              <Input autoFocus value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))} placeholder="Take out the trash" />
            </Field>
          </div>
          <Field label="Whose job">
            <Select value={form.assigned_to} onChange={e => setForm(f => ({ ...f, assigned_to: e.target.value }))}>
              <option value="">Anyone</option>
              {members.map(m => <option key={m.id} value={m.name}>{m.icon || '🙂'} {m.name}</option>)}
            </Select>
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="How often" className={weekly ? undefined : 'col-span-2'}>
              <Select value={form.frequency} onChange={e => setForm(f => ({ ...f, frequency: e.target.value }))}>
                {Object.entries(FREQ_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </Select>
            </Field>
            {weekly && (
              <Field label="Day">
                <Select value={form.day_of_week} onChange={e => setForm(f => ({ ...f, day_of_week: e.target.value }))}>
                  <option value="">Any day</option>
                  {DAYS.map((d, i) => <option key={d} value={i}>{d}</option>)}
                </Select>
              </Field>
            )}
          </div>
          <button type="submit" hidden />
        </form>
      </Dialog>

      {/* Hand off */}
      <Dialog open={!!reassign} onClose={() => setReassign(null)} size="sm" title={`Hand off ${reassign?.title ?? ''}`}>
        {reassign && (
          <div className="space-y-4">
            <Tabs label="How long" value={reassignScope} onChange={setReassignScope}
              tabs={[
                { id: 'period', label: `Just this ${reassign.frequency === 'daily' ? 'day' : reassign.frequency === 'monthly' ? 'month' : 'week'}` },
                { id: 'permanent', label: 'From now on' },
              ]} />
            <div className="space-y-1.5">
              {members.filter(m => m.name !== reassign.assigned_to).map(m => (
                <button key={m.id} type="button" onClick={() => doReassign(m.name)}
                  className="flex w-full items-center gap-2.5 rounded-control border border-line px-3 py-2.5 text-sm text-ink hover:border-action">
                  <span aria-hidden>{m.icon || '🙂'}</span>{m.name}
                </button>
              ))}
              {reassignScope === 'permanent' && reassign.assigned_to && (
                <button type="button" onClick={() => doReassign('')}
                  className="flex w-full items-center gap-2.5 rounded-control border border-line px-3 py-2.5 text-sm text-muted hover:border-action hover:text-ink">
                  Anyone
                </button>
              )}
              {members.length === 0 && <p className="text-sm text-muted">Add family members first.</p>}
            </div>
          </div>
        )}
      </Dialog>

      {/* Rename (from history) */}
      <Dialog open={!!renaming} onClose={() => setRenaming(null)} size="sm" title="Rename chore"
        footer={<>
          <Button variant="ghost" onClick={() => setRenaming(null)}>Cancel</Button>
          <Button variant="primary" onClick={async () => {
            if (!renaming?.title.trim()) return
            try { await updateChore(renaming.id, { title: renaming.title.trim() }); toast.success('Chore renamed'); setRenaming(null); load() }
            catch (e) { toast.error(errorText(e)) }
          }}>Rename</Button>
        </>}>
        {renaming && <Field label="Name"><Input autoFocus value={renaming.title} onChange={e => setRenaming({ ...renaming, title: e.target.value })} /></Field>}
      </Dialog>

      {/* Family member */}
      <Dialog open={!!memberDialog} onClose={() => setMemberDialog(null)} size="sm" title={memberDialog === 'new' ? 'Add person' : 'Edit person'}
        footer={<>
          <Button variant="ghost" onClick={() => setMemberDialog(null)}>Cancel</Button>
          <Button variant="primary" onClick={saveMember}>{memberDialog === 'new' ? 'Add person' : 'Save changes'}</Button>
        </>}>
        <form className="flex items-end gap-3" onSubmit={e => { e.preventDefault(); saveMember() }}>
          <div className="flex flex-col gap-1.5">
            <span className="text-ui font-medium text-ink">Icon</span>
            <EmojiPicker value={memberForm.icon} onChange={v => setMemberForm(f => ({ ...f, icon: v }))} />
          </div>
          <Field label="Name" required className="flex-1">
            <Input autoFocus value={memberForm.name} onChange={e => setMemberForm(f => ({ ...f, name: e.target.value }))} />
          </Field>
          <button type="submit" hidden />
        </form>
      </Dialog>

      <ConfirmDialog open={!!removing} onClose={() => setRemoving(null)} confirmLabel="Delete chore"
        title={`Delete ${removing?.title}?`} description="It's removed from the chart along with its history."
        onConfirm={async () => {
          try { await deleteChore(removing!.id); toast.success('Chore deleted'); load() } catch (e) { toast.error(errorText(e)) }
        }} />
      <ConfirmDialog open={!!removingMember} onClose={() => setRemovingMember(null)} confirmLabel="Remove"
        title={`Remove ${removingMember?.name} from the family?`} description="Their chores stay assigned to their name."
        onConfirm={async () => {
          try { await deleteFamilyMember(removingMember!.id); load() } catch (e) { toast.error(errorText(e)) }
        }} />
      <ConfirmDialog open={clearing} onClose={() => setClearing(false)} confirmLabel="Clear history"
        title="Clear the chore history?" description="Finished one-time chores are removed for good."
        onConfirm={async () => {
          try { await clearPastChores(); toast.success('History cleared'); load() } catch (e) { toast.error(errorText(e)) }
        }} />
    </Page>
  )
}
