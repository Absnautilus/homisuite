import type { ButtonHTMLAttributes, ComponentType } from 'react'
import { cn } from '@/lib/cn'

type Tone = 'neutral' | 'hintPositive' | 'hintCaution' | 'ok' | 'warning' | 'danger'

// Matches the Hotsflow shell's own row-action buttons (apps/web's
// .row-action): transparent, borderless, 44px, 8px radius, muted at rest --
// only the hover color carries the tone's semantic hint, so a row never
// reads like a traffic light.
const toneHoverClass: Record<Tone, string> = {
  neutral: 'hover:text-accent',
  hintPositive: 'hover:text-ok-ink',
  hintCaution: 'hover:text-terracotta-ink',
  ok: 'hover:text-ok-ink',
  warning: 'hover:text-wait-ink',
  danger: 'hover:text-bad-ink',
}

const sizeClass = {
  md: 'h-11 w-11',
  lg: 'h-14 w-14',
} as const

export function IconButton({
  tone,
  label,
  icon: Icon,
  filled = false,
  shape = 'square',
  size = 'md',
  className,
  ...props
}: {
  tone: Tone
  label: string
  icon: ComponentType<{ className?: string }>
  // Solid bg-accent/text-accent-ink instead of the usual transparent,
  // hover-only tone -- matches button.tsx's own "primary" variant. Reserved
  // for the one or two actions on a row that should read as the primary
  // action (e.g. claim/complete), not a blanket per-tone style: most
  // same-toned icon buttons (e.g. "segna reso") stay the quiet default.
  filled?: boolean
  // 'circle' is reserved the same way 'filled' is -- the row's one primary
  // CTA (claim/complete), never the quiet secondary icons next to it.
  shape?: 'square' | 'circle'
  size?: keyof typeof sizeClass
} & Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'>) {
  return (
    <button
      type="button"
      aria-label={label}
      className={cn(
        'flex shrink-0 cursor-pointer items-center justify-center border-0 transition-colors disabled:cursor-not-allowed disabled:opacity-35',
        sizeClass[size],
        shape === 'circle' ? 'rounded-full' : 'rounded-lg',
        filled ? 'bg-accent text-accent-ink hover:brightness-[1.06] active:brightness-[.92]' : cn('bg-transparent text-muted', toneHoverClass[tone]),
        className,
      )}
      {...props}
    >
      <Icon className={size === 'lg' ? 'h-[18px] w-[18px]' : 'h-[15px] w-[15px]'} />
    </button>
  )
}
