import { forwardRef, FormEvent, KeyboardEvent, ReactNode, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { AlertCircle, ArrowUp, Camera, Check, ChevronRight, Maximize2, Mic, RotateCcw, Undo2 } from 'lucide-react'
import { Button, IconButton, SlideOver } from './ui'
import { EmeraldMark } from './EmeraldMark'
import { answeredBy, optionLabel, useEmeraldChat, type EmeraldMessage } from '../hooks/useEmeraldChat'
import { useBrainStatus } from '../hooks/useBrainStatus'
import { downscale } from './PhotoPicker'
import { mediaUrl } from '../lib/api'
import { cn } from '../lib/utils'

const SUGGESTIONS = [
  "What's for dinner tonight?",
  "What's running low?",
  'Put milk on the shopping list',
  "What's on the calendar this week?",
]

/** Emerald: a bottom sheet on phones, a side panel on tablets and desktops. Open it from the tab bar, ⌘K / Ctrl+K or "/". */
export default function EmeraldPanel() {
  const { panelOpen, openPanel, closePanel, reset } = useEmeraldChat()
  const { summary } = useBrainStatus()
  const navigate = useNavigate()
  const composer = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    function onKey(e: globalThis.KeyboardEvent) {
      const t = e.target as HTMLElement
      const typing = t.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName)
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        if (panelOpen) composer.current?.focus()
        else openPanel()
      } else if (e.key === '/' && !typing && !e.metaKey && !e.ctrlKey && !e.altKey && !panelOpen) {
        e.preventDefault()
        openPanel()
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [panelOpen, openPanel])

  return (
    <SlideOver
      open={panelOpen}
      onClose={closePanel}
      title="Emerald"
      description={summary ?? 'Your family assistant'}
      icon={<span className="flex h-9 w-9 items-center justify-center rounded-full bg-emerald/10 text-emerald"><EmeraldMark size={20} /></span>}
      headerActions={<>
        <IconButton icon={RotateCcw} label="New conversation" onClick={reset} />
        <IconButton icon={Maximize2} label="Open full page" onClick={() => { closePanel(); navigate('/chat') }} className="max-md:hidden" />
      </>}
      initialFocus={composer}
      bodyClassName="flex flex-col"
      footer={<EmeraldComposer ref={composer} />}
    >
      <EmeraldConversation />
    </SlideOver>
  )
}

/** Message log with suggestions, change cards, recipe cards and "Answered by …" lines.
 *  Shared by the panel and the full-page chat. */
export function EmeraldConversation({ className }: { className?: string }) {
  const { messages, loading, send, answer, undo } = useEmeraldChat()
  const end = useRef<HTMLDivElement>(null)

  useLayoutEffect(() => {
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    end.current?.scrollIntoView({ block: 'end', behavior: reduce ? 'auto' : 'smooth' })
  }, [messages.length, loading])

  return (
    <div className={cn('flex-1 space-y-5 px-4 py-4', className)}>
      <div className="space-y-5" aria-live="polite" aria-relevant="additions">
        {messages.map(m => <MessageRow key={m.id} m={m} onAnswer={answer} onUndo={undo} disabled={loading} />)}
      </div>

      {messages.length === 1 && !loading && (
        <div className="pl-10">
          <p className="mb-2 text-xs font-medium text-muted">Try asking</p>
          <div className="flex flex-wrap gap-2">
            {SUGGESTIONS.map(s => (
              <Button key={s} size="sm" variant="secondary" onClick={() => send(s)}>{s}</Button>
            ))}
          </div>
        </div>
      )}

      {loading && (
        <div className="flex items-center gap-3" role="status">
          <Avatar />
          <span className="flex items-center gap-1" aria-label="Emerald is thinking">
            {[0, 1, 2].map(i => (
              <span key={i} className="h-2 w-2 animate-pulse rounded-full bg-emerald" style={{ animationDelay: `${i * 0.2}s` }} />
            ))}
          </span>
        </div>
      )}
      <div ref={end} />
    </div>
  )
}

function Avatar() {
  return (
    <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-emerald/10 text-emerald">
      <EmeraldMark size={16} />
    </span>
  )
}

