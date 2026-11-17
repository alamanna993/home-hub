import { createContext, ReactNode, useCallback, useContext, useEffect, useRef, useState } from 'react'
import { useLocation } from 'react-router-dom'
import {
  chat, chatPhoto, clarifyChat, clearChatHistory, getChatHistory, undoChanges,
  type ChangeCard, type ChatBrain, type ChatContext, type ChatHistoryRow, type ChatOpen, type ChatPending, type RecipeCard,
} from '../lib/api'
import { utcDate } from '../lib/utils'

export interface EmeraldMessage {
  id: number
  role: 'user' | 'emerald'
  text: string
  ts: Date
  /** Which brain answered (Emerald messages from the server only) */
  brain?: ChatBrain | null
  /** Open location question with tap-to-answer options */
  pending?: ChatPending | null
  /** Recipes Emerald saved or found in this exchange, shown as cards */
  recipes?: RecipeCard[]
  /** What this request changed, with an Undo button */
  changes?: ChangeCard | null
  /** Places in the app Emerald suggests opening */
  open?: ChatOpen[]
  /** A photo the person sent */
  image?: string
  /** The option the user picked for `pending`, once answered */
  answered?: string
  error?: boolean
}

interface EmeraldChat {
  messages: EmeraldMessage[]
  loading: boolean
  send: (text: string) => Promise<void>
  /** Send a photo (camera or library) with an optional note */
  sendPhoto: (file: Blob, note?: string) => Promise<void>
  /** Answer a pending question from message `messageId` with one of its options */
  answer: (messageId: number, choice: string) => Promise<void>
  /** Reverse everything one reply changed */
  undo: (messageId: number) => Promise<void>
  /** Start a new conversation (the server forgets this one too) */
  reset: () => void
  // The panel, so any page or shortcut can open it
  panelOpen: boolean
  openPanel: (prefill?: string) => void
  closePanel: () => void
  /** Text to place in the composer the next time the panel opens */
  draft: string
  setDraft: (s: string) => void
}

export const EMERALD_GREETING =
  "Hi, I'm Emerald. Ask me where something is, what's for dinner, or what's on this week. Tell me what you bought, send a recipe link, or snap a photo of a recipe card or a receipt and I'll take care of it."

let nextId = 1
const greeting = (): EmeraldMessage => ({ id: nextId++, role: 'emerald', text: EMERALD_GREETING, ts: new Date() })

function fromHistory(r: ChatHistoryRow): EmeraldMessage {
  const m = r.meta ?? {}
  return {
    id: nextId++, role: r.role, text: r.text, ts: utcDate(r.created_at),
    brain: m.brain, changes: m.changes ?? undefined, open: m.open ?? undefined,
    recipes: m.recipes ?? (m.recipe ? [m.recipe] : undefined), image: m.image,
  }
}

/** Where the person is, so Emerald can resolve "this recipe" or "what's in here" */
function contextFor(pathname: string, search: string): ChatContext {
  const ctx: ChatContext = { path: pathname }
  const recipe = pathname.match(/^\/recipes\/(\d+)/)
  if (recipe) ctx.recipe_id = Number(recipe[1])
  const loc = new URLSearchParams(search).get('loc')
  if (loc && /^\d+$/.test(loc)) ctx.location_id = Number(loc)
  return ctx
}

const Ctx = createContext<EmeraldChat | null>(null)

/** One conversation for the whole app: the panel and the full Chat page share it, and the server keeps it. */
export function EmeraldChatProvider({ children }: { children: ReactNode }) {
  const [messages, setMessages] = useState<EmeraldMessage[]>(() => [greeting()])
  const [loading, setLoading] = useState(false)
  const [panelOpen, setPanelOpen] = useState(false)
  const [draft, setDraft] = useState('')
  const busy = useRef(false)
  const latest = useRef(messages)
  latest.current = messages
  const where = useLocation()
  const whereRef = useRef(where)
  whereRef.current = where

  // The conversation follows you across devices
  useEffect(() => {
    getChatHistory()
      .then(rows => { if (rows.length) setMessages([greeting(), ...rows.map(fromHistory)]) })
      .catch(() => {})
  }, [])

  const push = (m: Omit<EmeraldMessage, 'id' | 'ts'>) =>
    setMessages(list => [...list, { ...m, id: nextId++, ts: new Date() }])

  const run = useCallback(async (user: Pick<EmeraldMessage, 'text' | 'image'>, call: () => ReturnType<typeof chat>) => {
    if (busy.current) return
    busy.current = true
    push({ role: 'user', ...user })
    setLoading(true)
    try {
      const r = await call()
      push({
        role: 'emerald', text: r.reply, brain: r.brain, pending: r.pending, changes: r.changes,
        open: r.open ?? undefined, recipes: r.recipes ?? (r.recipe ? [r.recipe] : undefined),
      })
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
    const ctx = contextFor(whereRef.current.pathname, whereRef.current.search)
    await run({ text: msg }, () => chat(msg, ctx))
  }, [run])

  const sendPhoto = useCallback(async (file: Blob, note = '') => {
    await run({ text: note || 'Photo', image: URL.createObjectURL(file) }, () => chatPhoto(file, note))
  }, [run])

  const answer = useCallback(async (messageId: number, choice: string) => {
    const target = latest.current.find(m => m.id === messageId)
    if (!target?.pending || target.answered !== undefined || busy.current) return
    const pendingId = target.pending.id
    setMessages(list => list.map(m => (m.id === messageId ? { ...m, answered: choice } : m)))
    await run({ text: optionLabel(choice) }, () => clarifyChat(pendingId, choice))
  }, [run])

  const undo = useCallback(async (messageId: number) => {
    const target = latest.current.find(m => m.id === messageId)
    if (!target?.changes || target.changes.undone || busy.current) return
    busy.current = true
    setLoading(true)
    try {
      const r = await undoChanges(target.changes.id)
      setMessages(list => list.map(m => (m.id === messageId && m.changes ? { ...m, changes: { ...m.changes, undone: true } } : m)))
      push({ role: 'emerald', text: r.reply })
    } catch (e) {
      const detail = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail
      push({ role: 'emerald', text: detail || "I couldn't undo that.", error: true })
    } finally {
      busy.current = false
      setLoading(false)
    }
  }, [])

  const reset = useCallback(() => {
    setMessages([greeting()])
    clearChatHistory().catch(() => {})
  }, [])
  const openPanel = useCallback((prefill?: string) => {
    if (prefill !== undefined) setDraft(prefill)
    setPanelOpen(true)
  }, [])
  const closePanel = useCallback(() => setPanelOpen(false), [])

  return (
    <Ctx.Provider value={{ messages, loading, send, sendPhoto, answer, undo, reset, panelOpen, openPanel, closePanel, draft, setDraft }}>
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
