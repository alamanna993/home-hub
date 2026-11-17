import { NavLink } from 'react-router-dom'
import { Settings, type LucideIcon } from 'lucide-react'
import { cn } from '../lib/utils'
import { useAuth } from '../hooks/useAuth'
import { useBrainStatus, type BrainState } from '../hooks/useBrainStatus'
import { useEmeraldChat } from '../hooks/useEmeraldChat'
import { DISPLAY_ITEM, NAV_GROUPS } from './nav'
import { EmeraldMark, HomeHubMark } from './EmeraldMark'

/** Tablet and desktop navigation: an icon rail from tablet width, full width from xl.
 *  Phones use the bottom tab bar instead. */
export default function Sidebar() {
  const { isAdmin } = useAuth()
  // Classes that only apply in the tablet rail
  const railHide = 'md:max-xl:hidden'

  return (
    <aside
      aria-label="Main"
      className="flex h-full w-64 flex-col overflow-y-auto border-r border-line bg-surface pb-[env(safe-area-inset-bottom)] md:max-xl:w-[68px]"
    >
      <div className="flex h-14 shrink-0 items-center gap-2.5 px-4 md:max-xl:justify-center md:max-xl:px-0">
        <HomeHubMark size={28} />
        <span className={cn('text-lg font-semibold text-ink', railHide)}>HomeHub</span>
      </div>

      <nav className="flex-1 px-3 pb-3">
        {NAV_GROUPS.map((group, gi) => (
          <div key={group.id} className={gi > 0 ? 'mt-4' : 'mt-1'}>
            {group.label && (
              <>
                <h2 className={cn('px-2.5 pb-1 text-xs font-medium text-muted', railHide)}>{group.label}</h2>
                <div className="mx-2 mb-2 hidden h-px bg-line md:max-xl:block" aria-hidden />
              </>
            )}
            <ul className="space-y-0.5">
              {group.items.map(item => (
                <li key={item.to}>
                  <SideLink {...item} railHide={railHide} />
                </li>
              ))}
            </ul>
          </div>
        ))}
      </nav>

      <div className="space-y-0.5 border-t border-line px-3 py-3">
        <EmeraldRow railHide={railHide} />
        <SideLink {...DISPLAY_ITEM} railHide={railHide} />
        {isAdmin && <SideLink to="/settings" label="Settings" icon={Settings} railHide={railHide} />}
      </div>
    </aside>
  )
}

function SideLink({ to, label, icon: Icon, railHide }: {
  to: string; label: string; icon: LucideIcon; railHide: string
}) {
  return (
    <NavLink
      to={to}
      end={to === '/'}
      title={label}
      className={({ isActive }) => cn(
        'relative flex h-11 items-center gap-3 rounded-control px-3 text-sm font-medium transition-colors duration-100 md:max-xl:justify-center md:max-xl:px-0',
        isActive
          ? 'bg-action/[0.11] text-ink before:absolute before:inset-y-2.5 before:left-0 before:w-[3px] before:rounded-full before:bg-action'
          : 'text-muted hover:bg-ink/[0.05] hover:text-ink',
      )}
    >
      {({ isActive }) => <>
        <Icon size={20} aria-hidden className={isActive ? 'text-action' : ''} />
        <span className={railHide}>{label}</span>
      </>}
    </NavLink>
  )
}

const dot: Record<BrainState, string> = {
  ok: 'bg-emerald',
  degraded: 'bg-warn',
  down: 'bg-danger',
  unknown: 'hidden',
  loading: 'hidden',
}

function EmeraldRow({ railHide }: { railHide: string }) {
  const { openPanel } = useEmeraldChat()
  const { state, summary } = useBrainStatus()
  return (
    <button
      type="button"
      onClick={() => openPanel()}
      title={summary ? `Emerald — ${summary}` : 'Ask Emerald'}
      className="flex w-full items-center gap-3 rounded-control px-3 py-2 text-left hover:bg-emerald/[0.08] md:max-xl:justify-center md:max-xl:px-0"
    >
      <span className="relative text-emerald">
        <EmeraldMark size={20} />
        <span aria-hidden className={cn('absolute -bottom-0.5 -right-0.5 hidden h-2 w-2 rounded-full ring-2 ring-surface md:max-xl:block', dot[state])} />
      </span>
      <span className={cn('min-w-0 flex-1', railHide)}>
        <span className="block text-sm font-medium text-ink">Emerald</span>
        <span className="flex items-center gap-1.5 text-xs text-muted">
          <span aria-hidden className={cn('h-1.5 w-1.5 shrink-0 rounded-full', dot[state])} />
          <span className="truncate">{summary ?? 'Your family assistant'}</span>
        </span>
      </span>
    </button>
  )
}