function RecipeCards({ recipes }: { recipes: NonNullable<EmeraldMessage['recipes']> }) {
  const navigate = useNavigate()
  const { closePanel } = useEmeraldChat()
  return (
    <div className="mt-3 space-y-2">
      {recipes.map(r => (
        <button
          key={r.id}
          type="button"
          onClick={() => { closePanel(); navigate(`/recipes/${r.id}`) }}
          className="flex w-full items-center gap-3 overflow-hidden rounded-panel border border-line bg-canvas text-left active:bg-ink/[0.05]"
        >
          {r.image_url
            ? <img src={mediaUrl(r.image_url, true)} alt="" className="h-16 w-20 shrink-0 object-cover" />
            : <span className="flex h-16 w-20 shrink-0 items-center justify-center bg-ink/[0.05] text-xl" aria-hidden>🍽️</span>}
          <span className="min-w-0 flex-1 py-2">
            <span className="line-clamp-2 text-sm font-medium text-ink">{r.title}</span>
            <span className="text-xs text-muted">Open recipe</span>
          </span>
          <ChevronRight size={18} aria-hidden className="mr-3 shrink-0 text-muted" />
        </button>
      ))}
    </div>
  )
}

/** "Changed X" lines with an Undo that stays available for a day */
function ChangeCard({ m, onUndo, disabled }: { m: EmeraldMessage; onUndo: (id: number) => void; disabled: boolean }) {
  const c = m.changes
  if (!c) return null
  return (
    <div className="mt-3 rounded-panel border border-line bg-canvas p-3">
      <ul className="space-y-1 text-sm text-ink">
        {c.lines.map((l, i) => (
          <li key={i} className={cn('flex gap-2', c.undone && 'text-muted line-through')}>
            <Check size={16} aria-hidden className="mt-1 shrink-0 text-emerald" />
            <span>{l}</span>
          </li>
        ))}
        {c.more > 0 && <li className="pl-6 text-xs text-muted">and {c.more} more</li>}
      </ul>
      <div className="mt-2">
        {c.undone
          ? <span className="text-xs text-muted">Undone</span>
          : <Button size="sm" icon={Undo2} disabled={disabled} onClick={() => onUndo(m.id)}>Undo</Button>}
      </div>
    </div>
  )
}

function OpenLinks({ open }: { open: NonNullable<EmeraldMessage['open']> }) {
  const navigate = useNavigate()
  const { closePanel } = useEmeraldChat()
  return (
    <div className="mt-3 flex flex-wrap gap-2">
      {open.map(o => (
        <Button key={o.path} size="sm" variant="secondary" onClick={() => { closePanel(); navigate(o.path) }}>{o.label}</Button>
      ))}
    </div>
  )
}

function MessageRow({ m, onAnswer, onUndo, disabled }: {
  m: EmeraldMessage; onAnswer: (id: number, choice: string) => void; onUndo: (id: number) => void; disabled: boolean
}) {
  if (m.role === 'user') {
    return (
      <div className="flex justify-end">
        <div className="ml-10 max-w-full rounded-panel bg-action/[0.12] px-3.5 py-2.5 text-sm text-ink">
          {m.image && <img src={mediaUrl(m.image)} alt="Photo you sent" className="mb-2 max-h-56 rounded-control object-cover" />}
          {(m.text && !(m.image && m.text === 'Photo')) && <p className="whitespace-pre-wrap break-words">{m.text}</p>}
        </div>
      </div>
    )
  }
  const by = answeredBy(m.brain)
  return (
    <div className="flex gap-3">
      <Avatar />
      <div className="min-w-0 flex-1 pt-0.5">
        <p className={cn('whitespace-pre-wrap break-words text-sm leading-relaxed text-ink', m.error && 'flex gap-1.5')}>
          {m.error && <AlertCircle size={16} aria-hidden className="mt-0.5 shrink-0 text-danger" />}
          <span>{renderInline(m.text)}</span>
        </p>

        {m.pending && m.pending.options.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-2" role="group" aria-label={m.answered !== undefined ? 'Answered' : 'Choose an answer'}>
            {m.pending.options.map(opt => {
              const chosen = m.answered === opt
              return (
                <Button
                  key={opt}
                  size="sm"
                  variant="secondary"
                  icon={chosen ? Check : undefined}
                  disabled={m.answered !== undefined || disabled}
                  onClick={() => onAnswer(m.id, opt)}
                  className={cn(chosen && 'border-action/50 text-action !opacity-100')}
                >
                  {optionLabel(opt)}
                </Button>
              )
            })}
          </div>
        )}

        {m.recipes && m.recipes.length > 0 && <RecipeCards recipes={m.recipes} />}
        <ChangeCard m={m} onUndo={onUndo} disabled={disabled} />
        {m.open && m.open.length > 0 && <OpenLinks open={m.open} />}

        {by && <p className="mt-2 text-xs text-muted">{by}</p>}
      </div>
    </div>
  )
}

