import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { Button } from '@homisuite/ui'
import { supabase } from '../../core/client'
import { createServicePartnerUserCredentials, listServicePartnersForHotel, setServicePartnerUserActive } from './api'
import type { ServicePartnerUser, ServicePartnerWithContext } from './types'
import { readableDiningError } from './readableDiningError'

interface PartnerAccountsSectionProps {
  hotelId: string
  canManage: boolean
}

const EMPTY_FORM = { fullName: '', email: '', password: '' }

// Manual account creation -- the alternative to the email invite in
// RestaurantManagementSlideOver's Operativo tab (Invita utente partner):
// staff sets the password directly and hands it to the partner some other
// way, so it needs no outgoing email at all and works with no SMTP
// configured. Both paths write the same service_partner_users row; this
// one just doesn't go through inviteUserByEmail.
export function PartnerAccountsSection({ hotelId, canManage }: PartnerAccountsSectionProps) {
  const [partners, setPartners] = useState<ServicePartnerWithContext[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [creatingFor, setCreatingFor] = useState<string | null>(null)
  const [form, setForm] = useState(EMPTY_FORM)
  const [creating, setCreating] = useState(false)
  const [createError, setCreateError] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      setError(null)
      setPartners(await listServicePartnersForHotel(supabase, hotelId))
    } catch (cause) {
      setError(readableDiningError(cause))
    }
  }, [hotelId])

  useEffect(() => { void load() }, [load])

  function openCreateForm(partnerId: string) {
    setCreatingFor(partnerId)
    setForm(EMPTY_FORM)
    setCreateError(null)
  }

  async function submitCreate(event: FormEvent<HTMLFormElement>, partnerId: string) {
    event.preventDefault()
    setCreating(true)
    setCreateError(null)
    try {
      await createServicePartnerUserCredentials(supabase, partnerId, form.fullName.trim(), form.email.trim(), form.password)
      setCreatingFor(null)
      await load()
    } catch (cause) {
      setCreateError(readableDiningError(cause))
    } finally {
      setCreating(false)
    }
  }

  async function toggleActive(user: ServicePartnerUser) {
    setError(null)
    try {
      await setServicePartnerUserActive(supabase, user.id, !user.active)
      await load()
    } catch (cause) {
      setError(readableDiningError(cause))
    }
  }

  return (
    <section className="shell-card">
      <div className="section-heading" style={{ padding: '16px 20px 0' }}>
        <h2>Account partner</h2>
        <p>Gli account con cui lo staff del ristorante partner accede a Homisuite Partner per gestire le prenotazioni.</p>
      </div>
      <div style={{ padding: '16px 20px 20px', display: 'grid', gap: 16 }}>
        {error ? <p className="form-error" role="alert">{error}</p> : null}

        {partners === null ? (
          <p className="muted">Caricamento…</p>
        ) : partners.length === 0 ? (
          <p className="muted">Nessun ristorante di questo hotel è collegato a un partner condiviso. Collega un partner dalla scheda "Gestisci" di un ristorante, nel tab Operativo.</p>
        ) : (
          partners.map((partner) => (
            <div key={partner.id} style={{ border: '1px solid var(--line, #e3e5f3)', borderRadius: 12, padding: 14 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
                <strong>{partner.name}</strong>
                <span className="muted" style={{ fontSize: 12 }}>{partner.restaurantNames.join(', ')}</span>
              </div>

              <ul style={{ listStyle: 'none', padding: 0, margin: '10px 0 0', display: 'grid', gap: 6 }}>
                {partner.users.length === 0 ? (
                  <li className="muted">Nessun account creato.</li>
                ) : (
                  partner.users.map((user) => (
                    <li key={user.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                      <span>{user.full_name}{!user.active ? ' · disattivato' : ''}</span>
                      {canManage ? (
                        <Button variant="secondary" size="sm" onClick={() => void toggleActive(user)}>
                          {user.active ? 'Disattiva' : 'Riattiva'}
                        </Button>
                      ) : null}
                    </li>
                  ))
                )}
              </ul>

              {canManage ? (
                creatingFor === partner.id ? (
                  <form onSubmit={(event) => void submitCreate(event, partner.id)} style={{ marginTop: 12, display: 'grid', gap: 8 }}>
                    <input required placeholder="Nome e cognome" value={form.fullName} onChange={(e) => setForm((f) => ({ ...f, fullName: e.target.value }))} />
                    <input required type="email" placeholder="Email" value={form.email} onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))} />
                    <input required type="password" minLength={8} maxLength={72} placeholder="Password (min. 8 caratteri)" value={form.password} onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))} />
                    {createError ? <p className="form-error" role="alert">{createError}</p> : null}
                    <div style={{ display: 'flex', gap: 8 }}>
                      <Button type="submit" disabled={creating}>{creating ? 'Creazione…' : 'Crea account'}</Button>
                      <Button type="button" variant="ghost" onClick={() => setCreatingFor(null)}>Annulla</Button>
                    </div>
                  </form>
                ) : (
                  <Button variant="secondary" style={{ marginTop: 12 }} onClick={() => openCreateForm(partner.id)}>+ Crea account</Button>
                )
              ) : null}
            </div>
          ))
        )}
      </div>
    </section>
  )
}
