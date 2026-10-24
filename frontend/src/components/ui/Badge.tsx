import { HTMLAttributes } from 'react'
import type { LucideIcon } from 'lucide-react'
import { cn } from '../../lib/utils'

export type BadgeTone = 'neutral' | 'action' | 'warn' | 'danger' | 'emerald'

const tones: Record<BadgeTone, string> = {
  neutral: 'bg-ink/[0.06] text-muted',
  action: 'bg-action/10 text-action',
  warn: 'bg-warn/10 text-warn',
  danger: 'bg-danger/10 text-danger',
  // Emerald only: AI-filled values, assistant state
  emerald: 'bg-emerald/10 text-emerald',
}

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  tone?: BadgeTone
  icon?: LucideIcon
}

export function Badge({ tone = 'neutral', icon: Icon, className, children, ...rest }: BadgeProps) {
  return (
    <span
      className={cn('inline-flex h-5 items-center gap-1 whitespace-nowrap rounded px-1.5 text-xs font-medium tnum', tones[tone], className)}
      {...rest}
    >
      {Icon && <Icon size={12} aria-hidden />}
      {children}
    </span>
  )
}