/** Replies use **bold** for item and place names */
function renderInline(text: string): ReactNode[] {
  return text.split(/\*\*(.+?)\*\*/g).map((part, i) => (i % 2 ? <strong key={i} className="font-semibold">{part}</strong> : part))
}

// Browser speech recognition only works on https or localhost; elsewhere the keyboard's own dictation key does the job
type SpeechCtor = new () => {
  lang: string; interimResults: boolean; continuous: boolean
  onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null
  onend: (() => void) | null; onerror: (() => void) | null
  start: () => void; stop: () => void
}
const Speech: SpeechCtor | undefined = typeof window !== 'undefined' && window.isSecureContext
  ? ((window as unknown as { SpeechRecognition?: SpeechCtor; webkitSpeechRecognition?: SpeechCtor }).SpeechRecognition
    ?? (window as unknown as { webkitSpeechRecognition?: SpeechCtor }).webkitSpeechRecognition)
  : undefined

export const EmeraldComposer = forwardRef<HTMLTextAreaElement, { className?: string }>(function EmeraldComposer({ className }, ref) {
  const { send, sendPhoto, loading, draft, setDraft } = useEmeraldChat()
  const local = useRef<HTMLTextAreaElement | null>(null)
  const cam = useRef<HTMLInputElement>(null)
  const [listening, setListening] = useState(false)
  const rec = useRef<InstanceType<SpeechCtor> | null>(null)

  // Grow with the text, up to ~6 lines
  useLayoutEffect(() => {
    const el = local.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = Math.min(el.scrollHeight + 2, 146) + 'px'
  }, [draft])

  function submit(e?: FormEvent) {
    e?.preventDefault()
    if (!draft.trim() || loading) return
    const text = draft
    setDraft('')
    send(text)
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    // Enter sends on a keyboard; on a touch screen it is a new line (the Send button sends)
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing && window.matchMedia('(pointer: fine)').matches) submit(e)
  }

  async function photo(file?: File) {
    if (!file || loading) return
    await sendPhoto(await downscale(file), draft.trim())
    setDraft('')
  }

  function toggleMic() {
    if (!Speech) return
    if (listening) { rec.current?.stop(); return }
    const r = new Speech()
    r.lang = navigator.language || 'en-US'
    r.interimResults = false
    r.continuous = false
    r.onresult = e => {
      const said = Array.from(e.results).map(x => x[0].transcript).join(' ').trim()
      if (said) setDraft(draft ? `${draft} ${said}` : said)
    }
    r.onend = () => setListening(false)
    r.onerror = () => setListening(false)
    rec.current = r
    setListening(true)
    r.start()
  }

  return (
    <form onSubmit={submit} className={cn('flex items-end gap-2 p-3', className)}>
      <label htmlFor="emerald-composer" className="sr-only">Message Emerald</label>
      <IconButton icon={Camera} label="Send a photo" variant="secondary" onClick={() => cam.current?.click()} disabled={loading} />
      <input ref={cam} type="file" accept="image/*" hidden onChange={e => { photo(e.target.files?.[0]); e.target.value = '' }} />
      <textarea
        id="emerald-composer"
        ref={el => {
          local.current = el
          if (typeof ref === 'function') ref(el)
          else if (ref) ref.current = el
        }}
        rows={1}
        value={draft}
        onChange={e => setDraft(e.target.value)}
        onKeyDown={onKeyDown}
        placeholder={Speech ? 'Ask Emerald or tell it what changed…' : 'Type, or use your keyboard’s mic…'}
        className={cn(
          'min-h-11 flex-1 resize-none rounded-control border border-line bg-canvas px-3 py-2.5 text-sm leading-6 text-ink placeholder:text-muted/80',
          'focus:border-emerald focus:outline-none focus:ring-2 focus:ring-emerald/25 focus-visible:outline-none',
        )}
      />
      {Speech && (
        <IconButton
          icon={Mic}
          label={listening ? 'Stop listening' : 'Speak'}
          variant="secondary"
          onClick={toggleMic}
          aria-pressed={listening}
          className={cn(listening && '!border-emerald !text-emerald animate-pulse')}
        />
      )}
      <button
        type="submit"
        disabled={!draft.trim() || loading}
        aria-label="Send"
        title="Send"
        className="flex h-11 w-11 shrink-0 items-center justify-center rounded-control bg-emerald text-emerald-on transition-opacity hover:opacity-90 disabled:opacity-40"
      >
        <ArrowUp size={20} aria-hidden />
      </button>
    </form>
  )
})
