import { useEffect, useRef, useState } from 'react'
import type { Restaurant } from './types'

interface RestaurantFieldProps {
  id: string
  value: string
  onChange: (value: string) => void
  restaurants: Restaurant[]
}

// A free-text field for "which restaurant" that still offers this hotel's
// own configured list as suggestions underneath -- typing (or picking) a
// name that matches one of them resolves to that restaurant on submit;
// anything else is kept as a one-off custom name, since not every booking
// is for a restaurant this hotel has configured (see
// CreateReservationInput's restaurant_id/custom_restaurant_name split).
export function RestaurantField({ id, value, onChange, restaurants }: RestaurantFieldProps) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    function onPointerDown(event: MouseEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onPointerDown)
    return () => document.removeEventListener('mousedown', onPointerDown)
  }, [open])

  const query = value.trim().toLowerCase()
  const matches = (query ? restaurants.filter((r) => r.name.toLowerCase().includes(query)) : restaurants).slice(0, 8)
  const showPanel = open && matches.length > 0

  return (
    <div className="select-root" ref={rootRef}>
      <input
        id={id}
        value={value}
        onChange={(event) => { onChange(event.target.value); setOpen(true) }}
        onFocus={() => setOpen(true)}
        autoComplete="off"
        placeholder="Nome del ristorante…"
        maxLength={120}
      />
      {showPanel ? (
        <ul className="select-panel" role="listbox" aria-label="Ristoranti suggeriti">
          {matches.map((restaurant) => (
            <li
              key={restaurant.id}
              role="option"
              aria-selected={restaurant.name.toLowerCase() === query}
              className="select-option"
              onMouseDown={(event) => { event.preventDefault(); onChange(restaurant.name); setOpen(false) }}
            >
              <span>{restaurant.name}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  )
}
