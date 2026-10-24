import { createContext, ReactNode, useCallback, useContext, useRef, useState } from 'react'
import { chat, clarifyChat, type ChatBrain, type ChatPending } from '../lib/api'

export interface EmeraldMessage {
  id: number
  role: 'user' | 'emerald'
  text: string
  ts: Date
  /** Which brain answered (Emerald messages from the server only) */
  brain?: ChatBrain | null
  /** Open location question with tap-to-answer options */
  pending?: ChatPending | null
  /** The option the user picked for `pending`, once answered */
  answered?: string
  error?: boolean
}

interface EmeraldChat {
  messages: EmeraldMessage[]
  loading: boolean
  send: (text: string) => Promise<void>
  /** Answer a pending question from message `messageId` with one of its options */
  answer: (messageId: number, choice: string) => Promise<void>
  reset: () => void
  // The slide-over panel, so any page or shortcut can open it
  panelOpen: boolean
  openPanel: (prefill?: string) => void
  closePanel: () => void
  /** Text to place in the composer the next time the panel opens */
  draft: string
  setDraft: (s: string) => void
}

export const EMERALD_GREETING =
  "Hi, I'm Emerald. Ask me where something is, what's running low, what's on this week, or tell me what you bought and I'll file it."

let nextId = 1
const greeting = (): EmeraldMessage => ({ id: nextId++, role: 'emerald', text: EMERALD_GREETING, ts: new Date() })

const Ctx = createContext<EmeraldChat | null>(null)

/** One conversation for the whole app: the panel and the full Chat page share it. */
export function EmeraldChatProvider({ children }: { children: ReactNode }) {
  const [messages, setMessages] = useState<EmeraldMessage[]>(() => [greeting()])
  const [loading, setLoading] = useState(false)
  const [panelOpen, setPanelOpen] = useState(false)
  const [draft, setDraft] = useState('')
  const busy = useRef(false)
  const latest = useRef(messages)
  latest.current = messages

  const push = (m: Omit<EmeraldMessage, 'id' | 'ts'>) =>
    setMessages(list => [...list, { ...m, id: nextId++, ts: new Date() }])

  const run = useCallback(async (userText: string, call: () => ReturnType<typeof chat>) => {
    if (busy.current) return
    busy.current = true
    push({ role: 'user', text: userText })
    setLoading(true)
    try {
      const r = await call()
      push({ role: 'emerald', text: r.reply, brain: r.brain, pending: r.pending })
    } catch {
      push({ role: 'emerald', text: "I couldn't reach HomeHub's server. Check that the backend is running, then try again.", error: true })
    } finally {
      busy.current = false
      setLoading(false)
    }
  }, [])

  const send = useCallback(async (text: string) => {
    const msg = text.trim()
    if (!msg) return
    await run(msg, () => chat(msg))
  }, [run])

  const answer = useCallback(async (messageId: number, choice: string) => {
    const target = latest.current.find(m => m.id === messageId)
    if (!target?.pending || target.answered || busy.current) return
    const pendingId = target.pending.id
    setMessages(list => list.map(m => (m.id === messageId ? { ...m, answered: choice } : m)))
    await run(optionLabel(choice), () => clarifyChat(pendingId, choice))
  }, [run])

  const reset = useCallback(() => setMessages([greeting()]), [])
  const openPanel = useCallback((prefill?: string) => {
    if (prefill !== undefined) setDraft(prefill)
    setPanelOpen(true)
  }, [])
  const closePanel = useCallback(() => setPanelOpen(false), [])

  return (
    <Ctx.Provider value={{ messages, loading, send, answer, reset, panelOpen, openPanel, closePanel, draft, setDraft }}>
      {children}
    </Ctx.Provider>
  )
}

export function useEmeraldChat() {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error('useEmeraldChat must be inside EmeraldChatProvider')
  return ctx
}

/** Server options carry a leading emoji ("✅ Yes — file them"); show the words only. */
export function optionLabel(option: string) {
  return option.replace(/^[^\p{L}\p{N}]+/u, '').trim() || option
}

/** "Answered by Codex", "Answered by hermes3 (backup)" */
export function answeredBy(brain?: ChatBrain | null) {
  if (!brain) return undefined
  const name = brain.label || brain.model?.split(':')[0] || brain.provider
  return `Answered by ${name}${brain.fallback ? ' (backup)' : ''}`
}
