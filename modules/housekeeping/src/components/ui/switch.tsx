import { useId, type ReactNode } from 'react'
import { Toggle } from '@homisuite/ui'
import { cn } from '@/lib/cn'

interface SwitchControlProps {
  checked: boolean
  onCheckedChange: (checked: boolean) => void
  disabled?: boolean
  id?: string
  className?: string
  'aria-label'?: string
  'aria-describedby'?: string
}

// The bare toggle -- no label/description row. Used standalone (e.g. a
// table cell where the row's own name column already labels it) and as the
// control inside Switch below, so both share one visual implementation.
export function SwitchControl({ className, ...props }: SwitchControlProps) {
  return <Toggle className={className} {...props} />
}

interface SwitchProps {
  checked: boolean
  onCheckedChange: (checked: boolean) => void
  label: ReactNode
  description?: ReactNode
  disabled?: boolean
  id?: string
  className?: string
}

/**
 * Canonical Hotsflow boolean setting.
 * Use for persistent on/off configuration; use Checkbox for selection tasks.
 */
export function Switch({
  checked,
  onCheckedChange,
  label,
  description,
  disabled = false,
  id,
  className,
}: SwitchProps) {
  const generatedId = useId()
  const controlId = id ?? generatedId
  const descriptionId = description ? `${controlId}-description` : undefined

  return (
    <div className={cn('flex min-h-11 items-center justify-between gap-4 rounded-sm border border-line bg-surface px-3 py-2.5', className)}>
      <div className="min-w-0">
        <label htmlFor={controlId} className="block cursor-pointer text-sm font-medium text-foreground">
          {label}
        </label>
        {description && (
          <p id={descriptionId} className="mt-0.5 text-xs leading-5 text-muted">
            {description}
          </p>
        )}
      </div>
      <SwitchControl checked={checked} onCheckedChange={onCheckedChange} disabled={disabled} id={controlId} aria-describedby={descriptionId} />
    </div>
  )
}
