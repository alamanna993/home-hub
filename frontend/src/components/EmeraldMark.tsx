import { cn } from '../lib/utils'

/** Emerald's faceted-gem mark. Colored by currentColor; use it only for the assistant. */
export function EmeraldMark({ size = 16, className }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" aria-hidden className={cn('shrink-0', className)}>
      <path d="M5 1.75h6L14.25 5v6L11 14.25H5L1.75 11V5z" fill="currentColor" fillOpacity="0.16" stroke="currentColor" strokeWidth="1.25" strokeLinejoin="round" />
      <path d="M6.25 5h3.5L11 6.25v3.5L9.75 11h-3.5L5 9.75v-3.5z" fill="currentColor" fillOpacity="0.4" stroke="currentColor" strokeWidth="1" strokeLinejoin="round" />
      <path d="M5 1.75 6.25 5M11 1.75 9.75 5M14.25 5 11 6.25M14.25 11 11 9.75M11 14.25 9.75 11M5 14.25 6.25 11M1.75 11 5 9.75M1.75 5 5 6.25" stroke="currentColor" strokeWidth="0.9" strokeLinecap="round" />
    </svg>
  )
}

/** HomeHub's own mark (ledger blue tile with a house) */
export function HomeHubMark({ size = 24, className }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden className={cn('shrink-0', className)}>
      <rect width="32" height="32" rx="7" className="fill-action" />
      <path d="M8 15.5 16 9l8 6.5V24h-5.5v-5h-5v5H8z" className="fill-action-on" />
    </svg>
  )
}
