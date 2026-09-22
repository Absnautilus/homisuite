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

// The soft bg/ink pair each tone already uses for its own status pill
// (StatusBadge, urgent Badge, ...) -- reused here so a *toggled-on* icon
// (e.g. "urgent" flagged) reads with that same semantic color instead of
// inheriting the unrelated "this is the row's primary action" accent used
// by `filled` below.
const activeClass: Record<Tone, string> = {
  neutral: 'bg-accent-soft text-accent',
  hintPositive: 'bg-ok-bg text-ok-ink',
  hintCaution: 'bg-terracotta-bg text-terracotta-ink',
  ok: 'bg-ok-bg text-ok-ink',
  warning: 'bg-wait-bg text-wait-ink',
  danger: 'bg-bad-bg text-bad-ink',
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
  active = false,
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
  // Always renders in the brand accent color regardless of `tone`.
  filled?: boolean
  // A toggle that is currently "on" (e.g. urgent flagged) -- unlike
  // `filled`, this uses the tone's own soft color, not the brand accent, so
  // a danger-toned toggle reads as a warning, not as "the primary action".
  // Ignored when `filled` is also set.
  active?: boolean
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
        filled
          ? 'bg-accent text-accent-ink hover:brightness-[1.06] active:brightness-[.92]'
          : active
            ? cn(activeClass[tone], 'hover:brightness-95')
            : cn('bg-transparent text-muted', toneHoverClass[tone]),
        className,
      )}
      {...props}
    >
      <Icon className={size === 'lg' ? 'h-[18px] w-[18px]' : 'h-[15px] w-[15px]'} />
    </button>
  )
}
