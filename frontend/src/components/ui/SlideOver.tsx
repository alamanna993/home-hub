import { ReactNode, RefObject, useId, useRef } from 'react'
import { createPortal } from 'react-dom'
import { AnimatePresence, motion } from 'framer-motion'
import { X } from 'lucide-react'
import { cn } from '../../lib/utils'
import { IconButton } from './Button'
import { useModalFocus } from './overlay'
import { useMedia } from '../../hooks/useMedia'

export interface SlideOverProps {
  open: boolean
  onClose: () => void
  title: ReactNode
  description?: ReactNode
  /** Shown before the title (e.g. a brand mark) */
  icon?: ReactNode
  /** Extra header buttons, placed before Close */
  headerActions?: ReactNode
  children?: ReactNode
  footer?: ReactNode
  /** Width on screens wider than the panel; phones always get the full width */
  width?: number
  initialFocus?: RefObject<HTMLElement>
  /** Let the body manage its own scrolling (chat logs) instead of one scroll area */
  bodyClassName?: string
  className?: string
}

export function SlideOver({
  open, onClose, title, description, icon, headerActions, children, footer,
  width = 420, initialFocus, bodyClassName, className,
}: SlideOverProps) {
  const ref = useRef<HTMLDivElement>(null)
  const titleId = useId()
  useModalFocus(open, ref, onClose, initialFocus)
  // Phones get a bottom sheet (thumb reach); tablets and desktops a side panel
  const wide = useMedia('(min-width: 768px)')

  return createPortal(
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-50">
          <motion.div
            className="absolute inset-0 bg-ink/25 dark:bg-black/50"
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            onClick={onClose}
          />
          <motion.aside
            ref={ref}
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            tabIndex={-1}
            style={wide ? { maxWidth: width } : undefined}
            className={cn(
              'absolute flex w-full flex-col bg-surface shadow-overlay focus:outline-none',
              wide
                ? 'inset-y-0 right-0 border-l border-line pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)]'
                : 'inset-x-0 bottom-0 h-[92dvh] rounded-t-[20px] border-t border-line pb-[env(safe-area-inset-bottom)]',
              className,
            )}
            initial={wide ? { x: '100%' } : { y: '100%' }}
            animate={wide ? { x: 0 } : { y: 0 }}
            exit={wide ? { x: '100%' } : { y: '100%' }}
            transition={{ type: 'tween', duration: 0.22, ease: 'easeOut' }}
          >
            {!wide && <div aria-hidden className="mx-auto mt-2 h-1 w-10 shrink-0 rounded-full bg-line" />}
            <header className="flex h-14 shrink-0 items-center gap-2.5 border-b border-line pl-4 pr-2">
              {icon}
              <div className="min-w-0 flex-1">
                <h2 id={titleId} className="truncate text-base font-semibold text-ink">{title}</h2>
                {description && <div className="truncate text-xs text-muted">{description}</div>}
              </div>
              {headerActions}
              <IconButton icon={X} label="Close" onClick={onClose} />
            </header>
            <div className={cn('min-h-0 flex-1 overflow-y-auto', bodyClassName)}>{children}</div>
            {footer && <footer className="shrink-0 border-t border-line">{footer}</footer>}
          </motion.aside>
        </div>
      )}
    </AnimatePresence>,
    document.body,
  )
}
