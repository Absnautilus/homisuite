import { useCallback, useEffect, useRef, useState } from 'react'
import { Button } from '@homisuite/ui'
import { Select } from '../../components/Select'
import { supabase } from '../../core/client'
import { createServicePartner, getOperationalProfile, getRestaurantStats, inviteServicePartnerUser, listServicePartners, saveRestaurantManagement, updateRestaurant, type RestaurantStats } from './api'
import type { CommercialAgreement, CommissionBasis, CommissionType, DiningCategory, PreferredContactMethod, Restaurant, RestaurantOperationalProfile, ServicePartner } from './types'
import { COMMERCIAL_AGREEMENT_LABELS, COMMISSION_BASIS_LABELS, COMMISSION_TYPE_LABELS } from './types'
import { readableDiningError } from './readableDiningError'
import { SlideOver } from './SlideOver'

type MgmtTab = 'public' | 'curated' | 'ops' | 'perf'

const EMPTY_PROFILE: RestaurantOperationalProfile = {
  restaurant_id: '',
  contact_phone: null,
  contact_email: null,
  contact_whatsapp: null,
  preferred_contact_method: null,
  contact_person: null,
  commercial_agreement: 'none',
  commission_rate: null,
  commission_type: 'percentage',
  commission_basis: 'total',
  booking_notes: null,
  difficult_times: null,
  last_verified_on: null,
}

interface RestaurantManagementSlideOverProps {
  restaurant: Restaurant | null
  categories: DiningCategory[]
  onClose: () => void
  onSaved: () => Promise<void>
}

