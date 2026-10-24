import { cloneElement, KeyboardEvent, ReactElement, ReactNode, useEffect, useId, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { Check, type LucideIcon } from 'lucide-react'
import { cn } from '../../lib/utils'

export type MenuEntry =
  | {
      label: ReactNode
      onSelect: () => void
      icon?: LucideIcon
      /** Renders as a radio item with a check when true */
      checked?: boolean
      danger?: boolean
      disabled?: boolean
      hint?: ReactNode
    }
  | { separator: true }
  | { heading: ReactNode }

export interface MenuProps {
  /** A button element; Menu adds onClick, aria-haspopup and aria-expanded */
  trigger: ReactElement
  items: MenuEntry[]
  align?: 'start' | 'end'
  /** Open upward (for triggers near the bottom of the screen) */
  side?: 'bottom' | 'top'
  label?: string
  className?: string
}

export function Menu({ trigger, items, align = 'end', side = 'bottom', label, className }: MenuProps) {
  const [open, setOpen] = useState(false)
  const wrap = useRef<HTMLDivElement>(null)
  const list = useRef<HTMLDivElement>(null)
  const triggerEl = useRef<HTMLElement | null>(null)
  const menuId = useId()

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent | TouchEvent) => {
      if (!wrap.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('touchstart', onDown)
    requestAnimationFrame(() => focusItem(0))
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('touchstart', onDown)
    }
  }, [open])

  function itemsEls() {
    return Array.from(list.current?.querySelectorAll<HTMLElement>('[role^="menuitem"]:not([aria-disabled="true"])') ?? [])
  }
  function focusItem(i: number) {
    const els = itemsEls()
    if (els.length) els[(i + els.length) % els.length].focus()
  }
  function close(refocus = true) {
    setOpen(false)
    if (refocus) triggerEl.current?.focus()
  }

  function onKeyDown(e: KeyboardEvent) {
    const els = itemsEls()
    const idx = els.indexOf(document.activeElement as HTMLElement)
    if (e.key === 'ArrowDown') { e.preventDefault(); focusItem(idx + 1) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); focusItem(idx - 1) }
    else if (e.key === 'Home') { e.preventDefault(); focusItem(0) }
    else if (e.key === 'End') { e.preventDefault(); focusItem(els.length - 1) }
    else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close() }
    else if (e.key === 'Tab') close(false)
  }

  const triggerProps = trigger.props as { onClick?: (e: unknown) => void }
  const triggerNode = cloneElement(trigger as ReactElement<Record<string, unknown>>, {
    ref: (el: HTMLElement | null) => { triggerEl.current = el },
    'aria-haspopup': 'menu',
    'aria-expanded': open,
    'aria-controls': open ? menuId : undefined,
    onClick: (e: unknown) => { triggerProps.onClick?.(e); setOpen(o => !o) },
    onKeyDown: (e: KeyboardEvent) => {
      if (e.key === 'ArrowDown' && !open) { e.preventDefault(); setOpen(true) }
    },
  })

  return (
    <div ref={wrap} className={cn('relative inline-flex', className)}>
      {triggerNode}
      <AnimatePresence>
        {open && (
          <motion.div
            ref={list}
            id={menuId}
            role="menu"
            aria-label={label}
            onKeyDown={onKeyDown}
            initial={{ opacity: 0, y: side === 'top' ? 4 : -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.12 }}
            className={cn(
              'absolute z-50 min-w-[12rem] rounded-control border border-line bg-surface p-1 shadow-overlay',
              side === 'bottom' ? 'top-full mt-1' : 'bottom-full mb-1',
              align === 'end' ? 'right-0' : 'left-0',
            )}
          >
            {items.map((item, i) => {
              if ('separator' in item) return <div key={i} role="separator" className="my-1 h-px bg-line" />
              if ('heading' in item) return <div key={i} className="px-2 pb-1 pt-1.5 text-xs font-medium text-muted">{item.heading}</div>
              const Icon = item.icon
              const radio = item.checked !== undefined
              return (
                <div
                  key={i}
                  role={radio ? 'menuitemradio' : 'menuitem'}
                  aria-checked={radio ? item.checked : undefined}
                  aria-disabled={item.disabled || undefined}
                  tabIndex={-1}
                  onClick={() => { if (!item.disabled) { close(); item.onSelect() } }}
                  onKeyDown={e => {
                    if ((e.key === 'Enter' || e.key === ' ') && !item.disabled) { e.preventDefault(); close(); item.onSelect() }
                  }}
                  className={cn(
                    'flex h-9 lg:h-8 cursor-default select-none items-center gap-2 rounded px-2 text-sm outline-none',
                    'focus:bg-ink/[0.06] hover:bg-ink/[0.06]',
                    item.danger ? 'text-danger' : 'text-ink',
                    item.disabled && 'pointer-events-none opacity-50',
                  )}
                >
                  {Icon && <Icon size={16} aria-hidden className={item.danger ? '' : 'text-muted'} />}
                  <span className="flex-1 truncate">{item.label}</span>
                  {item.hint && <span className="text-xs text-muted">{item.hint}</span>}
                  {radio && <Check size={15} aria-hidden className={cn('text-action', !item.checked && 'invisible')} />}
                </div>
              )
            })}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
