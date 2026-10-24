import { useEffect } from 'react'
import { useSearchParams } from 'react-router-dom'
import { RotateCcw } from 'lucide-react'
import { Button } from '../components/ui'
import { EmeraldMark } from '../components/EmeraldMark'
import { EmeraldComposer, EmeraldConversation } from '../components/EmeraldPanel'
import { useEmeraldChat } from '../hooks/useEmeraldChat'
import { useBrainStatus } from '../hooks/useBrainStatus'

// Full-page Emerald conversation; shares its state with the slide-over panel.
export default function Chat() {
  const { send, reset, closePanel } = useEmeraldChat()
  const { summary } = useBrainStatus()
  const [searchParams, setSearchParams] = useSearchParams()

  useEffect(() => {
    closePanel()
    const prompt = searchParams.get('prompt')
    if (prompt) {
      setSearchParams({}, { replace: true })
      send(prompt)
    }
  }, [])

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center gap-3 border-b border-line bg-surface px-4 py-3 lg:px-8">
        <span className="flex h-9 w-9 items-center justify-center rounded-full bg-emerald/10 text-emerald">
          <EmeraldMark size={20} />
        </span>
        <div className="min-w-0 flex-1">
          <h1 className="text-base font-semibold text-ink">Emerald</h1>
          <p className="truncate text-ui text-muted">{summary ?? 'Your family assistant'}</p>
        </div>
        <Button size="sm" variant="ghost" icon={RotateCcw} onClick={reset}>New conversation</Button>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <EmeraldConversation className="mx-auto w-full max-w-3xl px-4 py-6 lg:px-8" />
      </div>
      <div className="border-t border-line bg-surface">
        <EmeraldComposer className="mx-auto w-full max-w-3xl px-4 lg:px-8" />
      </div>
    </div>
  )
}
