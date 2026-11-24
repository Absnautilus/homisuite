import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { createPortal } from 'react-dom'
import { cn } from '@/lib/cn'
import { getHkPortalTarget } from '@/lib/portal-target'
import { useLocale } from '@/lib/i18n/locale-context'
import type { Room } from '@/lib/admin-api'

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

// Same text-field-with-suggestions pattern as ItemCombobox, simplified for
// a flat Room[] (no category grouping) matched by room_number -- typing
// digits narrows the list instead of scrolling a <select> that grows with
// every room the hotel has.
export function RoomCombobox({
  id,
  rooms,
  value,
  onChange,
  placeholder,
  required,
  disabled,
}: {
  id?: string
  rooms: Room[]
  value: string
  onChange: (roomId: string) => void
  placeholder?: string
  required?: boolean
  disabled?: boolean
}) {
  const { t } = useLocale()
  const [editing, setEditing] = useState(false)
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const [highlighted, setHighlighted] = useState(0)
  const [panelPosition, setPanelPosition] = useState<PanelPosition | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const panelRef = useRef<HTMLUListElement>(null)
  const blurTimeout = useRef<number | undefined>(undefined)

  const selected = rooms.find((room) => room.id === value) ?? null
  const term = query.trim().toLowerCase()
  const sorted = [...rooms].sort((a, b) => a.room_number.localeCompare(b.room_number, undefined, { numeric: true }))
  const matches = term ? sorted.filter((room) => room.room_number.toLowerCase().includes(term)) : sorted
  const displayValue = editing ? query : selected ? selected.room_number : ''

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
    // Prefilled with the current room (not blanked to the placeholder) and
    // selected outright -- clicking a field that already has a value used
    // to wipe it to "Scrivi il numero", which read as the room number
    // vanishing and left nothing on screen to backspace. Selecting it means
    // typing a digit replaces it in one go, same as a plain text field, and
    // a bare Backspace clears it.
    setQuery(selected ? selected.room_number : '')
    setOpen(true)
    inputRef.current?.select()
  }

  function pick(room: Room) {
    window.clearTimeout(blurTimeout.current)
    onChange(room.id)
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
      const room = matches[highlighted]
      if (room) pick(room)
    } else if (event.key === 'Escape') {
      event.preventDefault()
      inputRef.current?.blur()
      setEditing(false)
      setQuery('')
      setOpen(false)
    }
  }

  return (
    <div className="relative">
      <input
        ref={inputRef}
        id={id}
        type="text"
        inputMode="numeric"
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
            <li className="px-3 py-2 text-sm text-muted">{t('staff.newRequest.roomEmpty')}</li>
          ) : (
            matches.map((room, index) => (
              <li
                key={room.id}
                role="option"
                aria-selected={room.id === value}
                onMouseEnter={() => setHighlighted(index)}
                onMouseDown={(event) => {
                  event.preventDefault()
                  pick(room)
                }}
                className={cn(
                  'cursor-pointer rounded-[6px] px-3 py-2 text-sm',
                  index === highlighted ? 'bg-accent-soft font-medium text-accent' : 'text-foreground hover:bg-surface-2',
                )}
              >
                {room.room_number}
              </li>
            ))
          )}
        </ul>,
        getHkPortalTarget(),
      )}
    </div>
  )
}
