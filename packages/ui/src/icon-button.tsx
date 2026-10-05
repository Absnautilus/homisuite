import type { ButtonHTMLAttributes, ComponentType } from 'react'
import './icon-button.css'

export type IconButtonTone = 'neutral' | 'hintPositive' | 'hintCaution' | 'ok' | 'warning' | 'danger'

export interface IconButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> {
  tone: IconButtonTone
  label: string
  icon: ComponentType<{ className?: string }>
  /** Solid accent fill instead of the usual transparent, hover-only tone -- reserved for the one primary action on a row (e.g. claim/complete). Always renders in the brand accent regardless of `tone`. */
  filled?: boolean
  /** A toggle that's currently "on" (e.g. urgent flagged) -- uses the tone's own soft color, not the brand accent, so a danger-toned toggle reads as a warning, not as "the primary action". Ignored when `filled` is also set. */
  active?: boolean
  /** 'circle' is reserved the same way `filled` is -- a row's one primary CTA, never the quiet secondary icons next to it. */
  shape?: 'square' | 'circle'
  size?: 'md' | 'lg'
}

// Matches the Shell's own row-action buttons (apps/web's .row-action):
// transparent, borderless, muted at rest -- only the hover color carries the
// tone's semantic hint, so a row never reads like a traffic light. Ported
// from Housekeeping's own components/ui/icon-button.tsx verbatim (same
// tone/filled/active/shape vocabulary) so both now render through one
// component instead of two independent copies of the same design.
export function IconButton({
  tone,
  label,
  icon: Icon,
  filled = false,
  active = false,
  shape = 'square',
  size = 'md',
  className,
  disabled,
  ...rest
}: IconButtonProps) {
  const classes = [
    'ui-icon-btn',
    `ui-icon-btn-${size}`,
    shape === 'circle' ? 'is-circle' : null,
    filled ? 'is-filled' : active ? `is-active tone-${tone}` : `tone-${tone}`,
    className,
  ].filter(Boolean).join(' ')
  return (
    <button type="button" aria-label={label} disabled={disabled} className={classes} {...rest}>
      <Icon className="ui-icon-btn-icon" />
    </button>
  )
}
