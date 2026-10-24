import { cn } from '../../lib/utils'

export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden className={cn('h-4 animate-pulse rounded bg-ink/[0.07]', className)} />
}

/** A few lines of placeholder text; the last one is shorter */
export function SkeletonText({ lines = 3, className }: { lines?: number; className?: string }) {
  return (
    <div className={cn('space-y-2', className)} aria-hidden>
      {Array.from({ length: lines }, (_, i) => (
        <Skeleton key={i} className={i === lines - 1 && lines > 1 ? 'w-3/5' : 'w-full'} />
      ))}
    </div>
  )
}
