import { useEffect, useMemo, useRef, useState } from 'react'
import { CalendarDays } from 'lucide-react'
import './date-picker.css'

const MONTHS = ['gennaio', 'febbraio', 'marzo', 'aprile', 'maggio', 'giugno', 'luglio', 'agosto', 'settembre', 'ottobre', 'novembre', 'dicembre']
const WEEKDAYS = ['lu', 'ma', 'me', 'gi', 've', 'sa', 'do']

function parseIso(value: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (!match) return null
  const [, year, month, day] = match
  return new Date(Number(year), Number(month) - 1, Number(day))
}
function toIso(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}
function formatDisplay(date: Date): string {
  return new Intl.DateTimeFormat('it-IT', { day: '2-digit', month: '2-digit', year: 'numeric' }).format(date)
}

export interface DatePickerProps {
  /** ISO date (YYYY-MM-DD), or '' for no selection. */
  value: string
  onChange: (value: string) => void
  ariaLabel: string
  id?: string
  disabled?: boolean
}

// The one calendar widget for every module -- replaces the native
// <input type="date">, which renders as a different OS/browser-styled
// control on every platform, and the two independent hand-rolled
// reimplementations this replaced (Turni's ShiftDatePicker, Housekeeping's
// DateTimePicker). Colors come from each consumer's own theme tokens, with
// a light/dark-agnostic fallback baked in, same convention as Modal/Toast.
export function DatePicker({ value, onChange, ariaLabel, id, disabled }: DatePickerProps) {
  const selected = parseIso(value)
  const [open, setOpen] = useState(false)
  const [visible, setVisible] = useState(() => selected ?? new Date())
  const rootRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const dayRefs = useRef<Record<string, HTMLButtonElement | null>>({})

  useEffect(() => {
    if (selected) setVisible(selected)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value])

  function dismiss() {
    setOpen(false)
    requestAnimationFrame(() => triggerRef.current?.focus())
  }

  useEffect(() => {
    if (!open) return
    const closeOnOutside = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false)
    }
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        dismiss()
      }
    }
    document.addEventListener('pointerdown', closeOnOutside)
    document.addEventListener('keydown', closeOnEscape)
    const focusTarget = (value && dayRefs.current[value]) || dayRefs.current[toIso(new Date())]
    focusTarget?.focus()
    return () => {
      document.removeEventListener('pointerdown', closeOnOutside)
      document.removeEventListener('keydown', closeOnEscape)
    }
  }, [open, value])

  const cells = useMemo(() => {
    const year = visible.getFullYear()
    const month = visible.getMonth()
    const first = (new Date(year, month, 1).getDay() + 6) % 7
    const days = new Date(year, month + 1, 0).getDate()
    const previous = new Date(year, month, 0).getDate()
    return Array.from({ length: 42 }, (_, index) => {
      const relative = index - first + 1
      if (relative < 1) return { date: new Date(year, month - 1, previous + relative), outside: true }
      if (relative > days) return { date: new Date(year, month + 1, relative - days), outside: true }
      return { date: new Date(year, month, relative), outside: false }
    })
  }, [visible])

  function choose(date: Date) {
    onChange(toIso(date))
    setVisible(new Date(date.getFullYear(), date.getMonth(), 1))
    setOpen(false)
    requestAnimationFrame(() => triggerRef.current?.focus())
  }

  return (
    <div className={`ui-date-picker${open ? ' is-open' : ''}`} ref={rootRef}>
      <button
        ref={triggerRef}
        id={id}
        className="ui-date-trigger"
        type="button"
        disabled={disabled}
        aria-label={ariaLabel}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <span className={selected ? undefined : 'ui-date-placeholder'}>{selected ? formatDisplay(selected) : 'gg/mm/aaaa'}</span>
        <CalendarDays size={15} aria-hidden="true" />
      </button>
      {open ? (
        <div className="ui-date-popover" role="dialog" aria-label={ariaLabel}>
          <div className="ui-date-head">
            <strong>{MONTHS[visible.getMonth()]} {visible.getFullYear()}</strong>
            <span>
              <button type="button" aria-label="Mese precedente" onClick={() => setVisible((d) => new Date(d.getFullYear(), d.getMonth() - 1, 1))}>‹</button>
              <button type="button" aria-label="Mese successivo" onClick={() => setVisible((d) => new Date(d.getFullYear(), d.getMonth() + 1, 1))}>›</button>
            </span>
          </div>
          <div className="ui-date-grid">
            {WEEKDAYS.map((day) => <b key={day}>{day}</b>)}
            {cells.map(({ date, outside }) => {
              const iso = toIso(date)
              const active = iso === value
              const today = iso === toIso(new Date())
              return (
                <button
                  key={iso}
                  ref={(element) => { dayRefs.current[iso] = element }}
                  type="button"
                  className={`${outside ? ' is-outside' : ''}${active ? ' is-selected' : ''}${today ? ' is-today' : ''}`}
                  onClick={() => choose(date)}
                >
                  {date.getDate()}
                </button>
              )
            })}
          </div>
          <div className="ui-date-footer">
            <button type="button" onClick={dismiss}>Cancella</button>
            <button type="button" onClick={() => choose(new Date())}>Oggi</button>
          </div>
        </div>
      ) : null}
    </div>
  )
}