export function RestaurantManagementSlideOver({ restaurant, categories, onClose, onSaved }: RestaurantManagementSlideOverProps) {
  const [tab, setTab] = useState<MgmtTab>('public')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [publicForm, setPublicForm] = useState<Partial<Restaurant>>({})
  const [curatedForm, setCuratedForm] = useState<Partial<Restaurant>>({})
  const [opsForm, setOpsForm] = useState<RestaurantOperationalProfile>(EMPTY_PROFILE)
  const [stats, setStats] = useState<RestaurantStats | null>(null)

  // partner_id lives outside publicForm/curatedForm/opsForm on purpose: it's
  // a plain column, not one of the two tables saveRestaurantManagement's RPC
  // writes transactionally, so linking/unlinking saves immediately on its
  // own (same pattern as RestaurantsTab's inline switches) rather than
  // waiting for the big "Salva" button.
  const [partners, setPartners] = useState<ServicePartner[]>([])
  const [partnerId, setPartnerId] = useState<string | null>(null)
  const [linkingPartner, setLinkingPartner] = useState(false)
  const [creatingPartner, setCreatingPartner] = useState(false)
  const [newPartnerName, setNewPartnerName] = useState('')

  // Partner-user invite -- a separate small form, shown only once a partner
  // is actually linked (inviting makes no sense before then), with its own
  // pending/success state since it's an unrelated action from everything
  // else on this tab and shouldn't block or get cleared by them.
  const [invitingUser, setInvitingUser] = useState(false)
  const [inviteFullName, setInviteFullName] = useState('')
  const [inviteEmail, setInviteEmail] = useState('')
  const [invitePending, setInvitePending] = useState(false)
  const [inviteSent, setInviteSent] = useState(false)

  // Guards against a slow fetch for a restaurant the staff member already
  // navigated away from (opened B right after A) landing after B's own
  // panel has already rendered -- without this, A's stale response would
  // silently overwrite B's freshly-loaded form.
  const loadId = useRef(0)

  const load = useCallback(async () => {
    if (!restaurant) return
    const thisLoad = ++loadId.current
    setError(null)
    setTab('public')
    // Seeded with only the fields each tab's own inputs actually edit --
    // not the whole restaurant -- so `saveAll`'s `{...restaurant,
    // ...publicForm, ...curatedForm}` merge only ever overrides a field
    // with the tab that owns it. Seeding both with the full restaurant
    // (as before) meant whichever form the person never opened still held
    // its untouched snapshot of every field, including the other tab's --
    // and since it's spread last here, THAT stale snapshot silently won
    // over whatever they'd actually just typed on the tab they did edit,
    // on every save.
    setPublicForm({
      name: restaurant.name,
      category_id: restaurant.category_id,
      cuisine: restaurant.cuisine,
      price_tier: restaurant.price_tier,
      walk_minutes: restaurant.walk_minutes,
      address: restaurant.address,
      website_url: restaurant.website_url,
      maps_url: restaurant.maps_url,
      short_description: restaurant.short_description,
      guest_tags: restaurant.guest_tags,
    })
    setCuratedForm({
      concierge_description: restaurant.concierge_description,
      ideal_for: restaurant.ideal_for,
      guest_profile: restaurant.guest_profile,
    })
    setPartnerId(restaurant.partner_id)
    setCreatingPartner(false)
    setNewPartnerName('')
    setInvitingUser(false)
    setInviteFullName('')
    setInviteEmail('')
    setInviteSent(false)
    try {
      const [profile, nextStats, nextPartners] = await Promise.all([
        getOperationalProfile(supabase, restaurant.id),
        getRestaurantStats(supabase, restaurant.id),
        listServicePartners(supabase, 'restaurant'),
      ])
      if (thisLoad !== loadId.current) return
      setOpsForm(profile ?? { ...EMPTY_PROFILE, restaurant_id: restaurant.id })
      setStats(nextStats)
      setPartners(nextPartners)
    } catch (cause) {
      if (thisLoad !== loadId.current) return
      setError(readableDiningError(cause))
    }
  }, [restaurant])

  useEffect(() => { void load() }, [load])

  async function saveAll() {
    if (!restaurant) return
    const merged = { ...restaurant, ...publicForm, ...curatedForm }
    if (!merged.name?.trim() || !merged.category_id || merged.walk_minutes == null || !merged.address?.trim()) {
      setTab('public')
      setError('Nome, categoria, distanza a piedi e indirizzo sono obbligatori.')
      return
    }
    setSaving(true)
    setError(null)
    try {
      await saveRestaurantManagement(supabase, restaurant.id, {
        name: merged.name,
        category_id: merged.category_id,
        cuisine: merged.cuisine,
        price_tier: merged.price_tier,
        walk_minutes: merged.walk_minutes,
        address: merged.address,
        website_url: merged.website_url,
        maps_url: merged.maps_url,
        short_description: merged.short_description,
        guest_tags: merged.guest_tags,
        is_recommended: merged.is_recommended,
        sort_order: merged.sort_order,
        concierge_description: merged.concierge_description,
        ideal_for: merged.ideal_for,
        guest_profile: merged.guest_profile,
        active: merged.active,
      }, opsForm)
      await onSaved()
    } catch (cause) {
      setError(readableDiningError(cause))
    } finally {
      setSaving(false)
    }
  }

  async function linkPartner(nextPartnerId: string | null) {
    if (!restaurant) return
    const previous = partnerId
    setPartnerId(nextPartnerId)
    setLinkingPartner(true)
    try {
      await updateRestaurant(supabase, restaurant.id, { partner_id: nextPartnerId })
      await onSaved()
    } catch (cause) {
      setError(readableDiningError(cause))
      setPartnerId(previous)
    } finally {
      setLinkingPartner(false)
    }
  }

  async function createAndLinkPartner() {
    const name = newPartnerName.trim()
    if (!name) return
    setLinkingPartner(true)
    try {
      const partner = await createServicePartner(supabase, 'restaurant', name)
      setPartners((current) => [...current, partner].sort((a, b) => a.name.localeCompare(b.name, 'it')))
      setCreatingPartner(false)
      setNewPartnerName('')
      await linkPartner(partner.id)
    } catch (cause) {
      setError(readableDiningError(cause))
    } finally {
      setLinkingPartner(false)
    }
  }

  async function sendInvite() {
    if (!partnerId || !inviteFullName.trim() || !inviteEmail.trim()) return
    setInvitePending(true)
    setError(null)
    try {
      await inviteServicePartnerUser(supabase, partnerId, inviteFullName.trim(), inviteEmail.trim())
      setInviteSent(true)
      setInviteFullName('')
      setInviteEmail('')
    } catch (cause) {
      setError(readableDiningError(cause))
    } finally {
      setInvitePending(false)
    }
  }

  if (!restaurant) return null
  const categoryName = categories.find((c) => c.id === (publicForm.category_id ?? restaurant.category_id))?.name ?? '—'

  return (
    <SlideOver
      open={Boolean(restaurant)}
      onClose={onClose}
      title={restaurant.name}
      description={categoryName}
      wide
      footer={(
        <>
          <Button variant="secondary" onClick={onClose}>Annulla</Button>
          <Button variant="primary" onClick={() => void saveAll()} disabled={saving}>{saving ? 'Salvataggio…' : 'Salva'}</Button>
        </>
      )}
    >
      {error ? <p className="form-error" role="alert">{error}</p> : null}
      <div className="dining-mgmt-tabs">
        <button type="button" className={tab === 'public' ? 'is-active' : ''} onClick={() => setTab('public')}>Pubblico</button>
        <button type="button" className={tab === 'curated' ? 'is-active' : ''} onClick={() => setTab('curated')}>Info curate</button>
        <button type="button" className={tab === 'ops' ? 'is-active' : ''} onClick={() => setTab('ops')}>Operativo</button>
        <button type="button" className={tab === 'perf' ? 'is-active' : ''} onClick={() => setTab('perf')}>Performance</button>
      </div>

      {tab === 'public' ? (
        <div className="dining-field-grid">
          <label className="form-field"><span>Nome</span><input required value={publicForm.name ?? ''} onChange={(e) => setPublicForm((f) => ({ ...f, name: e.target.value }))} /></label>
          <label className="form-field"><span>Categoria</span>
            <Select id="restaurant-category" name="category_id" value={publicForm.category_id ?? ''} onChange={(v) => setPublicForm((f) => ({ ...f, category_id: v }))}>
              <option value="">—</option>
              {categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}
            </Select>
          </label>
          <label className="form-field"><span>Cucina</span><input value={publicForm.cuisine ?? ''} onChange={(e) => setPublicForm((f) => ({ ...f, cuisine: e.target.value || null }))} /></label>
          <label className="form-field"><span>Fascia prezzo</span>
            <Select id="price-tier" name="price_tier" value={String(publicForm.price_tier ?? '')} onChange={(v) => setPublicForm((f) => ({ ...f, price_tier: (v ? Number(v) : null) as Restaurant['price_tier'] }))}>
              <option value="">—</option>
              <option value="1">€</option><option value="2">€€</option><option value="3">€€€</option><option value="4">€€€€</option>
            </Select>
          </label>
          <label className="form-field"><span>Distanza a piedi (minuti)</span><input required type="number" min={0} value={publicForm.walk_minutes ?? ''} onChange={(e) => setPublicForm((f) => ({ ...f, walk_minutes: e.target.value ? Number(e.target.value) : null }))} /></label>
          <label className="form-field span2"><span>Indirizzo</span><input required value={publicForm.address ?? ''} onChange={(e) => setPublicForm((f) => ({ ...f, address: e.target.value || null }))} /></label>
          <label className="form-field"><span>Sito web</span><input value={publicForm.website_url ?? ''} onChange={(e) => setPublicForm((f) => ({ ...f, website_url: e.target.value || null }))} /></label>
          <label className="form-field"><span>Link Google Maps</span><input value={publicForm.maps_url ?? ''} onChange={(e) => setPublicForm((f) => ({ ...f, maps_url: e.target.value || null }))} placeholder="https://maps.google.com/…" /></label>
          <label className="form-field span2"><span>Descrizione breve</span><textarea rows={2} value={publicForm.short_description ?? ''} onChange={(e) => setPublicForm((f) => ({ ...f, short_description: e.target.value || null }))} /></label>
          <label className="form-field span2"><span>Tag (separati da virgola)</span><input value={(publicForm.guest_tags ?? []).join(', ')} onChange={(e) => setPublicForm((f) => ({ ...f, guest_tags: e.target.value.split(',').map((t) => t.trim()).filter(Boolean) }))} /></label>
        </div>
      ) : null}

      {tab === 'curated' ? (
        <>
          <div className="dining-field-grid">
            <label className="form-field span2"><span>Descrizione concierge (vista dall'ospite)</span><textarea rows={2} value={curatedForm.concierge_description ?? ''} onChange={(e) => setCuratedForm((f) => ({ ...f, concierge_description: e.target.value || null }))} /></label>
            <label className="form-field"><span>Ideale per</span><input value={curatedForm.ideal_for ?? ''} onChange={(e) => setCuratedForm((f) => ({ ...f, ideal_for: e.target.value || null }))} /></label>
            <label className="form-field"><span>Profilo ospite</span><input value={curatedForm.guest_profile ?? ''} onChange={(e) => setCuratedForm((f) => ({ ...f, guest_profile: e.target.value || null }))} /></label>
          </div>
          <div className="dining-visibility-note" style={{ marginTop: 14 }}>Questa sezione e la successiva (Operativo) non sono mai visibili agli ospiti, a eccezione della descrizione concierge qui sopra. Consigliato, Visibile e Priorità si impostano direttamente in riga nell'elenco Ristoranti.</div>
        </>
      ) : null}

      {tab === 'ops' ? (
        <>
          <div className="dining-visibility-note" style={{ marginBottom: 14 }}>Questa sezione non è mai visibile agli ospiti -- è ad uso esclusivo dello staff.</div>
          <div className="dining-field-grid">
            <label className="form-field span2">
              <span>Partner condiviso {linkingPartner ? '(salvataggio…)' : ''}</span>
              <Select
                id="service-partner"
                name="partner_id"
                value={partnerId ?? ''}
                disabled={linkingPartner}
                onChange={(v) => {
                  if (v === '__new__') { setCreatingPartner(true); return }
                  void linkPartner(v || null)
                }}
              >
                <option value="">— nessuno —</option>
                {partners.map((partner) => <option key={partner.id} value={partner.id}>{partner.name}</option>)}
                <option value="__new__">+ Nuovo partner…</option>
              </Select>
            </label>
            {creatingPartner ? (
              <label className="form-field span2">
                <span>Nome del nuovo partner</span>
                <div style={{ display: 'flex', gap: 8 }}>
                  <input autoFocus value={newPartnerName} onChange={(e) => setNewPartnerName(e.target.value)} />
                  <Button variant="secondary" onClick={() => void createAndLinkPartner()} disabled={linkingPartner || !newPartnerName.trim()}>Crea e collega</Button>
                  <Button variant="secondary" onClick={() => { setCreatingPartner(false); setNewPartnerName('') }}>Annulla</Button>
                </div>
              </label>
            ) : null}
          </div>
          <div className="dining-visibility-note" style={{ marginBottom: 14 }}>
            Collegare un partner condiviso identifica questo ristorante con lo stesso locale reale usato da altri hotel -- utile in futuro per una vista aggregata delle prenotazioni lato partner. Non cambia nulla di ciò che l'ospite vede.
          </div>

          {partnerId ? (
            <div className="dining-field-grid" style={{ marginBottom: 14 }}>
              {!invitingUser ? (
                <div className="form-field span2">
                  <Button type="button" variant="secondary" onClick={() => { setInvitingUser(true); setInviteSent(false) }}>
                    Invita utente partner
                  </Button>
                </div>
              ) : (
                <>
                  <label className="form-field">
                    <span>Nome e cognome</span>
                    <input autoFocus value={inviteFullName} onChange={(e) => setInviteFullName(e.target.value)} />
                  </label>
                  <label className="form-field">
                    <span>Email</span>
                    <input type="email" value={inviteEmail} onChange={(e) => setInviteEmail(e.target.value)} />
                  </label>
                  <div className="form-field span2" style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    <Button type="button" onClick={() => void sendInvite()} disabled={invitePending || !inviteFullName.trim() || !inviteEmail.trim()}>
                      {invitePending ? 'Invio…' : 'Invia invito'}
                    </Button>
                    <Button type="button" variant="ghost" onClick={() => setInvitingUser(false)}>Annulla</Button>
                    {inviteSent ? <span className="dining-visibility-note" style={{ marginBottom: 0 }}>Invito inviato.</span> : null}
                  </div>
                </>
              )}
            </div>
          ) : null}

          <div className="dining-field-grid">
            <label className="form-field"><span>Telefono</span><input value={opsForm.contact_phone ?? ''} onChange={(e) => setOpsForm((f) => ({ ...f, contact_phone: e.target.value || null }))} /></label>
            <label className="form-field"><span>Email</span><input value={opsForm.contact_email ?? ''} onChange={(e) => setOpsForm((f) => ({ ...f, contact_email: e.target.value || null }))} /></label>
            <label className="form-field"><span>WhatsApp</span><input value={opsForm.contact_whatsapp ?? ''} onChange={(e) => setOpsForm((f) => ({ ...f, contact_whatsapp: e.target.value || null }))} /></label>
            <label className="form-field"><span>Metodo di contatto preferito</span>
              <Select id="preferred-contact" name="preferred_contact_method" value={opsForm.preferred_contact_method ?? ''} onChange={(v) => setOpsForm((f) => ({ ...f, preferred_contact_method: (v || null) as PreferredContactMethod | null }))}>
                <option value="">—</option><option value="phone">Telefono</option><option value="whatsapp">WhatsApp</option><option value="email">Email</option>
              </Select>
            </label>
            <label className="form-field"><span>Persona di riferimento</span><input value={opsForm.contact_person ?? ''} onChange={(e) => setOpsForm((f) => ({ ...f, contact_person: e.target.value || null }))} /></label>
            <label className="form-field"><span>Accordo commerciale</span>
              <Select id="commercial-agreement" name="commercial_agreement" value={opsForm.commercial_agreement} onChange={(v) => setOpsForm((f) => ({ ...f, commercial_agreement: v as CommercialAgreement }))}>
                {Object.entries(COMMERCIAL_AGREEMENT_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </Select>
            </label>
            <label className="form-field"><span>Tipo provvigione</span>
              <Select id="commission-type" name="commission_type" value={opsForm.commission_type} onChange={(v) => setOpsForm((f) => ({ ...f, commission_type: v as CommissionType }))}>
                {Object.entries(COMMISSION_TYPE_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </Select>
            </label>
            <label className="form-field"><span>Calcolata</span>
              <Select id="commission-basis" name="commission_basis" value={opsForm.commission_basis} onChange={(v) => setOpsForm((f) => ({ ...f, commission_basis: v as CommissionBasis }))}>
                {Object.entries(COMMISSION_BASIS_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </Select>
            </label>
            <label className="form-field">
              <span>Provvigione {opsForm.commission_type === 'percentage' ? '(%)' : '(€)'}</span>
              <input
                type="number"
                min={0}
                max={opsForm.commission_type === 'percentage' ? 100 : undefined}
                step="0.01"
                value={opsForm.commission_rate ?? ''}
                onChange={(e) => setOpsForm((f) => ({ ...f, commission_rate: e.target.value ? Number(e.target.value) : null }))}
              />
            </label>
            <label className="form-field span2"><span>Note di prenotazione</span><textarea rows={2} value={opsForm.booking_notes ?? ''} onChange={(e) => setOpsForm((f) => ({ ...f, booking_notes: e.target.value || null }))} /></label>
            <label className="form-field span2"><span>Giorni/orari difficili</span><input value={opsForm.difficult_times ?? ''} onChange={(e) => setOpsForm((f) => ({ ...f, difficult_times: e.target.value || null }))} /></label>
            <label className="form-field"><span>Ultima verifica</span><input type="date" value={opsForm.last_verified_on ?? ''} onChange={(e) => setOpsForm((f) => ({ ...f, last_verified_on: e.target.value || null }))} /></label>
          </div>
        </>
      ) : null}

      {tab === 'perf' ? (
        <div>
          <div className="dining-perf-row">
            <div className="dining-perf-stat"><span className="n">{stats?.total ?? '—'}</span><span className="l">Richieste</span></div>
            <div className="dining-perf-stat"><span className="n">{stats && stats.total > 0 ? `${Math.round((stats.confirmed / stats.total) * 100)}%` : '—'}</span><span className="l">Confermate</span></div>
          </div>
          <p className="muted" style={{ fontSize: 12, marginTop: 16 }}>Feedback medio e tempo di risposta richiedono più storico per essere affidabili — non ancora mostrati.</p>
        </div>
      ) : null}
    </SlideOver>
  )
}
