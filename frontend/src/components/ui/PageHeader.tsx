import { Fragment, HTMLAttributes, ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { ChevronRight } from 'lucide-react'
import { cn } from '../../lib/utils'

export interface Crumb { label: string; to?: string }

/** Page content frame: left-aligned, capped at 1280px, the app's standard gutters */
export function Page({ className, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('w-full max-w-[1280px] px-4 py-5 lg:px-8 lg:py-6', className)} {...rest} />
}

export interface PageHeaderProps {
  title: ReactNode
  description?: ReactNode
  actions?: ReactNode
  /** For detail pages, e.g. [{ label: 'Recipes', to: '/recipes' }]; the title is the current crumb */
  breadcrumb?: Crumb[]
  className?: string
}

export function PageHeader({ title, description, actions, breadcrumb, className }: PageHeaderProps) {
  return (
    <header className={cn('mb-5 lg:mb-6', className)}>
      {breadcrumb && breadcrumb.length > 0 && (
        <nav aria-label="Breadcrumb" className="mb-2">
          <ol className="flex flex-wrap items-center gap-1 text-ui text-muted">
            {breadcrumb.map((c, i) => (
              <Fragment key={i}>
                <li>{c.to ? <Link to={c.to} className="rounded hover:text-ink hover:underline">{c.label}</Link> : c.label}</li>
                <li aria-hidden><ChevronRight size={14} /></li>
              </Fragment>
            ))}
          </ol>
        </nav>
      )}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold text-ink">{title}</h1>
          {description && <p className="mt-1 text-sm text-muted">{description}</p>}
        </div>
        {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
      </div>
    </header>
  )
}
