import { useCallback, useEffect, useState } from 'react'
import { Button } from '@homisuite/ui'
import { Trash2 } from 'lucide-react'
import { Select } from '../../components/Select'
import { supabase } from '../../core/client'
import { listAlternatives, listChangeLogForEntity, setAlternatives, updateReservation } from './api'
import type { ChangeLogEntry, ConfirmationStatus, ReservationAlternative, ReservationRequest, Restaurant } from './types'
import { CONFIRMATION_STATUS_LABELS } from './types'
import { readableDiningError } from './readableDiningError'
import { SlideOver } from './SlideOver'

interface BookingDetailSlideOverProps {
  reservation: ReservationRequest | null
  restaurants: Restaurant[]
  canManage: boolean
  onClose: () => void
  onChanged: () => Promise<void>
}

function formatDate(iso: string): string {
  return new Date(`${iso}T00:00:00`).toLocaleDateString('it-IT', { day: '2-digit', month: 'long' })
}

export function BookingDetailSlideOver({ reservation, restaurants, canManage, onClose, onChanged }: BookingDetailSlideOverProps) {
  const [alternatives, setAlternativesState] = useState<ReservationAlternative[]>([])
  const [activity, setActivity] = useState<ChangeLogEntry[]>([])
  const [note, setNote] = useState('')
  const [addAltId, setAddAltId] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const restaurantName = (id: string) => restaurants.find((r) => r.id === id)?.name ?? '—'

  const load = useCallback(async () => {
    if (!reservation) return
    try {
      const [nextAlternatives, nextActivity] = await Promise.all([
        listAlternatives(supabase, reservation.id),
        listChangeLogForEntity(supabase, reservation.id),
      ])
      setAlternativesState(nextAlternatives)
      setActivity(nextActivity)
    } catch (cause) {
      setError(readableDiningError(cause))
    }
  }, [reservation])

  useEffect(() => {
    setError(null)
    setAddAltId('')
    setNote(reservation?.confirmation_note ?? '')
    void load()
  }, [reservation, load])

  async function setStatus(status: ConfirmationStatus) {
    if (!reservation) return
    setSaving(true)
    setError(null)
    try {
      await updateReservation(supabase, reservation.id, { confirmation_status: status })
      await onChanged()
      await load()
    } catch (cause) {
      setError(readableDiningError(cause))
    } finally {
      setSaving(false)
    }
  }

  async function saveNote() {
    if (!reservation) return
    setSaving(true)
    setError(null)
    try {
      await updateReservation(supabase, reservation.id, { confirmation_note: note || null })
      await onChanged()
    } catch (cause) {
      setError(readableDiningError(cause))
    } finally {
      setSaving(false)
    }
  }

  async function addAlternative() {
    if (!reservation || !addAltId) return
    const nextIds = [...alternatives.map((a) => a.restaurant_id), addAltId]
    setAddAltId('')
    try {
      await setAlternatives(supabase, reservation.id, nextIds)
      await load()
    } catch (cause) {
      setError(readableDiningError(cause))
    }
  }

  async function removeAlternative(restaurantId: string) {
    if (!reservation) return
    const nextIds = alternatives.map((a) => a.restaurant_id).filter((id) => id !== restaurantId)
    try {
      await setAlternatives(supabase, reservation.id, nextIds)
      await load()
    } catch (cause) {
      setError(readableDiningError(cause))
    }
  }

  if (!reservation) return null

  const availableForAlt = restaurants.filter((r) => r.id !== reservation.restaurant_id && !alternatives.some((a) => a.restaurant_id === r.id))

  return (
    <SlideOver
      open={Boolean(reservation)}
      onClose={onClose}
      title={restaurantName(reservation.restaurant_id)}
      description={`${formatDate(reservation.reservation_date)} · ${reservation.reservation_time.slice(0, 5)} · ${reservation.party_size} persone`}
      footer={canManage ? (
        <>
          {(reservation.confirmation_status === 'new' || reservation.confirmation_status === 'pending') && (
            <Button variant="primary" onClick={() => void setStatus('in_progress')} disabled={saving}>Prendi in carico</Button>
          )}
          {reservation.confirmation_status === 'in_progress' && (
            <>
              <Button variant="primary" onClick={() => void setStatus('confirmed')} disabled={saving}>Segna come confermata</Button>
              <Button variant="danger" onClick={() => void setStatus('unavailable')} disabled={saving}>Non disponibile</Button>
            </>
          )}
          {reservation.confirmation_status === 'unavailable' && (
            <Button variant="secondary" onClick={() => void setStatus('in_progress')} disabled={saving}>Riprova stesso orario</Button>
          )}
          {reservation.confirmation_status !== 'cancelled' && reservation.confirmation_status !== 'confirmed' && (
            <Button variant="secondary" onClick={() => void setStatus('cancelled')} disabled={saving}>Annulla</Button>
          )}
          {reservation.confirmation_status === 'confirmed' && (
            <Button variant="secondary" onClick={() => void setStatus('cancelled')} disabled={saving}>Annulla prenotazione</Button>
          )}
        </>
      ) : null}
    >
      {error ? <p className="form-error" role="alert">{error}</p> : null}

      <div className="dining-dp-section">
        <h3>Ospite</h3>
        <div className="dining-dp-kv">
          <span className="v">{reservation.guest_name}</span>
          <span className="k">{reservation.room_number ? `Camera ${reservation.room_number}` : 'Nessuna camera (ospite esterno)'}</span>
        </div>
      </div>

      <div className="dining-dp-section">
        <h3>Stato</h3>
        <span className={`dining-pill status-${reservation.confirmation_status}`}>{CONFIRMATION_STATUS_LABELS[reservation.confirmation_status]}</span>
      </div>

      {reservation.guest_preference_tags.length > 0 || reservation.special_requests ? (
        <div className="dining-dp-section">
          <h3>Richieste</h3>
          <div className="dining-tag-row">
            {reservation.guest_preference_tags.map((tag) => <span key={tag}>{tag}</span>)}
          </div>
          {reservation.special_requests ? <p style={{ margin: '8px 0 0', fontSize: 13 }}>{reservation.special_requests}</p> : null}
        </div>
      ) : null}

      <div className="dining-dp-section">
        <h3>Alternative autorizzate</h3>
        {alternatives.length > 0 ? (
          <ol className="dining-alt-list">
            {alternatives.map((alt) => (
              <li key={alt.id}>
                <span style={{ flex: 1 }}>{restaurantName(alt.restaurant_id)}</span>
                {canManage ? <button type="button" className="icon-button" aria-label="Rimuovi" onClick={() => void removeAlternative(alt.restaurant_id)}><Trash2 size={13} /></button> : null}
              </li>
            ))}
          </ol>
        ) : <p className="muted" style={{ fontSize: 12.5, margin: 0 }}>Nessuna alternativa autorizzata dall'ospite.</p>}
        {canManage && availableForAlt.length > 0 ? (
          <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
            <Select id="add-alternative" name="add-alternative" value={addAltId} onChange={setAddAltId}>
              <option value="">Aggiungi ristorante…</option>
              {availableForAlt.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
            </Select>
            <Button variant="secondary" onClick={() => void addAlternative()} disabled={!addAltId}>Aggiungi</Button>
          </div>
        ) : null}
      </div>

      {canManage ? (
        <div className="dining-dp-section">
          <h3>Nota di conferma</h3>
          <label className="form-field">
            <textarea rows={2} maxLength={500} value={note} onChange={(event) => setNote(event.target.value)} onBlur={() => void saveNote()} placeholder="es. confermato per le 20:30, tavolo vicino alla finestra" />
          </label>
        </div>
      ) : null}

      <div className="dining-dp-section">
        <h3>Attività</h3>
        {activity.length > 0 ? (
          <ul className="dining-activity-list">
            {activity.map((entry) => (
              <li key={entry.id}>
                <time>{new Date(entry.created_at).toLocaleString('it-IT', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}</time>
                <span>{entry.actor_name} — {entry.summary}</span>
              </li>
            ))}
          </ul>
        ) : <p className="muted" style={{ fontSize: 12.5, margin: 0 }}>Nessuna attività registrata.</p>}
      </div>
    </SlideOver>
  )
}
