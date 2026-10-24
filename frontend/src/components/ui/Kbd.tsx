import { ReactNode } from 'react'
import { cn } from '../../lib/utils'

export const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent)
/** "⌘" on Apple devices, "Ctrl" elsewhere */
export const modKey = isMac ? '⌘' : 'Ctrl'

export function Kbd({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <kbd className={cn(
      'inline-flex h-5 min-w-5 items-center justify-center rounded border border-line bg-surface px-1',
      'font-sans text-xs font-medium text-muted',
      className,
    )}>
      {children}
    </kbd>
  )
}
