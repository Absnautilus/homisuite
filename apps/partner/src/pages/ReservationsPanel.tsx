import { useState } from 'react'
import { respondToReservation } from '../api'
import type { PartnerReservation } from '../types'

const STATUS_LABELS: Record<PartnerReservation['confirmation_status'], string> = {
  pending: 'Da confermare',
  confirmed: 'Confermata',
  declined: 'Rifiutata',
  cancelled: 'Annullata',
}

type SubTab = 'pending' | 'history'

interface ReservationsPanelProps {
  reservations: PartnerReservation[]
  onReload: () => Promise<void>
}

export function ReservationsPanel({ reservations, onReload }: ReservationsPanelProps) {
  const [subTab, setSubTab] = useState<SubTab>('pending')
  const [notes, setNotes] = useState<Record<string, string>>({})
  const [respondingId, setRespondingId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const pending = reservations.filter((r) => r.confirmation_status === 'pending')
  const history = reservations
    .filter((r) => r.confirmation_status !== 'pending')
    .sort((a, b) => `${b.reservation_date}${b.reservation_time}`.localeCompare(`${a.reservation_date}${a.reservation_time}`))
  const visible = subTab === 'pending' ? pending : history

  async function respond(request: PartnerReservation, status: 'confirmed' | 'declined') {
    setRespondingId(request.id)
    setError(null)
    try {
      await respondToReservation(request.id, status, notes[request.id]?.trim() || null)
      await onReload()
    } catch {
      setError('Non è stato possibile inviare la risposta. Riprova.')
    } finally {
      setRespondingId(null)
    }
  }

  return (
    <div className="partner-panel">
      {error ? <p className="login-error" role="alert">{error}</p> : null}

      <div className="partner-subtabs">
        <button type="button" className={`partner-subtab${subTab === 'pending' ? ' is-active' : ''}`} onClick={() => setSubTab('pending')}>
          Da confermare{pending.length > 0 ? ` (${pending.length})` : ''}
        </button>
        <button type="button" className={`partner-subtab${subTab === 'history' ? ' is-active' : ''}`} onClick={() => setSubTab('history')}>
          Storico
        </button>
      </div>

      {visible.length === 0 ? (
        <div className="partner-empty">
          {subTab === 'pending' ? 'Nessuna prenotazione da confermare al momento.' : 'Nessuna prenotazione in storico.'}
        </div>
      ) : (
      <div className="partner-card-grid">
        {visible.map((request) => (
          <article key={request.id} className="partner-card">
            <div className="partner-card-top">
              <div>
                <div className="partner-card-title">{request.guest_name} · {request.party_size} {request.party_size === 1 ? 'persona' : 'persone'}</div>
                <div className="partner-card-sub">
                  {new Date(`${request.reservation_date}T${request.reservation_time}`).toLocaleDateString('it-IT', { weekday: 'short', day: 'numeric', month: 'short' })}
                  {' · '}{request.reservation_time.slice(0, 5)} · {request.hotel_name}
                </div>
              </div>
              <span className={`partner-badge ${request.confirmation_status}`}>{STATUS_LABELS[request.confirmation_status]}</span>
            </div>

            {request.special_requests ? <p className="partner-card-notes">Richieste: {request.special_requests}</p> : null}
            {request.booking_reference ? <p className="partner-card-notes">Riferimento: {request.booking_reference}</p> : null}
            {request.confirmation_note ? <p className="partner-card-notes">Nota: {request.confirmation_note}</p> : null}

            {subTab === 'pending' ? (
              <>
                <textarea
                  className="partner-note-input"
                  placeholder="Nota facoltativa (es. tavolo riservato, orario confermato alle 20:30…)"
                  value={notes[request.id] ?? ''}
                  onChange={(event) => setNotes((current) => ({ ...current, [request.id]: event.target.value }))}
                />
                <div className="partner-card-actions">
                  <button
                    type="button"
                    className="partner-btn decline"
                    disabled={respondingId === request.id}
                    onClick={() => void respond(request, 'declined')}
                  >
                    Rifiuta
                  </button>
                  <button
                    type="button"
                    className="partner-btn confirm"
                    disabled={respondingId === request.id}
                    onClick={() => void respond(request, 'confirmed')}
                  >
                    {respondingId === request.id ? 'Invio…' : 'Conferma'}
                  </button>
                </div>
              </>
            ) : null}
          </article>
        ))}
      </div>
      )}
    </div>
  )
}
