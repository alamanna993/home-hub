import { Menu } from 'lucide-react'

export default function MobileTopBar({ onMenu }: { onMenu: () => void }) {
  return (
    <header className="lg:hidden flex items-center gap-2 shrink-0 h-14 px-2 pt-[env(safe-area-inset-top)] box-content bg-surface-card border-b border-surface-border">
      <button
        onClick={onMenu}
        aria-label="Open menu"
        className="w-11 h-11 flex items-center justify-center rounded-lg text-surface-muted hover:text-white active:bg-white/10 transition-colors"
      >
        <Menu size={22} />
      </button>
      <span className="text-lg">🏠</span>
      <span className="text-white font-semibold">HomeHub</span>
    </header>
  )
}
