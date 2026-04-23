import { useState, useRef, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Send, Bot, User } from 'lucide-react'
import { chat } from '../lib/api'

interface Message { role: 'user' | 'bot'; text: string; ts: Date }

const SUGGESTIONS = [
  'where is my drill?',
  "do we have pasta?",
  "what's running low?",
  'show me groceries',
  'what food do we have?',
]

export default function Chat() {
  const [messages, setMessages] = useState<Message[]>([
    { role: 'bot', text: "👋 Hi! Ask me anything about your home inventory — where something is, what you have, or what's running low.", ts: new Date() }
  ])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [messages])

  async function send(text?: string) {
    const msg = (text || input).trim()
    if (!msg || loading) return
    setInput('')
    setMessages(m => [...m, { role: 'user', text: msg, ts: new Date() }])
    setLoading(true)
    try {
      const result = await chat(msg)
      setMessages(m => [...m, { role: 'bot', text: result.reply, ts: new Date() }])
    } catch {
      setMessages(m => [...m, { role: 'bot', text: '❌ Could not reach the backend. Is it running?', ts: new Date() }])
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex flex-col h-full p-6 gap-4 max-h-screen">
      <div>
        <h2 className="text-white text-2xl font-bold">Chat</h2>
        <p className="text-surface-muted text-sm mt-1">Ask your local AI about your home inventory</p>
      </div>

      {/* Suggestions */}
      <div className="flex gap-2 flex-wrap">
        {SUGGESTIONS.map(s => (
          <button key={s} onClick={() => send(s)}
            className="text-xs px-3 py-1.5 rounded-full border border-surface-border text-surface-muted hover:text-white hover:border-accent transition-all">
            {s}
          </button>
        ))}
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto space-y-4 min-h-0">
        <AnimatePresence initial={false}>
          {messages.map((msg, i) => (
            <motion.div key={i}
              initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
              className={`flex gap-3 ${msg.role === 'user' ? 'flex-row-reverse' : ''}`}
            >
              <div className={`w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0 ${
                msg.role === 'bot' ? 'bg-accent/20 text-accent' : 'bg-white/10 text-white'
              }`}>
                {msg.role === 'bot' ? <Bot size={16} /> : <User size={16} />}
              </div>
              <div className={`max-w-[75%] px-4 py-3 rounded-2xl text-sm leading-relaxed whitespace-pre-wrap ${
                msg.role === 'bot'
                  ? 'bg-surface-card border border-surface-border text-white'
                  : 'bg-accent text-white'
              }`}>
                {msg.text}
              </div>
            </motion.div>
          ))}
          {loading && (
            <motion.div key="loading" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex gap-3">
              <div className="w-8 h-8 rounded-xl bg-accent/20 flex items-center justify-center flex-shrink-0">
                <Bot size={16} className="text-accent" />
              </div>
              <div className="bg-surface-card border border-surface-border rounded-2xl px-4 py-3 flex gap-1.5 items-center">
                {[0, 1, 2].map(i => (
                  <div key={i} className="w-1.5 h-1.5 bg-accent rounded-full animate-bounce"
                    style={{ animationDelay: `${i * 0.15}s` }} />
                ))}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <div className="flex gap-3">
        <input
          className="flex-1 bg-surface-card border border-surface-border rounded-xl px-4 py-3 text-white text-sm focus:outline-none focus:border-accent placeholder-surface-muted"
          placeholder="Ask anything about your home inventory…"
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && send()}
        />
        <button onClick={() => send()} disabled={!input.trim() || loading}
          className="w-12 h-12 rounded-xl bg-accent hover:bg-accent-hover disabled:opacity-40 flex items-center justify-center transition-all shadow-glow">
          <Send size={16} className="text-white" />
        </button>
      </div>
    </div>
  )
}
