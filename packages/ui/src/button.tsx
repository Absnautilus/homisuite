import { forwardRef, type ButtonHTMLAttributes } from 'react'
import './button.css'

export type ButtonVariant = 'primary' | 'secondary' | 'danger' | 'ghost' | 'chip'
export type ButtonSize = 'sm' | 'md'

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant
  /** 'md' (44px, the default) or 'sm' (32px, for a dialog footer or a dense row). */
  size?: ButtonSize
  /** Disables the button and marks it busy -- callers still swap in their own "Salvataggio…" label. */
  loading?: boolean
  /** variant="chip" only: this chip is the active filter. Drives aria-pressed and the selected styling. */
  pressed?: boolean
}

// The looks every module hand-wrote on its own -- apps/web's `className="btn
// btn-*"` (styles.css + shell-completion.css) and Housekeeping's Tailwind
// `variant`/`size` map (components/ui/button.tsx) -- collapsed into one
// component both now render through. `success`/`warning`/`outline` existed
// as separate Housekeeping variant names but were already styled identically
// to `secondary`; callers were moved onto `secondary` directly rather than
// carrying three redundant aliases forward.
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'secondary', size = 'md', loading = false, pressed, disabled, className, type = 'button', ...rest },
  ref,
) {
  return (
    <button
      {...rest}
      ref={ref}
      type={type}
      aria-pressed={variant === 'chip' ? pressed ?? false : rest['aria-pressed']}
      className={['btn', `btn-${variant}`, size === 'sm' ? 'btn-size-sm' : null, className].filter(Boolean).join(' ')}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
    />
  )
})
