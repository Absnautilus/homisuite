import { useMemo, useState } from 'react'
import { Search } from 'lucide-react'
import { Select } from '../../components/Select'
import type { ReservationRequest, Restaurant } from './types'
import { CONFIRMATION_STATUS_LABELS } from './types'

interface TuttePanelProps {
  reservations: ReservationRequest[]
  restaurants: Restaurant[]
  onOpenDetail: (reservationId: string) => void
}

type SortCol = 'date' | 'time'

export function TuttePanel({ reservations, restaurants, onOpenDetail }: TuttePanelProps) {
  const [search, setSearch] = useState('')
  const [restaurantFilter, setRestaurantFilter] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [sort, setSort] = useState<{ col: SortCol; dir: 1 | -1 }>({ col: 'date', dir: -1 })

  const restaurantName = (id: string) => restaurants.find((r) => r.id === id)?.name ?? '—'

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase()
    let filtered = reservations.filter((r) => {
      if (restaurantFilter && r.restaurant_id !== restaurantFilter) return false
      if (statusFilter && r.confirmation_status !== statusFilter) return false
      if (q) {
        const haystack = [r.guest_name, r.room_number ?? '', r.booking_reference ?? '', restaurantName(r.restaurant_id), r.special_requests ?? '', r.staff_notes ?? ''].join(' ').toLowerCase()
        if (!haystack.includes(q)) return false
      }
      return true
    })
    filtered = filtered.slice().sort((a, b) => {
      const key = sort.col === 'date' ? a.reservation_date + a.reservation_time : a.reservation_time
      const keyB = sort.col === 'date' ? b.reservation_date + b.reservation_time : b.reservation_time
      return key < keyB ? -sort.dir : key > keyB ? sort.dir : 0
    })
    return filtered
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reservations, search, restaurantFilter, statusFilter, sort])

  function toggleSort(col: SortCol) {
    setSort((current) => current.col === col ? { col, dir: current.dir === 1 ? -1 : 1 } : { col, dir: 1 })
  }

  return (
    <section className="shell-card">
      <div className="dining-grid-toolbar">
        <div className="dining-search-box">
          <Search size={15} />
          <input type="search" placeholder="Cerca ospite, camera, ristorante…" value={search} onChange={(event) => setSearch(event.target.value)} />
        </div>
        <Select id="tutte-restaurant" name="restaurant-filter" value={restaurantFilter} onChange={setRestaurantFilter}>
          <option value="">Tutti i ristoranti</option>
          {restaurants.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
        </Select>
        <Select id="tutte-status" name="status-filter" value={statusFilter} onChange={setStatusFilter}>
          <option value="">Tutti gli stati</option>
          {Object.entries(CONFIRMATION_STATUS_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </Select>
      </div>
      <div className="dining-grid-wrap">
        <table className="dining-dense">
          <thead>
            <tr>
              <th className={`sortable${sort.col === 'date' ? ' is-sorted' : ''}`} onClick={() => toggleSort('date')}>Data<span className="arrow">{sort.col === 'date' && sort.dir === -1 ? '▾' : '▴'}</span></th>
              <th className={`sortable${sort.col === 'time' ? ' is-sorted' : ''}`} onClick={() => toggleSort('time')}>Ora<span className="arrow">{sort.col === 'time' && sort.dir === -1 ? '▾' : '▴'}</span></th>
              <th>Camera</th><th>Ospite</th><th>N. prenotazione</th><th>Ristorante</th><th>Pax</th><th>Stato</th><th>Richieste</th><th>Note</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((reservation) => (
              <tr
                key={reservation.id}
                className={reservation.confirmation_status === 'cancelled' ? 'dining-reservations-row cancelled' : undefined}
                onClick={() => onOpenDetail(reservation.id)}
              >
                <td>{new Date(`${reservation.reservation_date}T00:00:00`).toLocaleDateString('it-IT', { day: '2-digit', month: 'short' })}</td>
                <td>{reservation.reservation_time.slice(0, 5)}</td>
                <td>{reservation.room_number ?? '—'}</td>
                <td>{reservation.guest_name}</td>
                <td>{reservation.booking_reference ?? '—'}</td>
                <td>{restaurantName(reservation.restaurant_id)}</td>
                <td>{reservation.party_size}</td>
                <td><span className={`dining-pill status-${reservation.confirmation_status}`}>{CONFIRMATION_STATUS_LABELS[reservation.confirmation_status]}</span></td>
                <td>{reservation.guest_preference_tags.join(', ') || reservation.special_requests || '—'}</td>
                <td>{reservation.staff_notes ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {rows.length === 0 ? <p className="muted" style={{ padding: 24, textAlign: 'center' }}>Nessuna prenotazione trovata.</p> : null}
      </div>
    </section>
  )
}
