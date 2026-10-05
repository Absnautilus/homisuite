import { useEffect, useRef, useState } from 'react'
import { Clock } from 'lucide-react'
import './time-picker.css'

const HOURS = Array.from({ length: 24 }, (_, i) => String(i).padStart(2, '0'))
const MINUTES = Array.from({ length: 60 }, (_, i) => String(i).padStart(2, '0'))

function parseValue(value: string): { hour: string; minute: string } | null {
  const match = /^(\d{2}):(\d{2})$/.exec(value)
  if (!match) return null
  return { hour: match[1]!, minute: match[2]! }
}

export interface TimePickerProps {
  /** 24h time as HH:mm, or '' for no selection. */
  value: string
  onChange: (value: string) => void
  ariaLabel: string
  id?: string
  disabled?: boolean
}

// The time-of-day counterpart to DatePicker -- no module had a custom one
// before this; every time field was a native <input type="time">, which
// (depending on the browser) pops its own two-column scroll wheel styled
// nothing like the rest of Homisuite. Same trigger/popover shape as
// DatePicker so the two read as one family.
export function TimePicker({ value, onChange, ariaLabel, id, disabled }: TimePickerProps) {
  const parsed = parseValue(value)
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const hourListRef = useRef<HTMLDivElement>(null)
  const minuteListRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const closeOnOutside = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false)
    }
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        setOpen(false)
        requestAnimationFrame(() => triggerRef.current?.focus())
      }
    }
    document.addEventListener('pointerdown', closeOnOutside)
    document.addEventListener('keydown', closeOnEscape)
    // Center the current (or default) selection in each column instead of
    // opening scrolled to 00 -- scanning down from 00 for e.g. 19:30 every
    // time is exactly the friction this is meant to remove.
    const activeHour = hourListRef.current?.querySelector('.is-active') as HTMLElement | null
    activeHour?.scrollIntoView({ block: 'center' })
    const activeMinute = minuteListRef.current?.querySelector('.is-active') as HTMLElement | null
    activeMinute?.scrollIntoView({ block: 'center' })
    return () => {
      document.removeEventListener('pointerdown', closeOnOutside)
      document.removeEventListener('keydown', closeOnEscape)
    }
  }, [open])

  function pick(hour: string, minute: string) {
    onChange(`${hour}:${minute}`)
  }

  return (
    <div className={`ui-time-picker${open ? ' is-open' : ''}`} ref={rootRef}>
      <button
        ref={triggerRef}
        id={id}
        className="ui-time-trigger"
        type="button"
        disabled={disabled}
        aria-label={ariaLabel}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <span className={parsed ? undefined : 'ui-time-placeholder'}>{parsed ? value : '--:--'}</span>
        <Clock size={15} aria-hidden="true" />
      </button>
      {open ? (
        <div className="ui-time-popover" role="dialog" aria-label={ariaLabel}>
          <div className="ui-time-columns">
            <div className="ui-time-column" ref={hourListRef}>
              {HOURS.map((hour) => (
                <button key={hour} type="button" className={hour === parsed?.hour ? 'is-active' : undefined} onClick={() => pick(hour, parsed?.minute ?? '00')}>{hour}</button>
              ))}
            </div>
            <div className="ui-time-column" ref={minuteListRef}>
              {MINUTES.map((minute) => (
                <button key={minute} type="button" className={minute === parsed?.minute ? 'is-active' : undefined} onClick={() => pick(parsed?.hour ?? '00', minute)}>{minute}</button>
              ))}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}
