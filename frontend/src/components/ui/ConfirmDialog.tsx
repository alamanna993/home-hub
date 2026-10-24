import { ReactNode, useRef, useState } from 'react'
import { Button } from './Button'
import { Dialog } from './Dialog'

export interface ConfirmDialogProps {
  open: boolean
  onClose: () => void
  /** May return a promise; the confirm button shows a spinner until it settles, then the dialog closes */
  onConfirm: () => void | Promise<unknown>
  title: ReactNode
  description?: ReactNode
  confirmLabel?: string
  cancelLabel?: string
  tone?: 'danger' | 'primary'
}

export function ConfirmDialog({
  open, onClose, onConfirm, title, description,
  confirmLabel = 'Confirm', cancelLabel = 'Cancel', tone = 'danger',
}: ConfirmDialogProps) {
  const [busy, setBusy] = useState(false)
  const cancelRef = useRef<HTMLButtonElement>(null)

  async function confirm() {
    setBusy(true)
    try {
      await onConfirm()
      onClose()
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog
      open={open}
      onClose={busy ? () => {} : onClose}
      title={title}
      description={description}
      size="sm"
      // Destructive actions start on Cancel so a stray Enter doesn't confirm
      initialFocus={tone === 'danger' ? cancelRef : undefined}
      footer={<>
        <Button ref={cancelRef} variant="secondary" onClick={onClose} disabled={busy}>{cancelLabel}</Button>
        <Button variant={tone} onClick={confirm} loading={busy} data-autofocus>{confirmLabel}</Button>
      </>}
    />
  )
}
