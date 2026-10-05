import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { createPortal } from 'react-dom'
import { cn } from '@/lib/cn'
import { getHkPortalTarget } from '@/lib/portal-target'
import { useLocale } from '@/lib/i18n/locale-context'
import type { RequestCategoryAdmin, RequestTypeAdmin } from '@/lib/admin-api'

const controlClass = 'w-full min-h-11 rounded-sm border-[1.5px] border-line-strong bg-surface px-3 text-base text-foreground outline-none transition-[border-color,box-shadow] focus:border-accent focus:ring-3 focus:ring-accent-soft disabled:bg-surface-2 disabled:opacity-45'

const PANEL_MAX_HEIGHT = 260
const PANEL_GAP = 6

interface PanelPosition {
  left: number
  width: number
  top: number | 'auto'
  bottom: number | 'auto'
  maxHeight: number
}

function computePanelPosition(trigger: HTMLElement): PanelPosition {
  const rect = trigger.getBoundingClientRect()
  const spaceBelow = window.innerHeight - rect.bottom
  const spaceAbove = rect.top
  const openUpward = spaceBelow < PANEL_MAX_HEIGHT + PANEL_GAP && spaceAbove > spaceBelow
  const available = Math.max(72, (openUpward ? spaceAbove : spaceBelow) - PANEL_GAP - 8)
  const maxHeight = Math.min(PANEL_MAX_HEIGHT, available)
  return openUpward
    ? { left: rect.left, width: rect.width, top: 'auto', bottom: window.innerHeight - rect.top + PANEL_GAP, maxHeight }
    : { left: rect.left, width: rect.width, top: rect.bottom + PANEL_GAP, bottom: 'auto', maxHeight }
}

function itemName(item: RequestTypeAdmin, locale: string): string {
  return item.name_i18n?.[locale] || item.name
}

function categoryName(category: RequestCategoryAdmin, locale: string): string {
  return category.name_i18n?.[locale] || category.name
}

// A text field with suggestions instead of two cascading <select>s
// (category, then item) to scroll through -- requested after a hotel
// reported the item list growing past what's comfortable to browse,
// especially on a phone. Every active item across every category is a
// candidate, sorted alphabetically by name with its category shown as a
// secondary line so it's still clear what it belongs to; focusing the
// field with nothing typed shows that full alphabetical list (still fully
// browsable, nothing lost), and typing narrows it by name.
export function ItemCombobox({
  id,
  items,
  categories,
  value,
  onChange,
  placeholder,
  required,
  disabled,
}: {
  id?: string
  items: RequestTypeAdmin[]
  categories: RequestCategoryAdmin[]
  value: string
  onChange: (itemId: string) => void
  placeholder?: string
  required?: boolean
  disabled?: boolean
}) {
  const { locale, t } = useLocale()
  const [editing, setEditing] = useState(false)
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const [highlighted, setHighlighted] = useState(0)
  const [panelPosition, setPanelPosition] = useState<PanelPosition | null>(null)
  const rootRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const panelRef = useRef<HTMLUListElement>(null)
  const blurTimeout = useRef<number | undefined>(undefined)

  const categoryById = new Map(categories.map((category) => [category.id, category]))
  function categoryLabelFor(item: RequestTypeAdmin): string {
    const category = categoryById.get(item.category_id)
    return category ? categoryName(category, locale) : ''
  }

  const selected = items.find((item) => item.id === value) ?? null
  const term = query.trim().toLowerCase()
  const sorted = [...items].sort((a, b) => itemName(a, locale).localeCompare(itemName(b, locale), locale))
  const matches = term
    ? sorted.filter((item) => itemName(item, locale).toLowerCase().includes(term) || categoryLabelFor(item).toLowerCase().includes(term))
    : sorted
  const displayValue = editing ? query : selected ? itemName(selected, locale) : ''

  useEffect(() => {
    if (!open) return
    setHighlighted(0)
    function reposition() {
      if (inputRef.current) setPanelPosition(computePanelPosition(inputRef.current))
    }
    reposition()
    window.addEventListener('scroll', reposition, true)
    window.addEventListener('resize', reposition)
    return () => {
      window.removeEventListener('scroll', reposition, true)
      window.removeEventListener('resize', reposition)
    }
  }, [open, query])

  useEffect(() => () => window.clearTimeout(blurTimeout.current), [])

  function openForBrowsing() {
    window.clearTimeout(blurTimeout.current)
    setEditing(true)
    setQuery('')
    setOpen(true)
  }

  function pick(item: RequestTypeAdmin) {
    window.clearTimeout(blurTimeout.current)
    onChange(item.id)
    setEditing(false)
    setQuery('')
    setOpen(false)
  }

  function onBlur() {
    // Deferred so a click on a suggestion (which blurs the input first)
    // still registers before the panel unmounts.
    blurTimeout.current = window.setTimeout(() => {
      setEditing(false)
      setQuery('')
      setOpen(false)
    }, 120)
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (!open) {
      if (['ArrowDown', 'ArrowUp', 'Enter'].includes(event.key)) {
        event.preventDefault()
        openForBrowsing()
      }
      return
    }
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setHighlighted((i) => Math.min(matches.length - 1, i + 1))
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      setHighlighted((i) => Math.max(0, i - 1))
    } else if (event.key === 'Enter') {
      event.preventDefault()
      const item = matches[highlighted]
      if (item) pick(item)
    } else if (event.key === 'Escape') {
      event.preventDefault()
      inputRef.current?.blur()
      setEditing(false)
      setQuery('')
      setOpen(false)
    }
  }

  return (
    <div ref={rootRef} className="relative">
      <input
        ref={inputRef}
        id={id}
        type="text"
        required={required}
        disabled={disabled}
        autoComplete="off"
        placeholder={placeholder}
        value={displayValue}
        onChange={(event) => {
          setEditing(true)
          setQuery(event.target.value)
          setOpen(true)
        }}
        onFocus={openForBrowsing}
        onBlur={onBlur}
        onKeyDown={onKeyDown}
        role="combobox"
        aria-expanded={open}
        aria-autocomplete="list"
        className={cn(controlClass, 'h-11')}
      />
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
          {matches.length === 0 ? (
            <li className="px-3 py-2 text-sm text-muted">{t('staff.newRequest.whatEmpty')}</li>
          ) : (
            matches.map((item, index) => (
              <li
                key={item.id}
                role="option"
                aria-selected={item.id === value}
                onMouseEnter={() => setHighlighted(index)}
                onMouseDown={(event) => {
                  event.preventDefault()
                  pick(item)
                }}
                className={cn(
                  'flex cursor-pointer items-baseline justify-between gap-3 rounded-[6px] px-3 py-2 text-sm',
                  index === highlighted ? 'bg-accent-soft font-medium text-accent' : 'text-foreground hover:bg-surface-2',
                )}
              >
                <span>{itemName(item, locale)}</span>
                <span className={cn('shrink-0 text-xs', index === highlighted ? 'text-accent' : 'text-muted')}>{categoryLabelFor(item)}</span>
              </li>
            ))
          )}
        </ul>,
        getHkPortalTarget(),
      )}
    </div>
  )
}
