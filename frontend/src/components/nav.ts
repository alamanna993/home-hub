import {
  AlertTriangle, BookOpen, CalendarDays, ClipboardList, Home, MapPin, Package, ShoppingCart, Tag, Tv, UtensilsCrossed,
  type LucideIcon,
} from 'lucide-react'

export interface NavItem { to: string; label: string; icon: LucideIcon }
export interface NavGroup { id: string; label?: string; items: NavItem[] }

/** Kitchen and Plan are the two groups with a switcher at the top of each page on phones */
export const KITCHEN: NavItem[] = [
  { to: '/shopping', label: 'Shopping', icon: ShoppingCart },
  { to: '/inventory', label: 'Inventory', icon: Package },
  { to: '/recipes', label: 'Recipes', icon: BookOpen },
]
export const PLAN: NavItem[] = [
  { to: '/calendar', label: 'Calendar', icon: CalendarDays },
  { to: '/meals', label: 'Meals', icon: UtensilsCrossed },
  { to: '/chores', label: 'Chores', icon: ClipboardList },
]
export const HOUSEHOLD: NavItem[] = [
  { to: '/locations', label: 'Locations', icon: MapPin },
  { to: '/categories', label: 'Categories', icon: Tag },
  { to: '/alerts', label: 'Alerts', icon: AlertTriangle },
]

export const NAV_GROUPS: NavGroup[] = [
  { id: 'today', items: [{ to: '/', label: 'Today', icon: Home }] },
  { id: 'kitchen', label: 'Kitchen', items: KITCHEN },
  { id: 'plan', label: 'Plan', items: PLAN },
  { id: 'household', label: 'Household', items: HOUSEHOLD },
]

export const DISPLAY_ITEM: NavItem = { to: '/display', label: 'Kitchen display', icon: Tv }

export type TabId = 'today' | 'kitchen' | 'plan' | 'more'

const root = (pathname: string) => '/' + (pathname.split('/')[1] ?? '')
const inGroup = (items: NavItem[], pathname: string) => items.some(i => i.to === root(pathname))

/** Which bottom tab a path belongs to */
export function tabFor(pathname: string): TabId {
  if (pathname === '/') return 'today'
  if (inGroup(KITCHEN, pathname)) return 'kitchen'
  if (inGroup(PLAN, pathname)) return 'plan'
  return 'more'
}

/** The switcher items for the group a path is in (none for other pages) */
export function siblingsFor(pathname: string): NavItem[] | null {
  if (inGroup(KITCHEN, pathname)) return KITCHEN
  if (inGroup(PLAN, pathname)) return PLAN
  return null
}

const EXTRA: Record<string, string> = { '/chat': 'Emerald', '/settings': 'Settings', '/more': 'More' }

/** Breadcrumb for the current path: the nav group (if any) and the page name */
export function crumbsFor(pathname: string): { group?: string; label: string } {
  if (pathname === '/') return { label: 'Today' }
  const r = root(pathname)
  for (const g of NAV_GROUPS) {
    const hit = g.items.find(i => i.to === r)
    if (hit) return { group: g.label, label: hit.label }
  }
  return { label: EXTRA[r] ?? 'HomeHub' }
}
