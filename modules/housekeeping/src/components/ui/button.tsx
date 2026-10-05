import { forwardRef } from 'react'
import { Link } from 'react-router-dom'
import type { ReactNode } from 'react'
import { Button as SharedButton, type ButtonProps as SharedButtonProps, type ButtonSize, type ButtonVariant } from '@homisuite/ui'
import { cn } from '@/lib/cn'

// Housekeeping's own `success`/`warning`/`outline` variant names were
// already styled identically to `secondary` in the Tailwind version this
// replaced -- kept here as aliases so existing call sites don't need to
// change, rather than carrying three redundant looks into the shared Button.
type Variant = ButtonVariant | 'success' | 'warning' | 'outline'
type Size = ButtonSize

function resolveVariant(variant: Variant): ButtonVariant {
  return variant === 'success' || variant === 'warning' || variant === 'outline' ? 'secondary' : variant
}

export const Button = forwardRef<HTMLButtonElement, Omit<SharedButtonProps, 'variant' | 'size'> & { variant?: Variant; size?: Size }>(
  // Housekeeping's own default was always `primary` (every bare <Button>
  // across the module -- submit actions, mainly -- relies on that), unlike
  // @homisuite/ui's own default of `secondary`.
  function Button({ variant = 'primary', size = 'md', ...props }, ref) {
    return <SharedButton ref={ref} variant={resolveVariant(variant)} size={size} {...props} />
  },
)

export function LinkButton({ to, variant = 'primary', size = 'md', className, children }: { to: string; variant?: Variant; size?: Size; className?: string; children: ReactNode }) {
  return <Link to={to} className={cn('btn', `btn-${resolveVariant(variant)}`, size === 'sm' ? 'btn-size-sm' : null, className)}>{children}</Link>
}
