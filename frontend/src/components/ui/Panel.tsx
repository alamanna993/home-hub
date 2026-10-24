import { HTMLAttributes, ReactNode } from 'react'
import { cn } from '../../lib/utils'

export interface PanelProps extends Omit<HTMLAttributes<HTMLElement>, 'title'> {
  title?: ReactNode
  description?: ReactNode
  /** Right side of the header: buttons, a menu, a count */
  actions?: ReactNode
  /** Pad the body (default). Turn off for tables and lists that run edge to edge. */
  padded?: boolean
  as?: 'section' | 'div' | 'article'
}

export function Panel({ title, description, actions, padded = true, as: Tag = 'section', className, children, ...rest }: PanelProps) {
  return (
    <Tag className={cn('rounded-panel border border-line bg-surface', className)} {...rest}>
      {(title || actions) && <PanelHeader title={title} description={description} actions={actions} />}
      <div className={cn(padded && 'p-4')}>{children}</div>
    </Tag>
  )
}

export function PanelHeader({ title, description, actions, className }: {
  title?: ReactNode; description?: ReactNode; actions?: ReactNode; className?: string
}) {
  return (
    <header className={cn('flex min-h-12 items-center justify-between gap-3 border-b border-line px-4 py-2.5', className)}>
      <div className="min-w-0">
        {title && <h2 className="truncate text-sm font-semibold text-ink">{title}</h2>}
        {description && <p className="mt-0.5 text-ui text-muted">{description}</p>}
      </div>
      {actions && <div className="flex shrink-0 items-center gap-1.5">{actions}</div>}
    </header>
  )
}
