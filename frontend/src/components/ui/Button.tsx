import { forwardRef, ButtonHTMLAttributes } from 'react'
import { Loader2, type LucideIcon } from 'lucide-react'
import { cn } from '../../lib/utils'

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger'
export type ButtonSize = 'sm' | 'md'

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant
  size?: ButtonSize
  /** Leading icon */
  icon?: LucideIcon
  /** Shows a spinner in place of the icon and disables the button */
  loading?: boolean
}

export const buttonVariants: Record<ButtonVariant, string> = {
  primary: 'bg-action text-action-on hover:bg-action-hover',
  secondary: 'bg-surface text-ink border border-line hover:bg-ink/[0.04] hover:border-muted/40',
  ghost: 'text-ink hover:bg-ink/[0.06]',
  danger: 'bg-danger text-action-on hover:bg-danger-hover',
}

const sizes: Record<ButtonSize, string> = {
  sm: 'h-8 px-2.5 text-ui gap-1.5',
  md: 'h-10 lg:h-9 px-3.5 text-sm gap-2',
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'secondary', size = 'md', icon: Icon, loading, disabled, className, children, type = 'button', ...rest },
  ref,
) {
  const iconSize = size === 'sm' ? 14 : 16
  return (
    <button
      ref={ref}
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={cn(
        'inline-flex shrink-0 items-center justify-center whitespace-nowrap rounded-control font-medium',
        'transition-colors duration-100 select-none disabled:pointer-events-none disabled:opacity-50',
        buttonVariants[variant], sizes[size], className,
      )}
      {...rest}
    >
      {loading ? <Loader2 size={iconSize} className="animate-spin" aria-hidden /> : Icon && <Icon size={iconSize} aria-hidden />}
      {children}
    </button>
  )
})

export interface IconButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> {
  icon: LucideIcon
  /** Accessible name; also shown as the native tooltip */
  label: string
  variant?: 'ghost' | 'secondary'
  size?: ButtonSize
}

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { icon: Icon, label, variant = 'ghost', size = 'md', className, type = 'button', title, ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      aria-label={label}
      title={title ?? label}
      className={cn(
        'inline-flex shrink-0 items-center justify-center rounded-control text-muted transition-colors duration-100',
        'hover:text-ink disabled:pointer-events-none disabled:opacity-50',
        variant === 'ghost' ? 'hover:bg-ink/[0.06]' : 'border border-line bg-surface hover:bg-ink/[0.04]',
        size === 'sm' ? 'h-8 w-8' : 'h-10 w-10 lg:h-9 lg:w-9',
        className,
      )}
      {...rest}
    >
      <Icon size={size === 'sm' ? 16 : 18} aria-hidden />
    </button>
  )
})
