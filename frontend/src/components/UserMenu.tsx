import { useNavigate } from 'react-router-dom'
import { ChevronDown, LogOut, Settings } from 'lucide-react'
import { Menu, type MenuEntry } from './ui'
import { useAuth } from '../hooks/useAuth'
import { useThemeMenuItems } from './ThemeToggle'
import { cn } from '../lib/utils'

/** Avatar menu: who's signed in, settings, sign out. `compact` (phones) hides the
 *  name and folds the theme picker in, since there's no room for a separate toggle. */
export default function UserMenu({ compact }: { compact?: boolean }) {
  const { username, isAdmin, logout } = useAuth()
  const navigate = useNavigate()
  const themeItems = useThemeMenuItems()
  const name = username || 'Account'
  const initials = name.slice(0, 2).toUpperCase()

  const items: MenuEntry[] = [
    { heading: <>Signed in as <span className="text-ink">{name}</span></> },
    ...(compact ? [{ separator: true } as const, { heading: 'Theme' }, ...themeItems] : []),
    ...(isAdmin ? [{ separator: true } as const, { label: 'Settings', icon: Settings, onSelect: () => navigate('/settings') }] : []),
    { separator: true },
    { label: 'Sign out', icon: LogOut, onSelect: () => { logout(); navigate('/login', { replace: true }) } },
  ]

  return (
    <Menu
      label="Account"
      items={items}
      trigger={
        <button
          type="button"
          aria-label={`Account: ${name}`}
          className={cn(
            'flex h-10 lg:h-9 items-center gap-2 rounded-control text-sm text-ink hover:bg-ink/[0.06]',
            compact ? 'w-10 justify-center' : 'pl-1 pr-2',
          )}
        >
          <span className="flex h-7 w-7 items-center justify-center rounded-full bg-action/10 text-xs font-semibold text-action">
            {initials}
          </span>
          {!compact && <>
            <span className="max-w-[8rem] truncate font-medium">{name}</span>
            <ChevronDown size={14} aria-hidden className="text-muted" />
          </>}
        </button>
      }
    />
  )
}
