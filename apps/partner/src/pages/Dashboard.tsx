import { useCallback, useEffect, useState } from 'react'
import { Button, Tabs } from '@homisuite/ui'
import { getMyPartner, listMyReservations, NoPartnerAccountError, subscribeToReservations } from '../api'
import { supabase } from '../lib/supabase'
import type { PartnerCapacity, PartnerReservation } from '../types'
import { ReservationsPanel } from './ReservationsPanel'
import { CalendarPanel } from './CalendarPanel'
import { SettingsPanel } from './SettingsPanel'

type MainTab = 'prenotazioni' | 'calendario' | 'impostazioni'

export function Dashboard() {
  const [servicePartnerId, setServicePartnerId] = useState<string | null>(null)
  const [businessName, setBusinessName] = useState<string | null>(null)
  const [capacity, setCapacity] = useState<PartnerCapacity | null>(null)
  const [reservations, setReservations] = useState<PartnerReservation[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [noAccount, setNoAccount] = useState(false)
  const [tab, setTab] = useState<MainTab>('prenotazioni')
  const [email, setEmail] = useState<string | null>(null)

  // AuthGate only ever renders this once a session exists, so this is just
  // reading what's already there -- not re-checking whether one does.
  useEffect(() => {
    void supabase.auth.getSession().then(({ data }) => setEmail(data.session?.user.email ?? null))
  }, [])

  const load = useCallback(async () => {
    setError(null)
    try {
      const [partner, list] = await Promise.all([getMyPartner(), listMyReservations()])
      setServicePartnerId(partner.servicePartnerId)
      setBusinessName(partner.businessName)
      setCapacity(partner.capacity)
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

  // Another device (staff making a booking on the guest's behalf, or the
  // guest themselves) can create/change a reservation at any time -- this
  // keeps the dashboard current without the partner needing to refresh.
  useEffect(() => subscribeToReservations(() => { void listMyReservations().then(setReservations).catch(() => {}) }), [])

  if (noAccount) {
    return (
      <main className="login-screen">
        <section className="login-card">
          <div className="login-copy">
            <h1>Accesso non disponibile</h1>
            <p>Il tuo account non risulta collegato a nessuna attività, oppure è stato disattivato. Contatta l'hotel che ti ha invitato.</p>
          </div>
          <Button variant="secondary" onClick={() => void supabase.auth.signOut()}>Esci</Button>
        </section>
      </main>
    )
  }

  const pendingCount = (reservations ?? []).filter((r) => r.confirmation_status === 'pending').length

  return (
    <div className="partner-app">
      <header className="partner-topbar">
        <div className="partner-topbar-brand">
          <img className="mark" src="/icon-192.png" alt="" width={30} height={30} />
          <div>
            <strong>Homisuite Partner</strong>
            {businessName ? <small>{businessName}</small> : null}
          </div>
        </div>
        <Button variant="secondary" size="sm" onClick={() => void supabase.auth.signOut()}>Esci</Button>
      </header>

      <main className="partner-main">
        {error ? <p className="login-error" role="alert">{error}</p> : null}

        <Tabs
          aria-label="Sezioni area partner"
          items={[
            { value: 'prenotazioni', label: `Prenotazioni${pendingCount > 0 ? ` (${pendingCount})` : ''}` },
            { value: 'calendario', label: 'Calendario' },
            { value: 'impostazioni', label: 'Impostazioni' },
          ]}
          value={tab}
          onValueChange={(value) => setTab(value as MainTab)}
        />

        {reservations === null ? (
          <p className="muted">Caricamento…</p>
        ) : tab === 'prenotazioni' ? (
          <ReservationsPanel reservations={reservations} onReload={load} />
        ) : tab === 'calendario' ? (
          <CalendarPanel reservations={reservations} />
        ) : servicePartnerId && capacity ? (
          <SettingsPanel servicePartnerId={servicePartnerId} initialCapacity={capacity} onCapacitySaved={setCapacity} businessName={businessName} email={email} />
        ) : null}
      </main>

      <footer className="partner-footer">
        <img className="mark" src="/icon-192.png" alt="" width={18} height={18} />
        <span>Homisuite Partner</span>
      </footer>
    </div>
  )
}
