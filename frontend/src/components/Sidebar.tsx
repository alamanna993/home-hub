import { NavLink } from 'react-router-dom'
import { Settings, type LucideIcon } from 'lucide-react'
import { cn } from '../lib/utils'
import { useAuth } from '../hooks/useAuth'
import { useBrainStatus, type BrainState } from '../hooks/useBrainStatus'
import { useEmeraldChat } from '../hooks/useEmeraldChat'
import { NAV_GROUPS } from './nav'
import { EmeraldMark, HomeHubMark } from './EmeraldMark'

/** Desktop: full width from xl, an icon rail between lg and xl. In the phone
 *  drawer (`onNavigate` set) it's always full width. */
export default function Sidebar({ onNavigate }: { onNavigate?: () => void }) {
  const { isAdmin } = useAuth()
  const drawer = !!onNavigate
  // Classes that only apply in the lg–xl rail
  const railHide = drawer ? '' : 'lg:max-xl:hidden'

  return (
    <aside
      aria-label="Main"
      className={cn(
        'flex h-full flex-col overflow-y-auto border-r border-line bg-surface pb-[env(safe-area-inset-bottom)]',
        drawer ? 'w-72 pt-[env(safe-area-inset-top)]' : 'w-60 lg:max-xl:w-[60px]',
      )}
    >
      <div className={cn('flex h-14 shrink-0 items-center gap-2.5 px-4', !drawer && 'lg:max-xl:justify-center lg:max-xl:px-0')}>
        <HomeHubMark size={26} />
        <span className={cn('text-base font-semibold text-ink', railHide)}>HomeHub</span>
      </div>

      <nav className="flex-1 px-2.5 pb-3">
        {NAV_GROUPS.map((group, gi) => (
          <div key={gi} className={gi > 0 ? 'mt-4' : 'mt-1'}>
            {group.label && (
              <>
                <h2 className={cn('px-2.5 pb-1 text-xs font-medium text-muted', railHide)}>{group.label}</h2>
                {!drawer && <div className="mx-2 mb-2 hidden h-px bg-line lg:max-xl:block" aria-hidden />}
              </>
            )}
            <ul className="space-y-0.5">
              {group.items.map(item => (
                <li key={item.to}>
                  <SideLink {...item} onNavigate={onNavigate} railHide={railHide} />
                </li>
              ))}
            </ul>
          </div>
        ))}
      </nav>

      <div className="space-y-0.5 border-t border-line px-2.5 py-2.5">
        <EmeraldRow onNavigate={onNavigate} railHide={railHide} drawer={drawer} />
        {isAdmin && <SideLink to="/settings" label="Settings" icon={Settings} onNavigate={onNavigate} railHide={railHide} />}
      </div>
    </aside>
  )
}

function SideLink({ to, label, icon: Icon, onNavigate, railHide }: {
  to: string; label: string; icon: LucideIcon; onNavigate?: () => void; railHide: string
}) {
  return (
    <NavLink
      to={to}
      end={to === '/'}
      onClick={onNavigate}
      title={label}
      className={({ isActive }) => cn(
        'relative flex h-10 lg:h-9 items-center gap-2.5 rounded-control px-2.5 text-sm font-medium transition-colors duration-100',
        railHide && 'lg:max-xl:justify-center lg:max-xl:px-0',
        isActive
          ? 'bg-action/[0.09] text-ink before:absolute before:inset-y-2 before:left-0 before:w-[3px] before:rounded-full before:bg-action'
          : 'text-muted hover:bg-ink/[0.05] hover:text-ink',
      )}
    >
      {({ isActive }) => <>
        <Icon size={18} aria-hidden className={isActive ? 'text-action' : ''} />
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

function EmeraldRow({ onNavigate, railHide, drawer }: { onNavigate?: () => void; railHide: string; drawer: boolean }) {
  const { openPanel } = useEmeraldChat()
  const { state, summary } = useBrainStatus()
  return (
    <button
      type="button"
      onClick={() => { onNavigate?.(); openPanel() }}
      title={summary ? `Emerald — ${summary}` : 'Ask Emerald'}
      className={cn(
        'flex w-full items-center gap-2.5 rounded-control px-2.5 py-2 text-left hover:bg-emerald/[0.07]',
        !drawer && 'lg:max-xl:justify-center lg:max-xl:px-0',
      )}
    >
      <span className="relative text-emerald">
        <EmeraldMark size={18} />
        <span aria-hidden className={cn('absolute -bottom-0.5 -right-0.5 h-2 w-2 rounded-full ring-2 ring-surface', dot[state], drawer ? 'hidden' : 'hidden lg:max-xl:block')} />
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
