import { NavLink, useLocation } from 'react-router-dom'
import { Home, CookingPot, CalendarDays, Menu as MoreIcon, type LucideIcon } from 'lucide-react'
import { cn } from '../lib/utils'
import { tabFor, type TabId } from './nav'
import { EmeraldMark } from './EmeraldMark'
import { useEmeraldChat } from '../hooks/useEmeraldChat'

interface Tab { id: TabId; to: string; label: string; icon: LucideIcon }

const LEFT: Tab[] = [
  { id: 'today', to: '/', label: 'Today', icon: Home },
  { id: 'kitchen', to: '/shopping', label: 'Kitchen', icon: CookingPot },
]
const RIGHT: Tab[] = [
  { id: 'plan', to: '/calendar', label: 'Plan', icon: CalendarDays },
  { id: 'more', to: '/more', label: 'More', icon: MoreIcon },
]

/** Phone navigation: Today · Kitchen · Emerald · Plan · More. Hidden from tablet width up. */
export default function BottomTabs() {
  const { pathname } = useLocation()
  const current = tabFor(pathname)
  const { openPanel, panelOpen } = useEmeraldChat()

  const tab = (t: Tab) => (
    <NavLink
      key={t.id}
      to={t.to}
      aria-current={current === t.id ? 'page' : undefined}
      className={cn(
        'flex h-full flex-1 flex-col items-center justify-center gap-0.5 text-xs font-medium transition-colors',
        current === t.id ? 'text-action' : 'text-muted',
      )}
    >
      <span className={cn('flex h-8 w-14 items-center justify-center rounded-full transition-colors', current === t.id && 'bg-action/[0.12]')}>
        <t.icon size={22} aria-hidden strokeWidth={current === t.id ? 2.25 : 1.75} />
      </span>
      {t.label}
    </NavLink>
  )

  return (
    <nav
      aria-label="Main"
      className="relative z-30 box-content flex h-16 shrink-0 items-stretch border-t border-line bg-surface pb-[env(safe-area-inset-bottom)] md:hidden"
    >
      {LEFT.map(tab)}
      <div className="flex flex-1 flex-col items-center">
        <button
          type="button"
          onClick={() => openPanel()}
          aria-label="Ask Emerald"
          aria-expanded={panelOpen}
          className="-mt-5 flex h-14 w-14 items-center justify-center rounded-full bg-emerald text-emerald-on ring-4 ring-surface transition-transform active:scale-95"
        >
          <EmeraldMark size={28} />
        </button>
        <span aria-hidden className="mt-0.5 text-xs font-medium text-emerald">Emerald</span>
      </div>
      {RIGHT.map(tab)}
    </nav>
  )
}
