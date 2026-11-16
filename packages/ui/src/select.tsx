import { useEffect, useRef, useState } from 'react'
import { Check, ChevronDown } from 'lucide-react'
import './select.css'

export interface SelectOption<T extends string> {
  value: T
  label: string
}

export interface SelectProps<T extends string> {
  value: T
  options: Array<SelectOption<T>>
  onChange: (value: T) => void
  disabled?: boolean
  id?: string
  'aria-label'?: string
}

// A single-select dropdown with its own trigger + list, not the bare
// browser <select> (whose open list keeps the OS's own look on most
// platforms, with no way to restyle it to match the rest of the app).
// Same outside-click/Escape-to-close behavior as the shifts module's
// local ToolbarMenu, generalized here so any app in the suite can reach
// for one value-picker instead of growing its own.
export function Select<T extends string>({ value, options, onChange, disabled = false, id, ...aria }: SelectProps<T>) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const current = options.find((option) => option.value === value)

  useEffect(() => {
    if (!open) return
    function closeOnOutsideClick(event: PointerEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false)
    }
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('pointerdown', closeOnOutsideClick)
    document.addEventListener('keydown', closeOnEscape)
    return () => {
      document.removeEventListener('pointerdown', closeOnOutsideClick)
      document.removeEventListener('keydown', closeOnEscape)
    }
  }, [open])

  return (
    <div className="ui-select" ref={rootRef}>
      <button
        type="button"
        id={id}
        className="ui-select-trigger"
        aria-haspopup="listbox"
        aria-expanded={open}
        disabled={disabled}
        onClick={() => setOpen((next) => !next)}
        {...aria}
      >
        <span>{current?.label ?? value}</span>
        <ChevronDown size={14} />
      </button>
      {open ? (
        <div className="ui-select-list" role="listbox" aria-label={aria['aria-label']}>
          {options.map((option) => (
            <button
              key={option.value}
              type="button"
              role="option"
              aria-selected={option.value === value}
              className={option.value === value ? 'is-selected' : undefined}
              onClick={() => {
                onChange(option.value)
                setOpen(false)
              }}
            >
              <span>{option.label}</span>
              {option.value === value ? <Check size={14} /> : null}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  )
}
