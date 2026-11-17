import { useLocation } from 'react-router-dom'
import { crumbsFor } from './nav'
import { HomeHubMark } from './EmeraldMark'
import UserMenu from './UserMenu'

/** Phone header: where you are, and the account. Navigation lives in the bottom tab bar. */
export default function MobileTopBar() {
  const { pathname } = useLocation()
  const { label } = crumbsFor(pathname)

  return (
    <header className="box-content flex h-14 shrink-0 items-center gap-2.5 border-b border-line bg-surface pl-4 pr-2 pt-[env(safe-area-inset-top)] md:hidden">
      <HomeHubMark size={26} />
      <h1 className="min-w-0 flex-1 truncate text-lg font-semibold text-ink">{label}</h1>
      <UserMenu compact />
    </header>
  )
}
