import { useEffect, useId, useRef, useState, type CSSProperties } from 'react'
import { createPortal } from 'react-dom'
import { Check, ChevronDown } from 'lucide-react'
import { getShiftPortalTarget } from './portal-target'

export interface ShiftSelectOption { value: string; label: string; shortLabel?: string; color?: string; textColor?: string }

export function ShiftSelect({ value, options, onChange, ariaLabel, disabled = false, compact = false }: {
  value: string
  options: ShiftSelectOption[]
  onChange: (value: string) => void
  ariaLabel: string
  disabled?: boolean
  compact?: boolean
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
    setMenuStyle({ left: Math.max(12, left), top: rect.bottom + 7, width })
  }

  function showMenu() {
    if (disabled) return
    positionMenu()
    setActiveIndex(selectedIndex)
    setOpen(true)
  }

  useEffect(() => {
    if (!open) return
    optionRefs.current[activeIndex]?.focus()
    function closeOnOutside(event: PointerEvent) {
      const target = event.target as Node
      if (!triggerRef.current?.contains(target) && !menuRef.current?.contains(target)) setOpen(false)
    }
    function closeOnViewportChange() { setOpen(false) }
    document.addEventListener('pointerdown', closeOnOutside)
    window.addEventListener('resize', closeOnViewportChange)
    window.addEventListener('scroll', closeOnViewportChange, true)
    return () => {
      document.removeEventListener('pointerdown', closeOnOutside)
      window.removeEventListener('resize', closeOnViewportChange)
      window.removeEventListener('scroll', closeOnViewportChange, true)
    }
  }, [activeIndex, open])

  function focusOption(index: number) {
    const next = (index + options.length) % options.length
    setActiveIndex(next)
    optionRefs.current[next]?.focus()
  }

  function choose(nextValue: string) {
    onChange(nextValue)
    setOpen(false)
    requestAnimationFrame(() => triggerRef.current?.focus())
  }

  return <div className={`shift-custom-select${open ? ' is-open' : ''}${compact ? ' is-compact' : ''}`}>
    <button ref={triggerRef} className="shift-custom-select-trigger" type="button" disabled={disabled} aria-label={ariaLabel} aria-haspopup="listbox" aria-expanded={open} aria-controls={`${id}-menu`} onClick={() => open ? setOpen(false) : showMenu()} onKeyDown={(event) => {
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); showMenu() }
    }}><span className="shift-select-value">{compact ? <b className="shift-select-code" style={{ background: selected?.color, color: selected?.color ? (selected.textColor ?? '#fff') : undefined }}>{selected?.value ? (selected.shortLabel ?? selected.value) : ''}</b> : <span>{selected?.label ?? '—'}</span>}</span><ChevronDown size={16} aria-hidden="true" /></button>
    {open ? createPortal(<div ref={menuRef} id={`${id}-menu`} className="shift-custom-select-menu" role="listbox" aria-label={ariaLabel} style={menuStyle}>
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
