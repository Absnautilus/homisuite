import { Toggle } from '@homisuite/ui'

export function Switch({
  checked,
  onChange,
  disabled,
  'aria-label': ariaLabel,
}: {
  checked: boolean
  onChange: () => void
  disabled?: boolean
  'aria-label': string
}) {
  return <Toggle checked={checked} onCheckedChange={onChange} disabled={disabled} aria-label={ariaLabel} />
}
