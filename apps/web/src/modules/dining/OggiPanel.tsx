import { useMemo, useState } from 'react'
import { AlertTriangle, Clock3, Inbox } from 'lucide-react'
import type { ConfirmationStatus, ReservationRequest, Restaurant } from './types'
import { CONFIRMATION_STATUS_LABELS } from './types'

interface OggiPanelProps {
  reservations: ReservationRequest[]
  restaurants: Restaurant[]
  onOpenDetail: (reservationId: string) => void
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10)
}

// Variant C from the approved prototype: the "Da gestire" queue grouped by
// WHY a request needs attention, not a flat grid or a single priority-
// ordered list (variants A/B the hotel owner compared it against and
// rejected) -- each group is a different staff action (contact the
// restaurant vs. propose an alternative vs. pick up something brand new),
// so grouping by that action reads faster than color alone.
const QUEUE_GROUPS: { key: ConfirmationStatus[]; label: string; tone: 'urgent' | 'waiting' | 'new'; icon: typeof AlertTriangle }[] = [
  { key: ['unavailable'], label: 'Non disponibile — serve un’alternativa', tone: 'urgent', icon: AlertTriangle },
  { key: ['in_progress'], label: 'In attesa di conferma', tone: 'waiting', icon: Clock3 },
  { key: ['new', 'pending'], label: 'Nuove richieste', tone: 'new', icon: Inbox },
]

const KIND_BY_TONE: Record<'urgent' | 'waiting' | 'new', string> = { urgent: 'unavailable', waiting: 'waiting', new: 'new' }

export function OggiPanel({ reservations, restaurants, onOpenDetail }: OggiPanelProps) {
  const [statusFilter, setStatusFilter] = useState<ConfirmationStatus | 'tutte'>('tutte')
  const restaurantName = (id: string) => restaurants.find((r) => r.id === id)?.name ?? '—'
  const today = todayIso()

  const queueGroups = useMemo(
    () => QUEUE_GROUPS.map((group) => ({
      ...group,
      items: reservations
        .filter((r) => group.key.includes(r.confirmation_status))
        .sort((a, b) => (a.reservation_date + a.reservation_time).localeCompare(b.reservation_date + b.reservation_time)),
    })),
    [reservations],
  )
  const queueTotal = queueGroups.reduce((sum, g) => sum + g.items.length, 0)

  const todayReservations = useMemo(
    () => reservations
      .filter((r) => r.reservation_date === today)
      .filter((r) => statusFilter === 'tutte' || r.confirmation_status === statusFilter)
      .sort((a, b) => a.reservation_time.localeCompare(b.reservation_time)),
    [reservations, today, statusFilter],
  )
  const coperti = reservations.filter((r) => r.reservation_date === today).reduce((sum, r) => sum + r.party_size, 0)

  return (
    <div className="page-stack">
      <div className="dining-ops-summary">
        <strong>{reservations.filter((r) => r.reservation_date === today).length}</strong> prenotazioni oggi
        <span className="dot" />
        <strong className="accent">{queueTotal}</strong> da gestire
        <span className="dot" />
        <strong>{coperti}</strong> coperti
      </div>

      <section className="shell-card">
        <div className="dining-queue-head" style={{ padding: '16px 20px 0' }}>
          <h2>Da gestire</h2>
          <span className="count">{queueTotal}</span>
        </div>
        <div style={{ padding: '10px 20px 20px', display: 'grid', gap: 4 }}>
          {queueTotal === 0 ? (
            <p className="dining-queue-empty">Nessuna richiesta in sospeso. Tutto sotto controllo.</p>
          ) : queueGroups.map((group) => group.items.length === 0 ? null : (
            <div className="dining-queue-group" key={group.label}>
              <div className={`dining-queue-group-head ${group.tone}`}>
                <group.icon size={14} />
                <span>{group.label}</span>
                <span className="n">{group.items.length}</span>
              </div>
              <div style={{ display: 'grid', gap: 8, gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))' }}>
                {group.items.map((reservation) => (
                  <article
                    className="dining-q-card"
                    data-kind={KIND_BY_TONE[group.tone]}
                    key={reservation.id}
                    role="button"
                    tabIndex={0}
                    onClick={() => onOpenDetail(reservation.id)}
                    onKeyDown={(event) => { if (event.key === 'Enter') onOpenDetail(reservation.id) }}
                  >
                    <div className="dining-q-main">
                      <strong>{restaurantName(reservation.restaurant_id)}</strong>
                      <span className="q-time">{reservation.reservation_time.slice(0, 5)} · {reservation.party_size} pax</span>
                    </div>
                    <div className="dining-q-sub">
                      {reservation.room_number ? `Camera ${reservation.room_number}` : 'Ospite esterno'} · {reservation.guest_name}
                    </div>
                    {reservation.guest_preference_tags.length > 0 ? (
                      <div className="dining-q-extra">{reservation.guest_preference_tags.join(' · ')}</div>
                    ) : null}
                    <button className="dining-q-btn" type="button" onClick={(event) => { event.stopPropagation(); onOpenDetail(reservation.id) }}>
                      {group.tone === 'new' ? 'Prendi in carico' : group.tone === 'urgent' ? 'Proponi alternativa' : 'Aggiorna'}
                    </button>
                  </article>
                ))}
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="shell-card">
        <div className="section-heading split" style={{ padding: '16px 20px 0' }}>
          <div><h2>Programma di oggi</h2></div>
        </div>
        <div className="filters" style={{ display: 'flex', gap: 6, flexWrap: 'wrap', padding: '10px 20px 16px' }}>
          <button className={`chip${statusFilter === 'tutte' ? ' is-active' : ''}`} type="button" onClick={() => setStatusFilter('tutte')}>Tutte</button>
          {(['confirmed', 'in_progress', 'new', 'unavailable', 'cancelled'] as ConfirmationStatus[]).map((status) => (
            <button key={status} className={`chip${statusFilter === status ? ' is-active' : ''}`} type="button" onClick={() => setStatusFilter(status)}>
              {CONFIRMATION_STATUS_LABELS[status]}
            </button>
          ))}
        </div>
        <div className="dining-grid-wrap">
          <table className="dining-dense">
            <thead>
              <tr>
                <th>Ora</th><th>Camera</th><th>Ospite</th><th>Ristorante</th><th>Pax</th><th>Stato</th>
              </tr>
            </thead>
            <tbody>
              {todayReservations.map((reservation) => (
                <tr key={reservation.id} onClick={() => onOpenDetail(reservation.id)}>
                  <td>{reservation.reservation_time.slice(0, 5)}</td>
                  <td>{reservation.room_number ?? '—'}</td>
                  <td>{reservation.guest_name}</td>
                  <td>{restaurantName(reservation.restaurant_id)}</td>
                  <td>{reservation.party_size}</td>
                  <td><span className={`dining-pill status-${reservation.confirmation_status}`}>{CONFIRMATION_STATUS_LABELS[reservation.confirmation_status]}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
          {todayReservations.length === 0 ? <p className="muted" style={{ padding: '20px' }}>Nessuna prenotazione per oggi.</p> : null}
        </div>
      </section>
    </div>
  )
}
