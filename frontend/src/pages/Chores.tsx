import { useEffect, useMemo, useState } from 'react'
import { motion } from 'framer-motion'
import { Check, ClipboardList, Pencil, Plus, Trash2, UserPlus, X } from 'lucide-react'
import toast from 'react-hot-toast'
import { getChores, createChore, completeChore, uncompleteChore, deleteChore, Chore, getFamily, createFamilyMember, updateFamilyMember, deleteFamilyMember, FamilyMember } from '../lib/api'
import EmojiPicker from '../components/EmojiPicker'
import { cn } from '../lib/utils'

const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']
const FREQ_LABEL: Record<string, string> = { once: 'One-time', daily: 'Daily', weekly: 'Weekly', monthly: 'Monthly' }
const CHEERS = ['🎉 Great job!', '⭐ Awesome!', '🙌 Nice work!', '💪 You did it!', '🌟 Superstar!']

export default function Chores() {
  const [chores, setChores] = useState<Chore[]>([])
  const [members, setMembers] = useState<FamilyMember[]>([])
  const [title, setTitle] = useState('')
  const [icon, setIcon] = useState('🧹')
  const [person, setPerson] = useState('')
  const [frequency, setFrequency] = useState('weekly')
  const [dayOfWeek, setDayOfWeek] = useState<string>('')
  const [adding, setAdding] = useState(false)
  const [newMember, setNewMember] = useState('')
  const [newMemberIcon, setNewMemberIcon] = useState('🙂')
  const [editMemberId, setEditMemberId] = useState<number | null>(null)
  const [editMember, setEditMember] = useState({ name: '', icon: '' })

  const load = () => { getChores().then(setChores); getFamily().then(setMembers).catch(() => {}) }
  useEffect(() => { load() }, [])

  async function addMember() {
    if (!newMember.trim()) return
    try {
      await createFamilyMember({ name: newMember.trim(), icon: newMemberIcon })
      setNewMember(''); toast.success('Family member added'); load()
    } catch (e: any) {
      toast.error(e?.response?.data?.detail || 'Could not add member')
    }
  }

  async function removeMember(m: FamilyMember) {
    if (!confirm(`Remove ${m.name} from the family list? Their chores stay assigned by name.`)) return
    await deleteFamilyMember(m.id)
    load()
  }

  async function saveMember(id: number) {
    if (!editMember.name.trim()) return toast.error('Name is required')
    try {
      await updateFamilyMember(id, { name: editMember.name.trim(), icon: editMember.icon })
      toast.success('Updated')
      setEditMemberId(null)
      load()
    } catch (e: any) {
      toast.error(e?.response?.data?.detail || 'Could not update')
    }
  }

  async function add() {
    if (!title.trim()) return
    setAdding(true)
    try {
      await createChore({
        title: title.trim(),
        icon,
        assigned_to: person.trim() || undefined,
        frequency,
        day_of_week: frequency === 'weekly' && dayOfWeek !== '' ? Number(dayOfWeek) : undefined,
      })
      setTitle(''); toast.success('Chore added'); load()
    } finally { setAdding(false) }
  }

  async function toggle(chore: Chore) {
    const updated = chore.done_this_period
      ? await uncompleteChore(chore.id)
      : await completeChore(chore.id)
    if (!chore.done_this_period) {
      toast(CHEERS[Math.floor(Math.random() * CHEERS.length)], { icon: chore.icon || '✅' })
    }
    setChores(cs => cs.map(c => c.id === updated.id ? updated : c))
  }

  async function remove(id: number) {
    await deleteChore(id)
    toast.success('Chore removed'); load()
  }

  const byPerson = useMemo(() => {
    const map: Record<string, Chore[]> = {}
    for (const m of members) map[m.name] = []   // every family member gets their own row
    for (const c of chores) (map[c.assigned_to || 'Anyone'] ||= []).push(c)
    return Object.entries(map).sort(([a], [b]) => a.localeCompare(b))
  }, [chores, members])

  const memberIcon = (name: string) => members.find(m => m.name === name)?.icon

  return (
    <div className="p-6 space-y-5">
      <div>
        <h2 className="text-white text-2xl font-bold">Chore Chart</h2>
        <p className="text-surface-muted text-sm mt-1">Who does what — check them off as they're done</p>
      </div>

      {/* Family members */}
      <div className="bg-surface-card border border-surface-border rounded-2xl p-4 space-y-3">
        <p className="text-xs text-surface-muted font-medium">👨‍👩‍👧‍👦 Family</p>
        <div className="flex gap-2 flex-wrap items-center">
          {members.map(m => (
            editMemberId === m.id ? (
              <span key={m.id} className="flex items-center gap-1.5 bg-surface border border-accent/50 rounded-full pl-1 pr-2 py-1">
                <EmojiPicker value={editMember.icon} onChange={v => setEditMember(f => ({ ...f, icon: v }))}
                  buttonClassName="w-8 h-7 bg-surface-card border border-surface-border rounded-full text-base hover:border-accent transition-all flex items-center justify-center" />
                <input autoFocus className="w-24 bg-surface-card border border-surface-border rounded-lg px-2 py-1 text-white text-sm focus:outline-none focus:border-accent"
                  value={editMember.name} onChange={e => setEditMember(f => ({ ...f, name: e.target.value }))}
                  onKeyDown={e => { if (e.key === 'Enter') saveMember(m.id); if (e.key === 'Escape') setEditMemberId(null) }} />
                <button onClick={() => saveMember(m.id)} className="text-green-400 hover:text-green-300"><Check size={14} /></button>
                <button onClick={() => setEditMemberId(null)} className="text-surface-muted hover:text-white"><X size={14} /></button>
              </span>
            ) : (
              <span key={m.id} className="group flex items-center gap-1.5 bg-surface border border-surface-border rounded-full pl-2 pr-2.5 py-1 text-sm text-white">
                <span className="text-base">{m.icon || '🙂'}</span> {m.name}
                <button onClick={() => { setEditMemberId(m.id); setEditMember({ name: m.name, icon: m.icon || '🙂' }) }}
                  className="opacity-0 group-hover:opacity-100 text-surface-muted hover:text-accent transition-all">
                  <Pencil size={11} />
                </button>
                <button onClick={() => removeMember(m)} className="opacity-0 group-hover:opacity-100 text-surface-muted hover:text-red-400 transition-all">
                  <X size={12} />
                </button>
              </span>
            )
          ))}
          <div className="flex items-center gap-1.5">
            <EmojiPicker value={newMemberIcon} onChange={setNewMemberIcon}
              buttonClassName="w-9 h-8 bg-surface border border-surface-border rounded-lg text-base hover:border-accent transition-all flex items-center justify-center" />
            <input className="w-28 bg-surface border border-surface-border rounded-lg px-2.5 py-1.5 text-white text-sm focus:outline-none focus:border-accent"
              placeholder="Add person" value={newMember} onChange={e => setNewMember(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && addMember()} />
            <button onClick={addMember} disabled={!newMember.trim()}
              className="p-1.5 rounded-lg bg-accent/15 hover:bg-accent/25 text-accent transition-all disabled:opacity-40">
              <UserPlus size={15} />
            </button>
          </div>
        </div>
      </div>

      <div className="bg-surface-card border border-surface-border rounded-2xl p-4 flex gap-3 flex-wrap">
        <EmojiPicker value={icon} onChange={setIcon} />
        <input className="flex-1 min-w-40 bg-surface border border-surface-border rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-accent"
          placeholder="Chore (e.g. Take out trash)" value={title} onChange={e => setTitle(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && add()} />
        <select className="w-36 bg-surface border border-surface-border rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-accent"
          value={person} onChange={e => setPerson(e.target.value)}>
          <option value="">Anyone</option>
          {members.map(m => <option key={m.id} value={m.name}>{m.icon || '🙂'} {m.name}</option>)}
        </select>
        <select className="bg-surface border border-surface-border rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-accent"
          value={frequency} onChange={e => setFrequency(e.target.value)}>
          <option value="daily">Daily</option>
          <option value="weekly">Weekly</option>
          <option value="monthly">Monthly</option>
          <option value="once">One-time</option>
        </select>
        {frequency === 'weekly' && (
          <select className="bg-surface border border-surface-border rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-accent"
            value={dayOfWeek} onChange={e => setDayOfWeek(e.target.value)}>
            <option value="">Any day</option>
            {DAYS.map((d, i) => <option key={d} value={i}>{d}</option>)}
          </select>
        )}
        <button onClick={add} disabled={adding || !title.trim()}
          className="flex items-center gap-2 bg-accent hover:bg-accent-hover text-white text-sm font-medium px-4 py-2 rounded-lg transition-all disabled:opacity-50">
          <Plus size={15} /> Add
        </button>
      </div>

      {byPerson.length === 0 && (
        <div className="text-center py-16 text-surface-muted">
          <ClipboardList size={40} className="mx-auto mb-3 opacity-40" />
          <p className="text-sm">Add your family members above, then give everyone their chores.</p>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {byPerson.map(([name, personChores], gi) => {
          const done = personChores.filter(c => c.done_this_period).length
          return (
            <motion.div key={name} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
              transition={{ delay: gi * 0.05 }}
              className="bg-surface-card border border-surface-border rounded-2xl p-4 space-y-3 shadow-card">
              <div className="flex items-center justify-between">
                <h3 className="text-white font-semibold flex items-center gap-2">
                  {memberIcon(name) && <span className="text-xl">{memberIcon(name)}</span>}
                  {name}
                </h3>
                <span className={cn('text-xs px-2 py-0.5 rounded-full',
                  personChores.length > 0 && done === personChores.length ? 'bg-green-500/15 text-green-400' : 'bg-white/5 text-surface-muted')}>
                  {personChores.length > 0 ? `${done}/${personChores.length} done` : 'no chores yet'}
                </span>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                {personChores.map(chore => (
                  <motion.div key={chore.id} layout className="relative group">
                    <button onClick={() => toggle(chore)}
                      title={chore.done_this_period ? 'Tap to undo' : 'Tap when done!'}
                      className={cn(
                        'w-full h-full rounded-2xl border-2 px-2 py-4 flex flex-col items-center gap-2 transition-all',
                        chore.done_this_period
                          ? 'bg-green-500/15 border-green-400'
                          : 'bg-surface border-surface-border hover:border-accent hover:scale-[1.03] active:scale-95'
                      )}>
                      <motion.span layout className="text-6xl leading-none select-none"
                        animate={chore.done_this_period ? { rotate: [0, -8, 8, 0], scale: [1, 1.2, 1] } : {}}
                        transition={{ duration: 0.4 }}>
                        {chore.done_this_period ? '✅' : (chore.icon || '🧹')}
                      </motion.span>
                      <span className={cn('text-sm font-bold text-center leading-tight',
                        chore.done_this_period ? 'text-green-300/80 line-through' : 'text-white')}>
                        {chore.title}
                      </span>
                      <span className="text-surface-muted text-[10px] text-center">
                        {FREQ_LABEL[chore.frequency]}
                        {chore.frequency === 'weekly' && chore.day_of_week != null && ` · ${DAYS[chore.day_of_week]}`}
                      </span>
                      {chore.done_this_period && chore.last_completed_by && (
                        <span className="text-green-300 text-[11px] font-medium">🌟 {chore.last_completed_by}</span>
                      )}
                    </button>
                    <button onClick={() => remove(chore.id)}
                      className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 text-surface-muted hover:text-red-400 transition-all">
                      <Trash2 size={14} />
                    </button>
                  </motion.div>
                ))}
              </div>
            </motion.div>
          )
        })}
      </div>
    </div>
  )
}
