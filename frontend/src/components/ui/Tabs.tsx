import { KeyboardEvent, ReactNode, useRef } from 'react'
import { cn } from '../../lib/utils'

export interface TabItem<T extends string = string> {
  id: T
  label: ReactNode
  count?: number
  disabled?: boolean
}

export interface TabsProps<T extends string> {
  tabs: TabItem<T>[]
  value: T
  onChange: (id: T) => void
  /** Accessible name for the tab list */
  label?: string
  className?: string
}

/** Controlled underline tabs. Render the matching content yourself; give it
 *  role="tabpanel" and aria-labelledby={`tab-${id}`} if you want the full pattern. */
export function Tabs<T extends string>({ tabs, value, onChange, label, className }: TabsProps<T>) {
  const refs = useRef<(HTMLButtonElement | null)[]>([])

  function onKeyDown(e: KeyboardEvent, i: number) {
    const step = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0
    if (!step && e.key !== 'Home' && e.key !== 'End') return
    e.preventDefault()
    const enabled = tabs.map((t, j) => (t.disabled ? -1 : j)).filter(j => j >= 0)
    let next: number
    if (e.key === 'Home') next = enabled[0]
    else if (e.key === 'End') next = enabled[enabled.length - 1]
    else {
      const pos = enabled.indexOf(i)
      next = enabled[(pos + step + enabled.length) % enabled.length]
    }
    refs.current[next]?.focus()
    onChange(tabs[next].id)
  }

  return (
    <div role="tablist" aria-label={label} className={cn('flex gap-5 overflow-x-auto overflow-y-hidden border-b border-line [scrollbar-width:none]', className)}>
      {tabs.map((t, i) => {
        const active = t.id === value
        return (
          <button
            key={t.id}
            ref={el => { refs.current[i] = el }}
            id={`tab-${t.id}`}
            role="tab"
            type="button"
            aria-selected={active}
            tabIndex={active ? 0 : -1}
            disabled={t.disabled}
            onClick={() => onChange(t.id)}
            onKeyDown={e => onKeyDown(e, i)}
            className={cn(
              '-mb-px flex h-10 shrink-0 items-center gap-1.5 border-b-2 text-sm font-medium transition-colors',
              active ? 'border-action text-ink' : 'border-transparent text-muted hover:text-ink',
              'disabled:opacity-50',
            )}
          >
            {t.label}
            {t.count !== undefined && (
              <span className={cn('rounded px-1.5 text-xs tnum', active ? 'bg-action/10 text-action' : 'bg-ink/[0.06] text-muted')}>
                {t.count}
              </span>
            )}
          </button>
        )
      })}
    </div>
  )
}
