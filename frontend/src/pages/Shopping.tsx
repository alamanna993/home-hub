import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react'
import toast from 'react-hot-toast'
import { Check, ChevronDown, Plus, ShoppingCart, Sparkles, Trash2 } from 'lucide-react'
import {
  addShopping, checkShopping, deleteShopping, doneShopping, errorText, getItems, getShopping, getShoppingSuggestions,
  type ShoppingLine, type ShoppingSuggestion,
} from '../lib/api'
import { Button, Dialog, EmptyState, IconButton, Input, Page, PageHeader } from '../components/ui'
import { cn } from '../lib/utils'

const SOURCE_LABEL: Record<string, string> = { recipe: 'recipe', low_stock: 'running low', emerald: 'Emerald' }

export default function Shopping() {
  const [lines, setLines] = useState<ShoppingLine[] | null>(null)
  const [suggestions, setSuggestions] = useState<ShoppingSuggestion[]>([])
  const [names, setNames] = useState<string[]>([])
  const [text, setText] = useState('')
  const [adding, setAdding] = useState(false)
  const [doneOpen, setDoneOpen] = useState(false)
  const [cartOpen, setCartOpen] = useState(true)

  const load = useCallback(() => {
    Promise.all([getShopping(), getShoppingSuggestions().catch(() => [])])
      .then(([l, s]) => { setLines(l); setSuggestions(s) })
      .catch(e => toast.error(errorText(e, "The shopping list couldn't load")))
  }, [])

  useEffect(() => {
    load()
    getItems().then(items => setNames([...new Set(items.map(i => i.name))].sort())).catch(() => {})
    // The list is shared: pick up what the family adds from other phones
    const timer = setInterval(load, 20000)
    const onFocus = () => load()
    window.addEventListener('focus', onFocus)
    return () => { clearInterval(timer); window.removeEventListener('focus', onFocus) }
  }, [load])

  const toBuy = useMemo(() => (lines ?? []).filter(l => !l.checked), [lines])
  const inCart = useMemo(() => (lines ?? []).filter(l => l.checked), [lines])

  async function add(name: string, item_id?: number) {
    const clean = name.trim()
    if (!clean || adding) return
    setAdding(true)
    try {
      const row = await addShopping({ name: clean, item_id })
      if (row.already_on_list) toast(`${row.name} is already on the list`)
      setText('')
      load()
    } catch (e) { toast.error(errorText(e)) }
    finally { setAdding(false) }
  }

  async function toggle(l: ShoppingLine) {
    setLines(cur => cur && cur.map(x => (x.id === l.id ? { ...x, checked: !l.checked } : x)))  // instant, like a paper list
    try { await checkShopping(l.id, !l.checked) } catch (e) { toast.error(errorText(e)); load() }
  }

  async function remove(l: ShoppingLine) {
    setLines(cur => cur && cur.filter(x => x.id !== l.id))
    try { await deleteShopping(l.id) } catch (e) { toast.error(errorText(e)); load() }
  }

  function submit(e: FormEvent) { e.preventDefault(); add(text) }

  return (
    <Page className="max-w-2xl pb-4">
      <PageHeader
        title="Shopping list"
        description={lines ? (toBuy.length ? `${toBuy.length} to buy${inCart.length ? `, ${inCart.length} in the cart` : ''}` : 'Nothing to buy right now') : undefined}
        actions={inCart.length > 0 && <Button variant="primary" icon={Check} onClick={() => setDoneOpen(true)}>Done shopping</Button>}
      />

      {suggestions.length > 0 && (
        <section aria-labelledby="sug-h" className="mb-5">
          <h2 id="sug-h" className="mb-2 flex items-center gap-1.5 text-xs font-medium text-muted">
            <Sparkles size={14} aria-hidden className="text-honey" /> Running low
          </h2>
          <ul className="flex flex-wrap gap-2">
            {suggestions.map(s => (
              <li key={s.item_id}>
                <button
                  type="button"
                  onClick={() => add(s.name, s.item_id)}
                  className="flex h-11 items-center gap-1.5 rounded-full border border-honey/40 bg-honey/[0.09] pl-3 pr-3.5 text-sm font-medium text-ink active:bg-honey/20"
                >
                  <Plus size={16} aria-hidden className="text-honey" />{s.name}
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {lines && lines.length === 0 && (
        <EmptyState icon={ShoppingCart} title="The list is empty" description="Add what you need below, or tell Emerald: “put eggs and milk on the list”." />
      )}

      {toBuy.length > 0 && (
        <ul className="overflow-hidden rounded-panel border border-line bg-surface">
          {toBuy.map((l, i) => <Row key={l.id} line={l} first={i === 0} onToggle={toggle} onRemove={remove} />)}
        </ul>
      )}

      {inCart.length > 0 && (
        <section className="mt-6">
          <button
            type="button"
            onClick={() => setCartOpen(o => !o)}
            aria-expanded={cartOpen}
            className="mb-2 flex h-11 w-full items-center gap-2 text-left text-sm font-medium text-muted"
          >
            <ChevronDown size={16} aria-hidden className={cn('transition-transform', !cartOpen && '-rotate-90')} />
            In the cart · {inCart.length}
          </button>
          {cartOpen && (
            <ul className="overflow-hidden rounded-panel border border-line bg-surface">
              {inCart.map((l, i) => <Row key={l.id} line={l} first={i === 0} onToggle={toggle} onRemove={remove} />)}
            </ul>
          )}
        </section>
      )}

      {/* Pinned add box: thumb reach on a phone */}
      <form
        onSubmit={submit}
        className="sticky bottom-0 -mx-4 mt-6 flex gap-2 border-t border-line bg-canvas/95 px-4 py-3 backdrop-blur lg:-mx-8 lg:px-8"
      >
        <datalist id="shopping-names">{names.map(n => <option key={n} value={n} />)}</datalist>
        <Input
          list="shopping-names"
          value={text}
          onChange={e => setText(e.target.value)}
          placeholder="Add to the list…"
          aria-label="Add to the shopping list"
          autoComplete="off"
          enterKeyHint="done"
        />
        <Button type="submit" variant="primary" icon={Plus} loading={adding} disabled={!text.trim()}>Add</Button>
      </form>

      <DoneDialog open={doneOpen} onClose={() => setDoneOpen(false)} lines={inCart} onDone={() => { setDoneOpen(false); load() }} />
    </Page>
  )
}

function Row({ line, first, onToggle, onRemove }: {
  line: ShoppingLine; first: boolean; onToggle: (l: ShoppingLine) => void; onRemove: (l: ShoppingLine) => void
}) {
  const sub = [line.amount, line.note, SOURCE_LABEL[line.source]].filter(Boolean).join(' · ')
  return (
    <li className={cn('flex min-h-[56px] items-center gap-1 pl-1 pr-1', !first && 'border-t border-line')}>
      <button
        type="button"
        role="checkbox"
        aria-checked={line.checked}
        aria-label={`${line.name}, ${line.checked ? 'in the cart' : 'to buy'}`}
        onClick={() => onToggle(line)}
        className="flex h-12 w-12 shrink-0 items-center justify-center"
      >
        <span className={cn(
          'flex h-7 w-7 items-center justify-center rounded-full border-2 transition-colors',
          line.checked ? 'border-action bg-action text-action-on' : 'border-muted/60',
        )}>
          {line.checked && <Check size={16} strokeWidth={3} aria-hidden />}
        </span>
      </button>
      <div className="min-w-0 flex-1 py-2">
        <p className={cn('text-base text-ink', line.checked && 'text-muted line-through')}>{line.name}</p>
        {sub && <p className="truncate text-xs text-muted">{sub}</p>}
      </div>
      <IconButton icon={Trash2} label={`Remove ${line.name}`} onClick={() => onRemove(line)} />
    </li>
  )
}

function DoneDialog({ open, onClose, lines, onDone }: {
  open: boolean; onClose: () => void; lines: ShoppingLine[]; onDone: () => void
}) {
  const [skip, setSkip] = useState<Set<number>>(new Set())
  const [busy, setBusy] = useState(false)
  useEffect(() => { if (open) setSkip(new Set()) }, [open])

  async function confirm() {
    setBusy(true)
    try {
      const r = await doneShopping(lines.filter(l => !skip.has(l.id)).map(l => l.id))
      const parts = []
      if (r.restocked.length) parts.push(`restocked ${r.restocked.length}`)
      if (r.created.length) parts.push(`${r.created.length} new to put away`)
      toast.success(`Shopping done${parts.length ? ': ' + parts.join(', ') : ''}`)
      onDone()
    } catch (e) { toast.error(errorText(e)) }
    finally { setBusy(false) }
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Done shopping"
      description="Tick what to add to the inventory. New things go under “No location” until you put them away."
      footer={<>
        <Button onClick={onClose}>Not yet</Button>
        <Button variant="primary" loading={busy} onClick={confirm}>Clear the cart</Button>
      </>}
    >
      <ul className="divide-y divide-line">
        {lines.map(l => {
          const on = !skip.has(l.id)
          return (
            <li key={l.id}>
              <label className="flex min-h-12 cursor-pointer items-center gap-3 py-2">
                <input
                  type="checkbox"
                  checked={on}
                  onChange={() => setSkip(s => { const n = new Set(s); if (on) n.add(l.id); else n.delete(l.id); return n })}
                  className="h-5 w-5 accent-[rgb(var(--action))]"
                />
                <span className="flex-1 text-sm text-ink">{l.name}</span>
                <span className="text-xs text-muted">{on ? 'add to inventory' : 'just clear'}</span>
              </label>
            </li>
          )
        })}
      </ul>
    </Dialog>
  )
}
