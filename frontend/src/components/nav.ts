import {
  AlertTriangle, BookOpen, CalendarDays, ClipboardList, LayoutDashboard, MapPin, Package, Tag, UtensilsCrossed,
  type LucideIcon,
} from 'lucide-react'

export interface NavItem { to: string; label: string; icon: LucideIcon }
export interface NavGroup { label?: string; items: NavItem[] }

export const NAV_GROUPS: NavGroup[] = [
  { items: [{ to: '/', label: 'Overview', icon: LayoutDashboard }] },
  {
    label: 'Household',
    items: [
      { to: '/inventory', label: 'Inventory', icon: Package },
      { to: '/locations', label: 'Locations', icon: MapPin },
      { to: '/categories', label: 'Categories', icon: Tag },
      { to: '/alerts', label: 'Alerts', icon: AlertTriangle },
    ],
  },
  {
    label: 'Planning',
    items: [
      { to: '/calendar', label: 'Calendar', icon: CalendarDays },
      { to: '/meals', label: 'Meals', icon: UtensilsCrossed },
      { to: '/recipes', label: 'Recipes', icon: BookOpen },
      { to: '/chores', label: 'Chores', icon: ClipboardList },
    ],
  },
]

const EXTRA: Record<string, string> = { '/chat': 'Emerald', '/settings': 'Settings' }

/** Breadcrumb for the current path: the nav group (if any) and the page name */
export function crumbsFor(pathname: string): { group?: string; label: string } {
  if (pathname === '/') return { label: 'Overview' }
  const root = '/' + (pathname.split('/')[1] ?? '')
  for (const g of NAV_GROUPS) {
    const hit = g.items.find(i => i.to === root)
    if (hit) return { group: g.label, label: hit.label }
  }
  return { label: EXTRA[root] ?? 'HomeHub' }
}
