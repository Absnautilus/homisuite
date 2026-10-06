import { useCallback, useEffect, useState } from 'react'
import { Button } from '@homisuite/ui'
import { Select } from '../../components/Select'
import { Switch } from '../../components/Switch'
import { supabase } from '../../core/client'
import { getOperationalProfile, getRestaurantStats, saveOperationalProfile, updateRestaurant, type RestaurantStats } from './api'
import type { CommercialAgreement, DiningCategory, PreferredContactMethod, Restaurant, RestaurantOperationalProfile } from './types'
import { COMMERCIAL_AGREEMENT_LABELS } from './types'
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

  const load = useCallback(async () => {
    if (!restaurant) return
    setError(null)
    setTab('public')
    setPublicForm(restaurant)
    setCuratedForm(restaurant)
    try {
      const [profile, nextStats] = await Promise.all([
        getOperationalProfile(supabase, restaurant.id),
        getRestaurantStats(supabase, restaurant.id),
      ])
      setOpsForm(profile ?? { ...EMPTY_PROFILE, restaurant_id: restaurant.id })
      setStats(nextStats)
    } catch (cause) {
      setError(readableDiningError(cause))
    }
  }, [restaurant])

  useEffect(() => { void load() }, [load])

  async function saveAll() {
    if (!restaurant) return
    setSaving(true)
    setError(null)
    try {
      await updateRestaurant(supabase, restaurant.id, { ...publicForm, ...curatedForm })
      await saveOperationalProfile(supabase, restaurant.id, opsForm)
      await onSaved()
    } catch (cause) {
      setError(readableDiningError(cause))
    } finally {
      setSaving(false)
    }
  }

  if (!restaurant) return null
  const categoryName = categories.find((c) => c.id === restaurant.category_id)?.name ?? '—'

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
          <Button variant="primary" onClick={() => void saveAll()} disabled={saving}>{saving ? 'Salvataggio…' : 'Salva modifiche'}</Button>
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
          <label className="form-field"><span>Nome</span><input value={publicForm.name ?? ''} onChange={(e) => setPublicForm((f) => ({ ...f, name: e.target.value }))} /></label>
          <label className="form-field"><span>Cucina</span><input value={publicForm.cuisine ?? ''} onChange={(e) => setPublicForm((f) => ({ ...f, cuisine: e.target.value || null }))} /></label>
          <label className="form-field"><span>Fascia prezzo</span>
            <Select id="price-tier" name="price_tier" value={String(publicForm.price_tier ?? '')} onChange={(v) => setPublicForm((f) => ({ ...f, price_tier: (v ? Number(v) : null) as Restaurant['price_tier'] }))}>
              <option value="">—</option>
              <option value="1">€</option><option value="2">€€</option><option value="3">€€€</option><option value="4">€€€€</option>
            </Select>
          </label>
          <label className="form-field"><span>Distanza a piedi (minuti)</span><input type="number" min={0} value={publicForm.walk_minutes ?? ''} onChange={(e) => setPublicForm((f) => ({ ...f, walk_minutes: e.target.value ? Number(e.target.value) : null }))} /></label>
          <label className="form-field span2"><span>Indirizzo</span><input value={publicForm.address ?? ''} onChange={(e) => setPublicForm((f) => ({ ...f, address: e.target.value || null }))} /></label>
          <label className="form-field"><span>Sito web</span><input value={publicForm.website_url ?? ''} onChange={(e) => setPublicForm((f) => ({ ...f, website_url: e.target.value || null }))} /></label>
          <label className="form-field"><span>Link Google Maps</span><input value={publicForm.maps_url ?? ''} onChange={(e) => setPublicForm((f) => ({ ...f, maps_url: e.target.value || null }))} placeholder="https://maps.google.com/…" /></label>
          <label className="form-field span2"><span>Descrizione breve</span><textarea rows={2} value={publicForm.short_description ?? ''} onChange={(e) => setPublicForm((f) => ({ ...f, short_description: e.target.value || null }))} /></label>
          <label className="form-field span2"><span>Tag (separati da virgola)</span><input value={(publicForm.guest_tags ?? []).join(', ')} onChange={(e) => setPublicForm((f) => ({ ...f, guest_tags: e.target.value.split(',').map((t) => t.trim()).filter(Boolean) }))} /></label>
        </div>
      ) : null}

      {tab === 'curated' ? (
        <>
          <div className="dining-field-grid">
            <label className="form-field"><span>Consigliato dall'hotel</span>
              <Select id="is-recommended" name="is_recommended" value={curatedForm.is_recommended ? 'si' : 'no'} onChange={(v) => setCuratedForm((f) => ({ ...f, is_recommended: v === 'si' }))}>
                <option value="si">Sì</option><option value="no">No</option>
              </Select>
            </label>
            <label className="form-field"><span>Priorità visualizzazione</span><input type="number" value={curatedForm.sort_order ?? 0} onChange={(e) => setCuratedForm((f) => ({ ...f, sort_order: Number(e.target.value) }))} /></label>
            <label className="form-field span2"><span>Descrizione concierge (vista dall'ospite)</span><textarea rows={2} value={curatedForm.concierge_description ?? ''} onChange={(e) => setCuratedForm((f) => ({ ...f, concierge_description: e.target.value || null }))} /></label>
            <label className="form-field"><span>Ideale per</span><input value={curatedForm.ideal_for ?? ''} onChange={(e) => setCuratedForm((f) => ({ ...f, ideal_for: e.target.value || null }))} /></label>
            <label className="form-field"><span>Profilo ospite</span><input value={curatedForm.guest_profile ?? ''} onChange={(e) => setCuratedForm((f) => ({ ...f, guest_profile: e.target.value || null }))} /></label>
            <label className="form-field switch-field"><span>Visibile agli ospiti</span><Switch checked={curatedForm.active ?? true} onChange={() => setCuratedForm((f) => ({ ...f, active: !(f.active ?? true) }))} aria-label="Visibile agli ospiti" /></label>
          </div>
          <div className="dining-visibility-note" style={{ marginTop: 14 }}>Questa sezione e la successiva (Operativo) non sono mai visibili agli ospiti, a eccezione della descrizione concierge qui sopra.</div>
        </>
      ) : null}

      {tab === 'ops' ? (
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
          <label className="form-field"><span>Provvigione (%)</span><input type="number" min={0} max={100} step="0.01" value={opsForm.commission_rate ?? ''} onChange={(e) => setOpsForm((f) => ({ ...f, commission_rate: e.target.value ? Number(e.target.value) : null }))} /></label>
          <label className="form-field span2"><span>Note di prenotazione</span><textarea rows={2} value={opsForm.booking_notes ?? ''} onChange={(e) => setOpsForm((f) => ({ ...f, booking_notes: e.target.value || null }))} /></label>
          <label className="form-field span2"><span>Giorni/orari difficili</span><input value={opsForm.difficult_times ?? ''} onChange={(e) => setOpsForm((f) => ({ ...f, difficult_times: e.target.value || null }))} /></label>
          <label className="form-field"><span>Ultima verifica</span><input type="date" value={opsForm.last_verified_on ?? ''} onChange={(e) => setOpsForm((f) => ({ ...f, last_verified_on: e.target.value || null }))} /></label>
        </div>
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
