import { useMemo, useState } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import type { PartnerReservation } from '../types'

interface CalendarPanelProps {
  reservations: PartnerReservation[]
}

const STATUS_LABELS: Record<PartnerReservation['confirmation_status'], string> = {
  pending: 'Da confermare',
  confirmed: 'Confermata',
  declined: 'Rifiutata',
  cancelled: 'Annullata',
}

const WEEKDAY_LABELS = ['L', 'M', 'M', 'G', 'V', 'S', 'D']

function toDateKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

// Viewing only -- confirm/rifiuta stays on the Prenotazioni tab, so this
// doesn't duplicate that whole interaction a second time for one less
// common path (picking a date first, instead of a status).
export function CalendarPanel({ reservations }: CalendarPanelProps) {
  const [cursor, setCursor] = useState(() => { const d = new Date(); d.setDate(1); return d })
  const [selectedDate, setSelectedDate] = useState<string | null>(null)

  const byDate = useMemo(() => {
    const map = new Map<string, PartnerReservation[]>()
    for (const r of reservations) {
      const list = map.get(r.reservation_date) ?? []
      list.push(r)
      map.set(r.reservation_date, list)
    }
    return map
  }, [reservations])

  const monthLabel = cursor.toLocaleDateString('it-IT', { month: 'long', year: 'numeric' })

  const cells = useMemo(() => {
    const firstOfMonth = new Date(cursor.getFullYear(), cursor.getMonth(), 1)
    const firstWeekday = (firstOfMonth.getDay() + 6) % 7 // Monday = 0
    const daysInMonth = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0).getDate()
    const result: { date: Date | null; key: string | null }[] = []
    for (let i = 0; i < firstWeekday; i++) result.push({ date: null, key: null })
    for (let day = 1; day <= daysInMonth; day++) {
      const date = new Date(cursor.getFullYear(), cursor.getMonth(), day)
      result.push({ date, key: toDateKey(date) })
    }
    return result
  }, [cursor])

  const todayKey = toDateKey(new Date())
  const selected = selectedDate ? (byDate.get(selectedDate) ?? []) : []

  return (
    <div className="partner-panel">
      <div className="partner-calendar-nav">
        <button type="button" className="partner-calendar-nav-btn" aria-label="Mese precedente" onClick={() => setCursor((c) => new Date(c.getFullYear(), c.getMonth() - 1, 1))}>
          <ChevronLeft size={18} />
        </button>
        <strong style={{ textTransform: 'capitalize' }}>{monthLabel}</strong>
        <button type="button" className="partner-calendar-nav-btn" aria-label="Mese successivo" onClick={() => setCursor((c) => new Date(c.getFullYear(), c.getMonth() + 1, 1))}>
          <ChevronRight size={18} />
        </button>
      </div>

      <div className="partner-calendar-grid">
        {WEEKDAY_LABELS.map((label, i) => <div key={i} className="partner-calendar-weekday">{label}</div>)}
        {cells.map((cell, i) => {
          if (!cell.date || !cell.key) return <div key={i} />
          const dayReservations = byDate.get(cell.key) ?? []
          const hasPending = dayReservations.some((r) => r.confirmation_status === 'pending')
          return (
            <button
              type="button"
              key={i}
              className={[
                'partner-calendar-day',
                cell.key === todayKey ? 'is-today' : '',
                cell.key === selectedDate ? 'is-selected' : '',
              ].filter(Boolean).join(' ')}
              onClick={() => setSelectedDate(cell.key === selectedDate ? null : cell.key)}
            >
              <span>{cell.date.getDate()}</span>
              {dayReservations.length > 0 ? (
                <span className={`partner-calendar-dot${hasPending ? ' is-pending' : ''}`}>{dayReservations.length}</span>
              ) : null}
            </button>
          )
        })}
      </div>

      {selectedDate ? (
        <div className="partner-panel" style={{ gap: 10 }}>
          <strong>{new Date(`${selectedDate}T00:00:00`).toLocaleDateString('it-IT', { weekday: 'long', day: 'numeric', month: 'long' })}</strong>
          {selected.length === 0 ? (
            <p className="muted">Nessuna prenotazione in questo giorno.</p>
          ) : (
            selected
              .sort((a, b) => a.reservation_time.localeCompare(b.reservation_time))
              .map((r) => (
                <div key={r.id} className="partner-card">
                  <div className="partner-card-top">
                    <div>
                      <div className="partner-card-title">{r.reservation_time.slice(0, 5)} · {r.guest_name} · {r.party_size} {r.party_size === 1 ? 'persona' : 'persone'}</div>
                      <div className="partner-card-sub">{r.hotel_name}</div>
                    </div>
                    <span className={`partner-badge ${r.confirmation_status}`}>{STATUS_LABELS[r.confirmation_status]}</span>
                  </div>
                </div>
              ))
          )}
        </div>
      ) : null}
    </div>
  )
}
