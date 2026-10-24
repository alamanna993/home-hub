import { ReactNode, RefObject, useId, useRef } from 'react'
import { createPortal } from 'react-dom'
import { AnimatePresence, motion } from 'framer-motion'
import { X } from 'lucide-react'
import { cn } from '../../lib/utils'
import { IconButton } from './Button'
import { useModalFocus } from './overlay'

export interface DialogProps {
  open: boolean
  onClose: () => void
  title: ReactNode
  description?: ReactNode
  children?: ReactNode
  /** Buttons, right-aligned in a footer bar */
  footer?: ReactNode
  size?: 'sm' | 'md' | 'lg'
  /** Element to focus on open; otherwise the first [data-autofocus], else the dialog */
  initialFocus?: RefObject<HTMLElement>
}

const widths = { sm: 'sm:max-w-sm', md: 'sm:max-w-lg', lg: 'sm:max-w-2xl' }

export function Dialog({ open, onClose, title, description, children, footer, size = 'md', initialFocus }: DialogProps) {
  const ref = useRef<HTMLDivElement>(null)
  const titleId = useId()
  const descId = useId()
  useModalFocus(open, ref, onClose, initialFocus)

  return createPortal(
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-4">
          <motion.div
            className="absolute inset-0 bg-ink/40 dark:bg-black/60"
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            onClick={onClose}
          />
          <motion.div
            ref={ref}
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            aria-describedby={description ? descId : undefined}
            tabIndex={-1}
            className={cn(
              'relative flex w-full max-h-modal flex-col overflow-hidden bg-surface shadow-overlay focus:outline-none',
              'rounded-t-panel border border-line sm:rounded-panel pb-[env(safe-area-inset-bottom)] sm:pb-0',
              widths[size],
            )}
            initial={{ opacity: 0, y: 8, scale: 0.99 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8, scale: 0.99 }}
            transition={{ duration: 0.16, ease: 'easeOut' }}
          >
            <header className="flex items-start justify-between gap-3 px-5 pt-4 pb-3">
              <div className="min-w-0">
                <h2 id={titleId} className="text-base font-semibold text-ink">{title}</h2>
                {description && <p id={descId} className="mt-1 text-sm text-muted">{description}</p>}
              </div>
              <IconButton icon={X} label="Close" size="sm" onClick={onClose} className="-mr-1.5 -mt-0.5" />
            </header>
            {children && <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-4">{children}</div>}
            {footer && (
              <footer className="flex flex-col-reverse gap-2 border-t border-line bg-canvas/60 px-5 py-3 sm:flex-row sm:justify-end">
                {footer}
              </footer>
            )}
          </motion.div>
        </div>
      )}
    </AnimatePresence>,
    document.body,
  )
}
