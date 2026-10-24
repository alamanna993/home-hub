import { useLocation } from 'react-router-dom'
import { Menu } from 'lucide-react'
import { IconButton } from './ui'
import { crumbsFor } from './nav'
import { EmeraldMark } from './EmeraldMark'
import { useEmeraldChat } from '../hooks/useEmeraldChat'
import UserMenu from './UserMenu'

export default function MobileTopBar({ onMenu }: { onMenu: () => void }) {
  const { pathname } = useLocation()
  const { label } = crumbsFor(pathname)
  const { openPanel } = useEmeraldChat()

  return (
    <header className="box-content flex h-14 shrink-0 items-center gap-1 border-b border-line bg-surface px-2 pt-[env(safe-area-inset-top)] lg:hidden">
      <IconButton icon={Menu} label="Open menu" onClick={onMenu} />
      <h1 className="min-w-0 flex-1 truncate pl-1 text-base font-semibold text-ink">{label}</h1>
      <button
        type="button"
        onClick={() => openPanel()}
        className="flex h-10 items-center gap-1.5 rounded-control px-2.5 text-sm font-medium text-emerald hover:bg-emerald/[0.08]"
      >
        <EmeraldMark size={18} />
        Ask
      </button>
      <UserMenu compact />
    </header>
  )
}
