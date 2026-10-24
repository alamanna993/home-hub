import {
  cloneElement, forwardRef, isValidElement, useId,
  InputHTMLAttributes, ReactElement, ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes,
} from 'react'
import { ChevronDown } from 'lucide-react'
import { cn } from '../../lib/utils'

export interface FieldProps {
  label: ReactNode
  hint?: ReactNode
  error?: ReactNode
  required?: boolean
  /** Visually hide the label (it stays available to screen readers) */
  hideLabel?: boolean
  className?: string
  /** A single Input/Textarea/Select; Field wires up id, aria-describedby and aria-invalid */
  children: ReactElement
}

export function Field({ label, hint, error, required, hideLabel, className, children }: FieldProps) {
  const autoId = useId()
  const id = (isValidElement(children) && (children.props as { id?: string }).id) || autoId
  const hintId = hint ? `${id}-hint` : undefined
  const errorId = error ? `${id}-error` : undefined
  const describedBy = [hintId, errorId].filter(Boolean).join(' ') || undefined

  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      <label htmlFor={id} className={cn('text-ui font-medium text-ink', hideLabel && 'sr-only')}>
        {label}
        {required && <span className="ml-0.5 text-danger" aria-hidden>*</span>}
      </label>
      {cloneElement(children as ReactElement<Record<string, unknown>>, {
        id,
        'aria-describedby': describedBy,
        'aria-invalid': error ? true : undefined,
        required,
      })}
      {hint && !error && <p id={hintId} className="text-xs text-muted">{hint}</p>}
      {error && <p id={errorId} className="text-xs text-danger">{error}</p>}
    </div>
  )
}

export const controlBase = cn(
  'w-full rounded-control border border-line bg-surface text-sm text-ink placeholder:text-muted/80',
  'transition-colors duration-100 hover:border-muted/50',
  'focus:border-action focus:outline-none focus:ring-2 focus:ring-action/25 focus-visible:outline-none',
  'disabled:cursor-not-allowed disabled:opacity-60',
  'aria-[invalid=true]:border-danger aria-[invalid=true]:focus:ring-danger/25',
)

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function Input(
  { className, type = 'text', ...rest }, ref,
) {
  return <input ref={ref} type={type} className={cn(controlBase, 'h-10 lg:h-9 px-3', className)} {...rest} />
})

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(function Textarea(
  { className, rows = 3, ...rest }, ref,
) {
  return <textarea ref={ref} rows={rows} className={cn(controlBase, 'px-3 py-2 leading-5 resize-y', className)} {...rest} />
})

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(function Select(
  { className, children, ...rest }, ref,
) {
  return (
    <div className={cn('relative', className)}>
      <select ref={ref} className={cn(controlBase, 'h-10 lg:h-9 appearance-none pl-3 pr-8')} {...rest}>
        {children}
      </select>
      <ChevronDown size={16} aria-hidden className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-muted" />
    </div>
  )
})
