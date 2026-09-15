import { Children, isValidElement, useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type OptionHTMLAttributes, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { Check, ChevronDown } from 'lucide-react'

// Fixed-position + portaled to <body>, computed from the trigger's own
// viewport rect -- not just an absolutely-positioned child of .select-root.
// A plain absolute panel gets clipped by any scrollable/overflow:hidden
// ancestor (e.g. .modal-panel, which scrolls internally and is exactly
// where this showed up: "Mansione" cut off mid-list inside the Team
// modal). Flips above the trigger when there isn't enough room below.
const PANEL_MAX_HEIGHT = 240
const PANEL_GAP = 6

// top/bottom are always both present (one numeric, one 'auto') -- .select-panel's
// own CSS sets `top: calc(100% + 6px)`, so leaving one of them as `undefined`
// (React then omits the inline property) would NOT cancel that rule: the fixed
// element ends up constrained between the CSS class's `top` and our inline
// `bottom`, collapsing its height instead of anchoring from one edge only.
type PanelPosition = { left: number; width: number; top: number | 'auto'; bottom: number | 'auto' }

function computePanelPosition(trigger: HTMLElement): PanelPosition {
  const rect = trigger.getBoundingClientRect()
  const spaceBelow = window.innerHeight - rect.bottom
  const spaceAbove = rect.top
  const openUpward = spaceBelow < PANEL_MAX_HEIGHT + PANEL_GAP && spaceAbove > spaceBelow
  return openUpward
    ? { left: rect.left, width: rect.width, top: 'auto', bottom: window.innerHeight - rect.top + PANEL_GAP }
    : { left: rect.left, width: rect.width, top: rect.bottom + PANEL_GAP, bottom: 'auto' }
}

interface SelectOptionProps extends OptionHTMLAttributes<HTMLOptionElement> {
  value: string
  children?: ReactNode
}

// Custom listbox so the open list matches the app's own styling instead of
// the browser/OS-rendered native <select> popup (see Team's "Mansione" bug).
// Accepts <option> children like a native select so call sites barely
// change, and renders a hidden input under `name` so it still participates
// in FormData-based form submission the same way a native select would.
export function Select({
  id,
  name,
  value,
  onChange,
  disabled,
  required,
  children,
}: {
  id?: string
  name: string
  value: string
  onChange: (value: string) => void
  disabled?: boolean
  required?: boolean
  children: ReactNode
}) {
  const options = useMemo(
    () =>
      Children.toArray(children).flatMap((child) => {
        if (!isValidElement<SelectOptionProps>(child)) return []
        return [{ value: child.props.value, label: child.props.children, disabled: Boolean(child.props.disabled) }]
      }),
    [children],
  )
  const [open, setOpen] = useState(false)
  const [highlighted, setHighlighted] = useState(0)
  const [panelPosition, setPanelPosition] = useState<PanelPosition | null>(null)
  const rootRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const panelRef = useRef<HTMLUListElement>(null)
  const selectedIndex = options.findIndex((option) => option.value === value)
  const selected = selectedIndex >= 0 ? options[selectedIndex] : undefined

  useEffect(() => {
    if (!open) return
    function onPointerDown(event: MouseEvent) {
      const target = event.target as Node
      if (rootRef.current?.contains(target)) return
      if (panelRef.current?.contains(target)) return
      setOpen(false)
    }
    document.addEventListener('mousedown', onPointerDown)
    return () => document.removeEventListener('mousedown', onPointerDown)
  }, [open])

  useLayoutEffect(() => {
    if (!open || !triggerRef.current) return
    setPanelPosition(computePanelPosition(triggerRef.current))
    function reposition() {
      if (triggerRef.current) setPanelPosition(computePanelPosition(triggerRef.current))
    }
    // capture: true also catches scroll on a nested scrollable ancestor
    // (e.g. .modal-panel itself), not just the window.
    window.addEventListener('scroll', reposition, true)
    window.addEventListener('resize', reposition)
    return () => {
      window.removeEventListener('scroll', reposition, true)
      window.removeEventListener('resize', reposition)
    }
  }, [open])

  function commit(index: number) {
    const option = options[index]
    if (!option || option.disabled) return
    onChange(option.value)
    setOpen(false)
  }

  function onKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    if (disabled) return
    if (!open) {
      if (['Enter', ' ', 'ArrowDown', 'ArrowUp'].includes(event.key)) {
        event.preventDefault()
        setHighlighted(selectedIndex >= 0 ? selectedIndex : 0)
        setOpen(true)
      }
      return
    }
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setHighlighted((index) => Math.min(options.length - 1, index + 1))
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      setHighlighted((index) => Math.max(0, index - 1))
    } else if (event.key === 'Home') {
      event.preventDefault()
      setHighlighted(0)
    } else if (event.key === 'End') {
      event.preventDefault()
      setHighlighted(options.length - 1)
    } else if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      commit(highlighted)
    } else if (event.key === 'Escape' || event.key === 'Tab') {
      setOpen(false)
    }
  }

  return (
    <div ref={rootRef} className="select-root">
      <input type="hidden" name={name} value={value} required={required} disabled={disabled} />
      <button
        ref={triggerRef}
        type="button"
        id={id}
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => {
          if (disabled) return
          setHighlighted(selectedIndex >= 0 ? selectedIndex : 0)
          setOpen((value) => !value)
        }}
        onKeyDown={onKeyDown}
        className="select-trigger"
      >
        <span>{selected?.label ?? ''}</span>
        <ChevronDown size={16} className={open ? 'rotate' : undefined} aria-hidden="true" />
      </button>
      {open && panelPosition && createPortal(
        <ul
          ref={panelRef}
          role="listbox"
          className="select-panel"
          style={{
            position: 'fixed',
            left: panelPosition.left,
            width: panelPosition.width,
            top: panelPosition.top,
            bottom: panelPosition.bottom,
            right: 'auto',
            zIndex: 1000,
          }}
        >
          {options.map((option, index) => (
            <li
              key={option.value}
              role="option"
              aria-selected={option.value === value}
              aria-disabled={option.disabled}
              onMouseEnter={() => setHighlighted(index)}
              onMouseDown={(event) => { event.preventDefault(); commit(index) }}
              className={`select-option${option.disabled ? ' disabled' : ''}${index === highlighted ? ' highlighted' : ''}`}
            >
              <span>{option.label}</span>
              {option.value === value && <Check size={14} aria-hidden="true" />}
            </li>
          ))}
        </ul>,
        document.body,
      )}
    </div>
  )
}
