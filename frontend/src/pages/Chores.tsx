import { useEffect, useMemo, useState } from 'react'
import { motion } from 'framer-motion'
import { CheckCircle2, Circle, ClipboardList, Plus, Trash2 } from 'lucide-react'
import toast from 'react-hot-toast'
import { getChores, createChore, completeChore, uncompleteChore, deleteChore, Chore } from '../lib/api'
import { cn } from '../lib/utils'

const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']
const FREQ_LABEL: Record<string, string> = { once: 'One-time', daily: 'Daily', weekly: 'Weekly', monthly: 'Monthly' }

export default function Chores() {
  const [chores, setChores] = useState<Chore[]>([])
  const [title, setTitle] = useState('')
  const [person, setPerson] = useState('')
  const [frequency, setFrequency] = useState('weekly')
  const [dayOfWeek, setDayOfWeek] = useState<string>('')
  const [adding, setAdding] = useState(false)

  const load = () => getChores().then(setChores)
  useEffect(() => { load() }, [])

  async function add() {
    if (!title.trim()) return
    setAdding(true)
    try {
      await createChore({
        title: title.trim(),
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
    setChores(cs => cs.map(c => c.id === updated.id ? updated : c))
  }

  async function remove(id: number) {
    await deleteChore(id)
    toast.success('Chore removed'); load()
  }

  const byPerson = useMemo(() => {
    const map: Record<string, Chore[]> = {}
    for (const c of chores) (map[c.assigned_to || 'Anyone'] ||= []).push(c)
    return Object.entries(map).sort(([a], [b]) => a.localeCompare(b))
  }, [chores])

  return (
    <div className="p-6 space-y-5">
      <div>
        <h2 className="text-white text-2xl font-bold">Chore Chart</h2>
        <p className="text-surface-muted text-sm mt-1">Who does what — check them off as they're done</p>
      </div>

      <div className="bg-surface-card border border-surface-border rounded-2xl p-4 flex gap-3 flex-wrap">
        <input className="flex-1 min-w-40 bg-surface border border-surface-border rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-accent"
          placeholder="Chore (e.g. Take out trash)" value={title} onChange={e => setTitle(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && add()} />
        <input className="w-36 bg-surface border border-surface-border rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-accent"
          placeholder="Assigned to" value={person} onChange={e => setPerson(e.target.value)} />
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
          <p className="text-sm">No chores yet. Add the first one above.</p>
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
                <h3 className="text-white font-semibold">{name}</h3>
                <span className={cn('text-xs px-2 py-0.5 rounded-full',
                  done === personChores.length ? 'bg-green-500/15 text-green-400' : 'bg-white/5 text-surface-muted')}>
                  {done}/{personChores.length} done
                </span>
              </div>
              <div className="space-y-1.5">
                {personChores.map(chore => (
                  <div key={chore.id}
                    className={cn('flex items-center gap-3 rounded-lg px-3 py-2 group transition-all',
                      chore.done_this_period ? 'bg-green-500/5' : 'bg-surface')}>
                    <button onClick={() => toggle(chore)} className="flex-shrink-0">
                      {chore.done_this_period
                        ? <CheckCircle2 size={19} className="text-green-400" />
                        : <Circle size={19} className="text-surface-muted hover:text-accent transition-colors" />}
                    </button>
                    <div className="flex-1 min-w-0">
                      <p className={cn('text-sm', chore.done_this_period ? 'text-surface-muted line-through' : 'text-white')}>
                        {chore.title}
                      </p>
                      <p className="text-surface-muted text-[11px]">
                        {FREQ_LABEL[chore.frequency]}
                        {chore.frequency === 'weekly' && chore.day_of_week != null && ` · ${DAYS[chore.day_of_week]}`}
                        {chore.last_completed_at && ` · last done ${new Date(chore.last_completed_at).toLocaleDateString()}`}
                      </p>
                    </div>
                    <button onClick={() => remove(chore.id)}
                      className="opacity-0 group-hover:opacity-100 text-surface-muted hover:text-red-400 transition-all flex-shrink-0">
                      <Trash2 size={14} />
                    </button>
                  </div>
                ))}
              </div>
            </motion.div>
          )
        })}
      </div>
    </div>
  )
}
