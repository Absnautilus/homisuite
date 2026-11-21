import { useCallback, useEffect, useState } from 'react'
import { getMyPartner, listMyReservations, NoPartnerAccountError, respondToReservation } from '../api'
import { supabase } from '../lib/supabase'
import type { PartnerReservation } from '../types'

const STATUS_LABELS: Record<PartnerReservation['confirmation_status'], string> = {
  pending: 'Da confermare',
  confirmed: 'Confermata',
  declined: 'Rifiutata',
  cancelled: 'Annullata',
}

type Tab = 'pending' | 'history'

export function Dashboard() {
  const [businessName, setBusinessName] = useState<string | null>(null)
  const [reservations, setReservations] = useState<PartnerReservation[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [noAccount, setNoAccount] = useState(false)
  const [tab, setTab] = useState<Tab>('pending')
  const [notes, setNotes] = useState<Record<string, string>>({})
  const [respondingId, setRespondingId] = useState<string | null>(null)

  const load = useCallback(async () => {
    setError(null)
    try {
      const [partner, list] = await Promise.all([getMyPartner(), listMyReservations()])
      setBusinessName(partner.businessName)
      setReservations(list)
    } catch (cause) {
      if (cause instanceof NoPartnerAccountError) {
        setNoAccount(true)
        return
      }
      setError('Non è stato possibile caricare le prenotazioni. Riprova tra poco.')
    }
  }, [])

  useEffect(() => { void load() }, [load])

  async function respond(request: PartnerReservation, status: 'confirmed' | 'declined') {
    setRespondingId(request.id)
    setError(null)
    try {
      await respondToReservation(request.id, status, notes[request.id]?.trim() || null)
      await load()
    } catch {
      setError('Non è stato possibile inviare la risposta. Riprova.')
    } finally {
      setRespondingId(null)
    }
  }

  if (noAccount) {
    return (
      <main className="login-screen">
        <section className="login-card">
          <div className="login-copy">
            <h1>Accesso non disponibile</h1>
            <p>Il tuo account non risulta collegato a nessuna attività, oppure è stato disattivato. Contatta l'hotel che ti ha invitato.</p>
          </div>
          <button className="login-submit" type="button" onClick={() => void supabase.auth.signOut()}>Esci</button>
        </section>
      </main>
    )
  }

  const pending = (reservations ?? []).filter((r) => r.confirmation_status === 'pending')
  const history = (reservations ?? [])
    .filter((r) => r.confirmation_status !== 'pending')
    .sort((a, b) => `${b.reservation_date}${b.reservation_time}`.localeCompare(`${a.reservation_date}${a.reservation_time}`))
  const visible = tab === 'pending' ? pending : history

  return (
    <div className="partner-shell">
      <header className="partner-header">
        <div>
          <div className="brand">Homisuite Partner</div>
          {businessName ? <div className="business-name">{businessName}</div> : null}
        </div>
        <button className="partner-logout" type="button" onClick={() => void supabase.auth.signOut()}>Esci</button>
      </header>

      <main className="partner-main">
        {error ? <p className="login-error" role="alert">{error}</p> : null}

        <div className="partner-tabs">
          <button type="button" className={`partner-tab${tab === 'pending' ? ' is-active' : ''}`} onClick={() => setTab('pending')}>
            Da confermare{pending.length > 0 ? ` (${pending.length})` : ''}
          </button>
          <button type="button" className={`partner-tab${tab === 'history' ? ' is-active' : ''}`} onClick={() => setTab('history')}>
            Storico
          </button>
        </div>

        {reservations === null ? (
          <p className="muted">Caricamento…</p>
        ) : visible.length === 0 ? (
          <div className="partner-empty">
            {tab === 'pending' ? 'Nessuna prenotazione da confermare al momento.' : 'Nessuna prenotazione in storico.'}
          </div>
        ) : (
          visible.map((request) => (
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

              {tab === 'pending' ? (
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
          ))
        )}
      </main>
    </div>
  )
}
