import { Children, isValidElement, useEffect, useLayoutEffect, useMemo, useRef, useState, type ChangeEvent, type InputHTMLAttributes, type KeyboardEvent, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react'
import { createPortal } from 'react-dom'
import { cn } from '@/lib/cn'
import { getHkPortalTarget } from '@/lib/portal-target'

// text-base (16px), not text-sm -- iOS Safari (including installed
// home-screen PWAs, where there's no pinch gesture to zoom back out
// afterward) force-zooms the page on focus for any text input under 16px.
const controlClass = 'w-full min-h-11 rounded-sm border-[1.5px] border-line-strong bg-surface px-3 text-base text-foreground outline-none transition-[border-color,box-shadow] focus:border-accent focus:ring-3 focus:ring-accent-soft disabled:bg-surface-2 disabled:opacity-45'

export function Label({ children, htmlFor, required }: { children: ReactNode; htmlFor?: string; required?: boolean }) {
  return <label htmlFor={htmlFor} className="mb-1.5 block text-[0.65625rem] font-bold uppercase tracking-[.05em] text-muted">{children}{required && <span className="text-bad-ink"> *</span>}</label>
}
export function Input(props: InputHTMLAttributes<HTMLInputElement>) { return <input {...props} className={cn(controlClass, 'h-11', props.className)} /> }
export function Textarea(props: TextareaHTMLAttributes<HTMLTextAreaElement>) { return <textarea {...props} className={cn(controlClass, 'py-2.5', props.className)} /> }

interface SelectOption { value: string; label: ReactNode; disabled: boolean }

const SELECT_PANEL_MAX_HEIGHT = 240
const SELECT_PANEL_GAP = 6
type SelectPanelPosition = { left: number; width: number; top: number | 'auto'; bottom: number | 'auto'; maxHeight: number }

function computeSelectPanelPosition(trigger: HTMLElement): SelectPanelPosition {
  const rect = trigger.getBoundingClientRect()
  const spaceBelow = window.innerHeight - rect.bottom
  const spaceAbove = rect.top
  const openUpward = spaceBelow < SELECT_PANEL_MAX_HEIGHT + SELECT_PANEL_GAP && spaceAbove > spaceBelow
  const available = Math.max(
    72,
    (openUpward ? spaceAbove : spaceBelow) - SELECT_PANEL_GAP - 8,
  )
  const maxHeight = Math.min(SELECT_PANEL_MAX_HEIGHT, available)
  return openUpward
    ? { left: rect.left, width: rect.width, top: 'auto', bottom: window.innerHeight - rect.top + SELECT_PANEL_GAP, maxHeight }
    : { left: rect.left, width: rect.width, top: rect.bottom + SELECT_PANEL_GAP, bottom: 'auto', maxHeight }
}

export function Select({ children, value, onChange, disabled, required, className, id, name }: SelectHTMLAttributes<HTMLSelectElement>) {
  const options = useMemo<SelectOption[]>(() => Children.toArray(children).flatMap((child) => {
    if (!isValidElement<{ value?: string; children?: ReactNode; disabled?: boolean }>(child)) return []
    return [{ value: String(child.props.value ?? ''), label: child.props.children, disabled: Boolean(child.props.disabled) }]
  }), [children])
  const [open, setOpen] = useState(false)
  const [highlighted, setHighlighted] = useState(0)
  const [panelPosition, setPanelPosition] = useState<SelectPanelPosition | null>(null)
  const rootRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const panelRef = useRef<HTMLUListElement>(null)
  const selectedIndex = options.findIndex((o) => o.value === value)
  const selected = selectedIndex >= 0 ? options[selectedIndex] : undefined

  useEffect(() => {
    if (!open) return
    function onPointerDown(e: MouseEvent) {
      const target = e.target as Node
      if (rootRef.current?.contains(target) || panelRef.current?.contains(target)) return
      setOpen(false)
    }
    document.addEventListener('mousedown', onPointerDown)
    return () => document.removeEventListener('mousedown', onPointerDown)
  }, [open])

  useLayoutEffect(() => {
    if (!open || !triggerRef.current) return
    const reposition = () => {
      if (triggerRef.current) setPanelPosition(computeSelectPanelPosition(triggerRef.current))
    }
    reposition()
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
    onChange?.({ target: { value: option.value } } as unknown as ChangeEvent<HTMLSelectElement>)
    setOpen(false)
  }

  function onKeyDown(e: KeyboardEvent<HTMLButtonElement>) {
    if (disabled) return
    if (!open) {
      if (['Enter', ' ', 'ArrowDown', 'ArrowUp'].includes(e.key)) {
        e.preventDefault()
        setHighlighted(selectedIndex >= 0 ? selectedIndex : 0)
        setOpen(true)
      }
      return
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setHighlighted((i) => Math.min(options.length - 1, i + 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setHighlighted((i) => Math.max(0, i - 1))
    } else if (e.key === 'Home') {
      e.preventDefault()
      setHighlighted(0)
    } else if (e.key === 'End') {
      e.preventDefault()
      setHighlighted(options.length - 1)
    } else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      commit(highlighted)
    } else if (e.key === 'Escape' || e.key === 'Tab') {
      setOpen(false)
    }
  }

  const placeholder = !selected || selected.disabled || selected.value === ''

  return (
    <div ref={rootRef} className="relative">
      {name && <input type="hidden" name={name} value={String(value ?? '')} required={required} disabled={disabled} />}
      <button
        ref={triggerRef}
        type="button"
        id={id}
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-required={required}
        onClick={() => {
          if (disabled) return
          setHighlighted(selectedIndex >= 0 ? selectedIndex : 0)
          setOpen((o) => !o)
        }}
        onKeyDown={onKeyDown}
        className={cn(controlClass, 'flex h-11 cursor-pointer items-center justify-between gap-2 text-left disabled:cursor-not-allowed', className)}
      >
        <span className={cn('truncate', placeholder && 'text-muted')}>{selected?.label ?? ' '}</span>
        <ChevronDownIcon className={cn('h-4 w-4 shrink-0 text-muted transition-transform', open && 'rotate-180')} />
      </button>
      {open && panelPosition && createPortal(
        <ul
          ref={panelRef}
          role="listbox"
          className="max-h-60 overflow-auto rounded-sm border border-line bg-surface p-1 shadow-lg"
          style={{
            position: 'fixed',
            left: panelPosition.left,
            width: panelPosition.width,
            top: panelPosition.top,
            bottom: panelPosition.bottom,
            right: 'auto',
            maxHeight: panelPosition.maxHeight,
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
              onMouseDown={(event) => {
                event.preventDefault()
                commit(index)
              }}
              className={cn(
                'rounded-[6px] px-3 py-2 text-sm',
                option.disabled
                  ? 'cursor-not-allowed text-muted'
                  : cn('cursor-pointer', index === highlighted ? 'bg-accent-soft font-medium text-accent' : 'text-foreground hover:bg-surface-2'),
              )}
            >
              {option.label}
            </li>
          ))}
        </ul>,
        getHkPortalTarget(),
      )}
    </div>
  )
}
function ChevronDownIcon(props: { className?: string }) { return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={props.className}><path d="m6 9 6 6 6-6" /></svg> }
export function FieldError({ children }: { children?: string }) { if (!children) return null; return <p className="mt-1 text-xs font-semibold text-bad-ink">{children}</p> }
export function FieldGroup({ children, className }: { children: ReactNode; className?: string }) { return <div className={cn('mb-4', className)}>{children}</div> }
