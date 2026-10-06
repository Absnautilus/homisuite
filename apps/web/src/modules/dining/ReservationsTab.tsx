import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { Button, DatePicker, Modal, TimePicker } from '@homisuite/ui'
import { Plus } from 'lucide-react'
import { Select } from '../../components/Select'
import { supabase } from '../../core/client'
import { createReservation, listReservations, listRestaurants, type CreateReservationInput } from './api'
import type { ReservationRequest, Restaurant } from './types'
import { readableDiningError } from './readableDiningError'
import { OggiPanel } from './OggiPanel'
import { TuttePanel } from './TuttePanel'
import { BookingDetailSlideOver } from './BookingDetailSlideOver'

interface ReservationsTabProps {
  hotelId: string
  staffProfileId: string | null
  canManage: boolean
  view: 'oggi' | 'tutte'
}

export function ReservationsTab({ hotelId, staffProfileId, canManage, view }: ReservationsTabProps) {
  const [reservations, setReservations] = useState<ReservationRequest[]>([])
  const [restaurants, setRestaurants] = useState<Restaurant[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [createOpen, setCreateOpen] = useState(false)
  const [detailId, setDetailId] = useState<string | null>(null)

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

  const selectedReservation = reservations.find((r) => r.id === detailId) ?? null

  return (
    <>
      <div className="section-heading split" style={{ marginBottom: 14 }}>
        <div><h2>Prenotazioni</h2><p>Tutte le richieste di prenotazione, comprese quelle inserite manualmente.</p></div>
        {canManage && restaurants.length > 0 ? <button className="primary-action" type="button" onClick={() => setCreateOpen(true)}><Plus size={17} /> Aggiungi prenotazione</button> : null}
      </div>
      {error ? <div className="shell-alert error" role="alert">{error}</div> : null}
      {!loading && restaurants.length === 0 ? (
        <p className="muted dining-empty-hint">Crea prima un ristorante nella scheda "Ristoranti".</p>
      ) : view === 'oggi' ? (
        <OggiPanel reservations={reservations} restaurants={restaurants} onOpenDetail={setDetailId} />
      ) : (
        <TuttePanel reservations={reservations} restaurants={restaurants} onOpenDetail={setDetailId} />
      )}
      <CreateReservationModal
        open={createOpen}
        restaurants={restaurants}
        hotelId={hotelId}
        staffProfileId={staffProfileId}
        onClose={() => setCreateOpen(false)}
        onSaved={async () => { setCreateOpen(false); await load() }}
      />
      <BookingDetailSlideOver
        reservation={selectedReservation}
        restaurants={restaurants}
        canManage={canManage}
        onClose={() => setDetailId(null)}
        onChanged={load}
      />
    </>
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
  const [reservationDate, setReservationDate] = useState('')
  const [reservationTime, setReservationTime] = useState('')

  useEffect(() => {
    if (open) {
      setSaving(false)
      setError(null)
      setRestaurantId(restaurants[0]?.id ?? '')
      setReservationDate('')
      setReservationTime('')
    }
  }, [open, restaurants])

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!reservationDate || !reservationTime) {
      setError('Indica data e ora della prenotazione.')
      return
    }
    setSaving(true)
    setError(null)
    try {
      const form = new FormData(event.currentTarget)
      const input: CreateReservationInput = {
        restaurant_id: restaurantId,
        room_number: String(form.get('room_number') || '') || null,
        guest_name: String(form.get('guest_name')),
        party_size: Number(form.get('party_size')),
        reservation_date: reservationDate,
        reservation_time: reservationTime,
        booking_reference: String(form.get('booking_reference') || '') || null,
        special_requests: String(form.get('special_requests') || '') || null,
        staff_notes: String(form.get('staff_notes') || '') || null,
        // Manual staff entry starts life as "Da prenotare" -- it's already
        // known and doesn't need picking up the way a guest-submitted
        // request does (that path will default to 'new' once it exists).
        confirmation_status: 'scheduled',
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
      dismissible={false}
      footer={(
        <>
          <Button variant="secondary" onClick={onClose}>Annulla</Button>
          <Button variant="primary" type="submit" form="reservation-form" disabled={saving}>{saving ? 'Salvataggio…' : 'Salva'}</Button>
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
        <label className="form-field"><span>Data</span><DatePicker value={reservationDate} onChange={setReservationDate} ariaLabel="Data prenotazione" /></label>
        <label className="form-field"><span>Ora</span><TimePicker value={reservationTime} onChange={setReservationTime} ariaLabel="Ora prenotazione" /></label>
        <label className="form-field"><span>Numero persone</span><input name="party_size" type="number" min={1} max={50} required defaultValue={2} /></label>
        <label className="form-field"><span>N. prenotazione</span><input name="booking_reference" maxLength={40} /></label>
        <label className="form-field"><span>Richieste particolari</span><textarea name="special_requests" rows={2} maxLength={500} spellCheck={false} /></label>
        <label className="form-field"><span>Note interne</span><textarea name="staff_notes" rows={2} maxLength={500} spellCheck={false} /></label>
        {error ? <p className="form-error" role="alert">{error}</p> : null}
      </form>
    </Modal>
  )
}
