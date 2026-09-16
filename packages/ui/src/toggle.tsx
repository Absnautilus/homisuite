import { useState } from 'react'
import './toggle.css'

export interface ToggleProps {
  checked: boolean
  onCheckedChange: (checked: boolean) => void
  disabled?: boolean
  id?: string
  className?: string
  'aria-label'?: string
  'aria-describedby'?: string
}

// The bare on/off control -- no label/description row, callers compose
// their own layout around it (a table cell, a settings row, ...). `isInit`
// gates the CSS animation so a toggle rendered already-on from server data
// doesn't play the "turning on" bounce on mount -- only a real click does.
export function Toggle({ checked, onCheckedChange, disabled = false, id, className, ...aria }: ToggleProps) {
  const [isInit, setIsInit] = useState(false)

  return (
    <button
      id={id}
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      data-checked={checked ? 'true' : 'false'}
      onClick={() => {
        setIsInit(true)
        onCheckedChange(!checked)
      }}
      className={['ui-toggle', isInit && 'ui-toggle-init', className].filter(Boolean).join(' ')}
      {...aria}
    >
      <span aria-hidden="true" className="ui-toggle-thumb" />
    </button>
  )
}
