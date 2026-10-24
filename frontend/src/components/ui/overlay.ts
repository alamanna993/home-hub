import { RefObject, useEffect, useRef } from 'react'

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

/** Modal behavior for dialogs and slide-overs: Escape closes, Tab stays inside,
 *  focus moves in on open and returns to the opener on close. */
export function useModalFocus(open: boolean, ref: RefObject<HTMLElement>, onClose: () => void, initialFocus?: RefObject<HTMLElement>) {
  const close = useRef(onClose)
  close.current = onClose

  useEffect(() => {
    if (!open) return
    const opener = document.activeElement as HTMLElement | null
    const frame = requestAnimationFrame(() => {
      const el = initialFocus?.current ?? ref.current?.querySelector<HTMLElement>('[data-autofocus]') ?? ref.current
      el?.focus()
    })

    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.stopPropagation()
        close.current()
        return
      }
      if (e.key !== 'Tab' || !ref.current) return
      const nodes = Array.from(ref.current.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(n => n.offsetParent !== null)
      if (nodes.length === 0) { e.preventDefault(); return }
      const first = nodes[0], last = nodes[nodes.length - 1]
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus() }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus() }
    }

    document.addEventListener('keydown', onKey)
    return () => {
      cancelAnimationFrame(frame)
      document.removeEventListener('keydown', onKey)
      opener?.focus?.()
    }
  }, [open])
}
