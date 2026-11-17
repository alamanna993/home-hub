import { NavLink, useLocation } from 'react-router-dom'
import { cn } from '../lib/utils'
import { siblingsFor } from './nav'

/** Segmented switcher at the top of Kitchen / Plan pages on phones (the sidebar already lists them from tablet up). */
export default function GroupSwitcher() {
  const { pathname } = useLocation()
  const items = siblingsFor(pathname)
  if (!items) return null
  return (
    <nav aria-label="Section" className="shrink-0 border-b border-line bg-surface px-4 py-2 md:hidden">
      <ul className="flex gap-1 rounded-control bg-canvas p-1">
        {items.map(i => (
          <li key={i.to} className="flex-1">
            <NavLink
              to={i.to}
              className={({ isActive }) => cn(
                'flex h-10 items-center justify-center gap-1.5 rounded-[8px] text-sm font-medium transition-colors',
                isActive ? 'bg-surface text-ink ring-1 ring-line' : 'text-muted',
              )}
            >
              <i.icon size={16} aria-hidden />
              {i.label}
            </NavLink>
          </li>
        ))}
      </ul>
    </nav>
  )
}
