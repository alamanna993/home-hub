import { useLocation } from 'react-router-dom'
import { ChevronRight } from 'lucide-react'
import { Kbd, modKey } from './ui'
import { crumbsFor } from './nav'
import { EmeraldMark } from './EmeraldMark'
import { useEmeraldChat } from '../hooks/useEmeraldChat'
import ThemeToggle from './ThemeToggle'
import UserMenu from './UserMenu'

/** Desktop header: where you are, the Ask Emerald bar, theme, account. */
export default function TopBar() {
  const { pathname } = useLocation()
  const { group, label } = crumbsFor(pathname)
  const { openPanel } = useEmeraldChat()

  return (
    <header className="hidden h-14 shrink-0 items-center gap-3 border-b border-line bg-surface px-6 lg:flex">
      <nav aria-label="Breadcrumb" className="min-w-0 flex-1">
        <ol className="flex items-center gap-1.5 text-sm">
          {group && <>
            <li className="text-muted">{group}</li>
            <li aria-hidden className="text-muted/70"><ChevronRight size={14} /></li>
          </>}
          <li aria-current="page" className="truncate font-medium text-ink">{label}</li>
        </ol>
      </nav>

      <button
        type="button"
        onClick={() => openPanel()}
        aria-keyshortcuts="Meta+K Control+K /"
        className="flex h-9 w-64 items-center gap-2 rounded-control border border-line bg-canvas px-2.5 text-sm text-muted transition-colors hover:border-emerald/50 hover:text-ink xl:w-80"
      >
        <EmeraldMark size={16} className="text-emerald" />
        <span className="flex-1 text-left">Ask Emerald…</span>
        <span className="flex gap-0.5"><Kbd>{modKey}</Kbd><Kbd>K</Kbd></span>
      </button>

      <div className="flex items-center gap-1">
        <ThemeToggle />
        <UserMenu />
      </div>
    </header>
  )
}
