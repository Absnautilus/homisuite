import { useEffect, useId, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { Check, ChevronDown } from 'lucide-react'
import { getShiftPortalTarget } from './portal-target'

export interface ShiftSelectOption { value: string; label: string; shortLabel?: string; color?: string; textColor?: string }

export function ShiftSelect({ value, options, onChange, ariaLabel, disabled = false, compact = false, extraAction, onOpenChange }: {
  value: string
  options: ShiftSelectOption[]
  onChange: (value: string) => void
  ariaLabel: string
  disabled?: boolean
  compact?: boolean
  extraAction?: { label: string; icon?: ReactNode; onSelect: () => void }
  onOpenChange?: (open: boolean) => void
}) {
  const id = useId()
  const [open, setOpen] = useState(false)
  const [activeIndex, setActiveIndex] = useState(0)
  const [menuStyle, setMenuStyle] = useState<CSSProperties>({})
  const triggerRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const optionRefs = useRef<Array<HTMLButtonElement | null>>([])
  const selectedIndex = Math.max(0, options.findIndex((option) => option.value === value))
  const selected = options[selectedIndex]

  function positionMenu() {
    const rect = triggerRef.current?.getBoundingClientRect()
    if (!rect) return
    const width = Math.max(rect.width, 180)
    const left = Math.min(rect.left, window.innerWidth - width - 12)
    const gap = 7
    const margin = 12
    const spaceBelow = window.innerHeight - rect.bottom - gap - margin
    const spaceAbove = rect.top - gap - margin
    // The option list can run to 15+ entries, far taller than most phone
    // viewports have room for below the trigger -- without a clamp it just
    // grows past the screen edge with no way to reach the rest. Flip it
    // above the trigger when that side has more room, and always cap it to
    // whichever side it ends up on so it scrolls internally instead.
    const openUpward = spaceBelow < 160 && spaceAbove > spaceBelow
    const maxHeight = Math.max(120, openUpward ? spaceAbove : spaceBelow)
    setMenuStyle({
      left: Math.max(margin, left),
      width,
      maxHeight,
      ...(openUpward ? { bottom: window.innerHeight - rect.top + gap } : { top: rect.bottom + gap }),
    })
  }

  function showMenu() {
    if (disabled) return
    positionMenu()
    setActiveIndex(selectedIndex)
    setOpen(true)
    onOpenChange?.(true)
  }

  useEffect(() => {
    if (!open) return
    optionRefs.current[activeIndex]?.focus()
    function closeOnOutside(event: PointerEvent) {
      const target = event.target as Node
      if (!triggerRef.current?.contains(target) && !menuRef.current?.contains(target)) { setOpen(false); onOpenChange?.(false) }
    }
    // Scroll listens in the capture phase so it also sees scrolling inside
    // any ancestor container (the grid's own scroll wrapper), which could
    // otherwise leave the menu positioned against a trigger that's since
    // moved off-screen. But capture-phase scroll events also fire for the
    // menu's OWN internal scrolling (it's a scrollable list, e.g. finding
    // "Ferie" further down) -- without excluding those, scrolling the menu
    // to reach an option closed it before the option could be clicked.
    function closeOnViewportChange(event: Event) {
      if (menuRef.current?.contains(event.target as Node)) return
      setOpen(false)
      onOpenChange?.(false)
    }
    document.addEventListener('pointerdown', closeOnOutside)
    window.addEventListener('resize', closeOnViewportChange)
    window.addEventListener('scroll', closeOnViewportChange, true)
    return () => {
      document.removeEventListener('pointerdown', closeOnOutside)
      window.removeEventListener('resize', closeOnViewportChange)
      window.removeEventListener('scroll', closeOnViewportChange, true)
    }
  }, [activeIndex, open, onOpenChange])

  function focusOption(index: number) {
    const next = (index + options.length) % options.length
    setActiveIndex(next)
    optionRefs.current[next]?.focus()
  }

  function choose(nextValue: string) {
    onChange(nextValue)
    setOpen(false)
    onOpenChange?.(false)
    requestAnimationFrame(() => triggerRef.current?.focus())
  }

  return <div className={`shift-custom-select${open ? ' is-open' : ''}${compact ? ' is-compact' : ''}`}>
    <button ref={triggerRef} className="shift-custom-select-trigger" type="button" disabled={disabled} aria-label={ariaLabel} aria-haspopup="listbox" aria-expanded={open} aria-controls={`${id}-menu`} onClick={() => { if (open) { setOpen(false); onOpenChange?.(false) } else showMenu() }} onKeyDown={(event) => {
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); showMenu() }
    }}><span className="shift-select-value">{compact ? <b className="shift-select-code" style={{ background: selected?.color, color: selected?.color ? (selected.textColor ?? '#fff') : undefined }}>{selected?.value ? (selected.shortLabel ?? selected.value) : ''}</b> : <span>{selected?.label ?? '—'}</span>}</span><ChevronDown size={16} aria-hidden="true" /></button>
    {open ? createPortal(<div ref={menuRef} id={`${id}-menu`} className="shift-custom-select-menu" role="listbox" aria-label={ariaLabel} style={menuStyle}>
      {extraAction ? <button type="button" className="shift-select-extra-action" onClick={() => { extraAction.onSelect(); setOpen(false); onOpenChange?.(false); requestAnimationFrame(() => triggerRef.current?.focus()) }}><span>{extraAction.icon}{extraAction.label}</span></button> : null}
      {options.map((option, index) => <button ref={(element) => { optionRefs.current[index] = element }} type="button" role="option" aria-selected={option.value === value} className={option.value === value ? 'is-selected' : undefined} key={option.value} onClick={() => choose(option.value)} onMouseEnter={() => setActiveIndex(index)} onKeyDown={(event) => {
        if (event.key === 'ArrowDown') { event.preventDefault(); focusOption(activeIndex + 1) }
        if (event.key === 'ArrowUp') { event.preventDefault(); focusOption(activeIndex - 1) }
        if (event.key === 'Home') { event.preventDefault(); focusOption(0) }
        if (event.key === 'End') { event.preventDefault(); focusOption(options.length - 1) }
        if (event.key === 'Escape' || event.key === 'Tab') { if (event.key === 'Escape') event.preventDefault(); setOpen(false); triggerRef.current?.focus() }
      }}><span className="shift-select-option-copy">{option.color ? <b className="shift-select-code" style={{ background: option.color, color: option.textColor ?? '#fff' }}>{option.shortLabel ?? option.value}</b> : null}<span>{option.label}</span></span>{option.value === value ? <Check size={16} aria-hidden="true" /> : null}</button>)}
    </div>, getShiftPortalTarget()) : null}
  </div>
}
