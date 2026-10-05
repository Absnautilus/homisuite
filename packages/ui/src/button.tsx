import { forwardRef, type ButtonHTMLAttributes } from 'react'
import './button.css'

export type ButtonVariant = 'primary' | 'secondary' | 'danger'

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant
  /** Disables the button and marks it busy -- callers still swap in their own "Salvataggio…" label. */
  loading?: boolean
}

// The three looks every module already hand-writes as `className="btn btn-*"`
// (apps/web/src/styles.css + shell-completion.css) -- this gives them one
// typed entry point plus the disabled/focus-visible states none of those
// call sites had.
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'secondary', loading = false, disabled, className, type = 'button', ...rest },
  ref,
) {
  return (
    <button
      {...rest}
      ref={ref}
      type={type}
      className={['btn', `btn-${variant}`, className].filter(Boolean).join(' ')}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
    />
  )
})
