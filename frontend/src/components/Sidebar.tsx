import { NavLink, useNavigate } from 'react-router-dom'
import { LayoutDashboard, Package, MapPin, Tag, MessageSquare, AlertTriangle, CalendarDays, UtensilsCrossed, ClipboardList, Settings, LogOut } from 'lucide-react'
import { cn } from '../lib/utils'
import { useAuth } from '../hooks/useAuth'

const links = [
  { to: '/', icon: LayoutDashboard, label: 'Dashboard' },
  { to: '/inventory', icon: Package, label: 'Inventory' },
  { to: '/locations', icon: MapPin, label: 'Locations' },
  { to: '/categories', icon: Tag, label: 'Categories' },
  { to: '/alerts', icon: AlertTriangle, label: 'Low Stock' },
  { to: '/calendar', icon: CalendarDays, label: 'Calendar' },
  { to: '/meals', icon: UtensilsCrossed, label: 'Meals' },
  { to: '/chores', icon: ClipboardList, label: 'Chores' },
  { to: '/chat', icon: MessageSquare, label: 'Chat' },
]

export default function Sidebar() {
  const { username, logout, isAdmin } = useAuth()
  const navigate = useNavigate()

  function handleLogout() {
    logout()
    navigate('/login', { replace: true })
  }

  return (
    <aside className="w-60 min-h-screen bg-surface-card border-r border-surface-border flex flex-col">
      <div className="px-6 py-6 border-b border-surface-border">
        <div className="flex items-center gap-3">
          <span className="text-2xl">🏠</span>
          <div>
            <h1 className="text-white font-semibold text-lg leading-none">HomeHub</h1>
            <p className="text-surface-muted text-xs mt-0.5">Home Inventory</p>
          </div>
        </div>
      </div>

      <nav className="flex-1 px-3 py-4 space-y-1">
        {links.map(({ to, icon: Icon, label }) => (
          <NavLink
            key={to}
            to={to}
            end={to === '/'}
            className={({ isActive }) =>
              cn(
                'flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all duration-150',
                isActive
                  ? 'bg-accent/20 text-accent glow-border'
                  : 'text-surface-muted hover:text-white hover:bg-white/5'
              )
            }
          >
            <Icon size={17} />
            {label}
          </NavLink>
        ))}
      </nav>

      <div className="px-3 py-3 border-t border-surface-border space-y-1">
        {isAdmin && <NavLink
          to="/settings"
          className={({ isActive }) =>
            cn(
              'flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all duration-150',
              isActive
                ? 'bg-accent/20 text-accent glow-border'
                : 'text-surface-muted hover:text-white hover:bg-white/5'
            )
          }
        >
          <Settings size={17} />
          Settings
        </NavLink>}

        <button
          onClick={handleLogout}
          className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium text-surface-muted hover:text-red-400 hover:bg-red-500/5 transition-all duration-150"
        >
          <LogOut size={17} />
          Sign Out
          {username && <span className="ml-auto text-xs opacity-60 truncate max-w-[5rem]">{username}</span>}
        </button>
      </div>
    </aside>
  )
}
