import { Check } from 'lucide-react'
import './checkbox.css'

export interface CheckboxProps {
  checked: boolean
  onCheckedChange: (checked: boolean) => void
  disabled?: boolean
  id?: string
  className?: string
  'aria-label'?: string
  'aria-describedby'?: string
}

// The square counterpart to Toggle -- for a multi-select list (pick any
// number of these days/options) rather than a single on/off preference,
// where a checkbox reads as the right shape and a switch would not. Render
// it inside a <label htmlFor={id}> for a composite clickable row: <button>
// is a labelable element, so clicking the label's own text still toggles it.
export function Checkbox({ checked, onCheckedChange, disabled = false, id, className, ...aria }: CheckboxProps) {
  return (
    <button
      id={id}
      type="button"
      role="checkbox"
      aria-checked={checked}
      disabled={disabled}
      data-checked={checked ? 'true' : 'false'}
      onClick={() => onCheckedChange(!checked)}
      className={['ui-checkbox', className].filter(Boolean).join(' ')}
      {...aria}
    >
      {checked ? <Check size={13} strokeWidth={3} aria-hidden="true" /> : null}
    </button>
  )
}
