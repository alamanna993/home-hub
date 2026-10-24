import { forwardRef, FormEvent, KeyboardEvent, ReactNode, useEffect, useLayoutEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { AlertCircle, ArrowUp, Check, Maximize2, RotateCcw } from 'lucide-react'
import { Button, IconButton, SlideOver } from './ui'
import { EmeraldMark } from './EmeraldMark'
import { answeredBy, optionLabel, useEmeraldChat, type EmeraldMessage } from '../hooks/useEmeraldChat'
import { useBrainStatus } from '../hooks/useBrainStatus'
import { cn } from '../lib/utils'

const SUGGESTIONS = [
  "What's running low?",
  'What can I make for dinner tonight?',
  'Where is the drill?',
  "What's on the calendar this week?",
]

/** The Emerald slide-over, available on every page via the top bar, ⌘K / Ctrl+K or "/". */
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
      icon={<span className="flex h-8 w-8 items-center justify-center rounded-full bg-emerald/10 text-emerald"><EmeraldMark size={18} /></span>}
      headerActions={<>
        <IconButton icon={RotateCcw} label="New conversation" onClick={reset} />
        <IconButton icon={Maximize2} label="Open full page" onClick={() => { closePanel(); navigate('/chat') }} />
      </>}
      initialFocus={composer}
      bodyClassName="flex flex-col"
      footer={<EmeraldComposer ref={composer} />}
    >
      <EmeraldConversation />
    </SlideOver>
  )
}

/** Message log with suggestions, pending-location buttons and "Answered by …" lines.
 *  Shared by the panel and (later) the full-page chat. */
export function EmeraldConversation({ className }: { className?: string }) {
  const { messages, loading, send, answer } = useEmeraldChat()
  const end = useRef<HTMLDivElement>(null)

  useLayoutEffect(() => {
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    end.current?.scrollIntoView({ block: 'end', behavior: reduce ? 'auto' : 'smooth' })
  }, [messages.length, loading])

  return (
    <div className={cn('flex-1 space-y-5 px-4 py-4', className)}>
      <div className="space-y-5" aria-live="polite" aria-relevant="additions">
        {messages.map(m => <MessageRow key={m.id} m={m} onAnswer={answer} disabled={loading} />)}
      </div>

      {messages.length === 1 && !loading && (
        <div className="pl-9">
          <p className="mb-2 text-xs font-medium text-muted">Try asking</p>
          <div className="flex flex-wrap gap-1.5">
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
              <span key={i} className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald" style={{ animationDelay: `${i * 0.2}s` }} />
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
    <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-emerald/10 text-emerald">
      <EmeraldMark size={14} />
    </span>
  )
}

function MessageRow({ m, onAnswer, disabled }: { m: EmeraldMessage; onAnswer: (id: number, choice: string) => void; disabled: boolean }) {
  if (m.role === 'user') {
    return (
      <div className="flex justify-end">
        <p className="ml-10 whitespace-pre-wrap break-words rounded-panel bg-action/[0.09] px-3 py-2 text-sm text-ink">{m.text}</p>
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
          <div className="mt-2.5 flex flex-wrap gap-1.5" role="group" aria-label={m.answered ? 'Answered' : 'Choose an answer'}>
            {m.pending.options.map(opt => {
              const chosen = m.answered === opt
              return (
                <Button
                  key={opt}
                  size="sm"
                  variant="secondary"
                  icon={chosen ? Check : undefined}
                  disabled={!!m.answered || disabled}
                  onClick={() => onAnswer(m.id, opt)}
                  className={cn(chosen && 'border-action/50 text-action !opacity-100')}
                >
                  {optionLabel(opt)}
                </Button>
              )
            })}
          </div>
        )}

        {by && <p className="mt-1.5 text-xs text-muted">{by}</p>}
      </div>
    </div>
  )
}

/** Replies use **bold** for item and place names */
function renderInline(text: string): ReactNode[] {
  return text.split(/\*\*(.+?)\*\*/g).map((part, i) => (i % 2 ? <strong key={i} className="font-semibold">{part}</strong> : part))
}

export const EmeraldComposer = forwardRef<HTMLTextAreaElement, { className?: string }>(function EmeraldComposer({ className }, ref) {
  const { send, loading, draft, setDraft } = useEmeraldChat()
  const local = useRef<HTMLTextAreaElement | null>(null)

  // Grow with the text, up to ~6 lines
  useLayoutEffect(() => {
    const el = local.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = Math.min(el.scrollHeight, 144) + 'px'
  }, [draft])

  function submit(e?: FormEvent) {
    e?.preventDefault()
    if (!draft.trim() || loading) return
    const text = draft
    setDraft('')
    send(text)
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) submit(e)
  }

  return (
    <form onSubmit={submit} className={cn('flex items-end gap-2 p-3', className)}>
      <label htmlFor="emerald-composer" className="sr-only">Message Emerald</label>
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
        placeholder="Ask Emerald or tell it what changed…"
        className={cn(
          'min-h-10 flex-1 resize-none rounded-control border border-line bg-canvas px-3 py-2 text-sm leading-5 text-ink placeholder:text-muted/80',
          'focus:border-emerald focus:outline-none focus:ring-2 focus:ring-emerald/25 focus-visible:outline-none',
        )}
      />
      <button
        type="submit"
        disabled={!draft.trim() || loading}
        aria-label="Send"
        title="Send (Enter)"
        className="flex h-10 w-10 shrink-0 items-center justify-center rounded-control bg-emerald text-emerald-on transition-opacity hover:opacity-90 disabled:opacity-40"
      >
        <ArrowUp size={18} aria-hidden />
      </button>
    </form>
  )
})
