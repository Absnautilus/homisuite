import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { Plus } from 'lucide-react'
import { Modal } from '../../components/Modal'
import { Select } from '../../components/Select'
import { supabase } from '../../core/client'
import { createReservation, listReservations, listRestaurants, updateReservation, type CreateReservationInput } from './api'
import type { ConfirmationStatus, ReservationRequest, Restaurant } from './types'
import { CONFIRMATION_STATUS_LABELS } from './types'
import { readableDiningError } from './readableDiningError'

interface ReservationsTabProps {
  hotelId: string
  staffProfileId: string | null
}

export function ReservationsTab({ hotelId, staffProfileId }: ReservationsTabProps) {
  const [reservations, setReservations] = useState<ReservationRequest[]>([])
  const [restaurants, setRestaurants] = useState<Restaurant[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [createOpen, setCreateOpen] = useState(false)

  const restaurantName = (id: string) => restaurants.find((r) => r.id === id)?.name ?? '—'

  const load = useCallback(async () => {
    try {
      setError(null)
      const [nextReservations, nextRestaurants] = await Promise.all([
        listReservations(supabase, hotelId),
        listRestaurants(supabase, hotelId),
      ])
      setReservations(nextReservations)
      setRestaurants(nextRestaurants)
    } catch (cause) {
      setError(readableDiningError(cause))
    } finally {
      setLoading(false)
    }
  }, [hotelId])

  useEffect(() => { void load() }, [load])

  async function onStatusChange(reservation: ReservationRequest, status: ConfirmationStatus) {
    setReservations((current) => current.map((r) => (r.id === reservation.id ? { ...r, confirmation_status: status } : r)))
    try {
      await updateReservation(supabase, reservation.id, { confirmation_status: status })
    } catch (cause) {
      setError(readableDiningError(cause))
      await load()
    }
  }

  return (
    <section className="shell-card">
      <div className="section-heading split">
        <div><h2>Prenotazioni</h2><p>Tutte le richieste di prenotazione, comprese quelle inserite manualmente.</p></div>
        {restaurants.length > 0 ? <button className="primary-action" type="button" onClick={() => setCreateOpen(true)}><Plus size={17} /> Aggiungi prenotazione</button> : null}
      </div>
      {error ? <div className="shell-alert error" role="alert">{error}</div> : null}
      {!loading && restaurants.length === 0 ? (
        <p className="muted dining-empty-hint">Crea prima un ristorante nella scheda "Ristoranti".</p>
      ) : (
      <div className="dining-reservations-table" role="table" aria-label="Prenotazioni">
        <div className="dining-reservations-row dining-reservations-head" role="row">
          <span role="columnheader">Data</span>
          <span role="columnheader">N. prenotazione</span>
          <span role="columnheader">Camera</span>
          <span role="columnheader">Nome</span>
          <span role="columnheader">Ora</span>
          <span role="columnheader">Ristorante</span>
          <span role="columnheader">Pax</span>
          <span role="columnheader">Conferma</span>
          <span role="columnheader">Richieste</span>
          <span role="columnheader">Note</span>
        </div>
        {reservations.map((reservation) => (
          <div
            className={`dining-reservations-row${reservation.confirmation_status === 'cancelled' ? ' cancelled' : ''}`}
            role="row"
            key={reservation.id}
          >
            <span role="cell">{reservation.reservation_date}</span>
            <span role="cell">{reservation.booking_reference ?? '—'}</span>
            <span role="cell">{reservation.room_number ?? '—'}</span>
            <span role="cell">{reservation.guest_name}</span>
            <span role="cell">{reservation.reservation_time.slice(0, 5)}</span>
            <span role="cell">{restaurantName(reservation.restaurant_id)}</span>
            <span role="cell">{reservation.party_size}</span>
            <span role="cell">
              <Select
                id={`status-${reservation.id}`}
                name="status"
                value={reservation.confirmation_status}
                onChange={(value) => void onStatusChange(reservation, value as ConfirmationStatus)}
              >
                {Object.entries(CONFIRMATION_STATUS_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </Select>
            </span>
            <span role="cell">{reservation.special_requests ?? '—'}</span>
            <span role="cell">{reservation.staff_notes ?? '—'}</span>
          </div>
        ))}
        {!loading && reservations.length === 0 ? <div className="dining-reservations-empty muted">Nessuna prenotazione registrata.</div> : null}
      </div>
      )}
      <CreateReservationModal
        open={createOpen}
        restaurants={restaurants}
        hotelId={hotelId}
        staffProfileId={staffProfileId}
        onClose={() => setCreateOpen(false)}
        onSaved={async () => { setCreateOpen(false); await load() }}
      />
    </section>
  )
}

function CreateReservationModal({ open, restaurants, hotelId, staffProfileId, onClose, onSaved }: {
  open: boolean
  restaurants: Restaurant[]
  hotelId: string
  staffProfileId: string | null
  onClose: () => void
  onSaved: () => Promise<void>
}) {
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [restaurantId, setRestaurantId] = useState('')

  useEffect(() => {
    if (open) {
      setSaving(false)
      setError(null)
      setRestaurantId(restaurants[0]?.id ?? '')
    }
  }, [open, restaurants])

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setSaving(true)
    setError(null)
    try {
      const form = new FormData(event.currentTarget)
      const input: CreateReservationInput = {
        restaurant_id: restaurantId,
        room_number: String(form.get('room_number') || '') || null,
        guest_name: String(form.get('guest_name')),
        party_size: Number(form.get('party_size')),
        reservation_date: String(form.get('reservation_date')),
        reservation_time: String(form.get('reservation_time')),
        booking_reference: String(form.get('booking_reference') || '') || null,
        special_requests: String(form.get('special_requests') || '') || null,
        staff_notes: String(form.get('staff_notes') || '') || null,
      }
      await createReservation(supabase, hotelId, staffProfileId, input)
      await onSaved()
    } catch (cause) {
      setError(readableDiningError(cause))
      setSaving(false)
    }
  }

  return (
    <Modal
      open={open}
      title="Aggiungi prenotazione"
      description="Per una prenotazione presa telefonicamente o di persona."
      onClose={onClose}
      footer={(
        <>
          <button className="btn btn-secondary" type="button" onClick={onClose}>Annulla</button>
          <button className="btn btn-primary" type="submit" form="reservation-form" disabled={saving}>{saving ? 'Salvataggio…' : 'Salva'}</button>
        </>
      )}
    >
      <form className="modal-form" id="reservation-form" onSubmit={submit}>
        <label className="form-field"><span>Ristorante</span>
          <Select id="reservation-restaurant" name="restaurant" value={restaurantId} onChange={setRestaurantId}>
            {restaurants.map((restaurant) => <option key={restaurant.id} value={restaurant.id}>{restaurant.name}</option>)}
          </Select>
        </label>
        <label className="form-field"><span>Nome ospite</span><input name="guest_name" required minLength={1} maxLength={120} /></label>
        <label className="form-field"><span>Camera</span><input name="room_number" maxLength={20} /></label>
        <label className="form-field"><span>Data</span><input name="reservation_date" type="date" required /></label>
        <label className="form-field"><span>Ora</span><input name="reservation_time" type="time" required /></label>
        <label className="form-field"><span>Numero persone</span><input name="party_size" type="number" min={1} max={50} required defaultValue={2} /></label>
        <label className="form-field"><span>N. prenotazione</span><input name="booking_reference" maxLength={40} /></label>
        <label className="form-field"><span>Richieste particolari</span><textarea name="special_requests" rows={2} maxLength={500} /></label>
        <label className="form-field"><span>Note interne</span><textarea name="staff_notes" rows={2} maxLength={500} /></label>
        {error ? <p className="form-error" role="alert">{error}</p> : null}
      </form>
    </Modal>
  )
}
