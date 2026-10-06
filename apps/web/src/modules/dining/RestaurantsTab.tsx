import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { Button, Modal } from '@homisuite/ui'
import { Clock, Plus, Settings2, Trash2 } from 'lucide-react'
import { Select } from '../../components/Select'
import { Switch } from '../../components/Switch'
import { useConfirm } from '../../components/ConfirmDialog'
import { supabase } from '../../core/client'
import { addHour, createRestaurant, deleteHour, deleteRestaurant, listCategories, listHours, listRestaurants, updateRestaurant, type RestaurantInput } from './api'
import type { DiningCategory, Restaurant, RestaurantHour } from './types'
import { DAY_LABELS } from './types'
import { readableDiningError } from './readableDiningError'
import { RestaurantManagementSlideOver } from './RestaurantManagementSlideOver'

interface RestaurantsTabProps {
  hotelId: string
  canManage: boolean
}

export function RestaurantsTab({ hotelId, canManage }: RestaurantsTabProps) {
  const [restaurants, setRestaurants] = useState<Restaurant[]>([])
  const [categories, setCategories] = useState<DiningCategory[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [managing, setManaging] = useState<Restaurant | null>(null)
  const [hoursFor, setHoursFor] = useState<Restaurant | null>(null)
  const [filter, setFilter] = useState<'tutti' | 'consigliati' | 'visibili'>('tutti')
  const [confirmDialog, confirm] = useConfirm()

  const categoryName = (id: string) => categories.find((c) => c.id === id)?.name ?? '—'

  const load = useCallback(async () => {
    try {
      setError(null)
      const [nextRestaurants, nextCategories] = await Promise.all([
        listRestaurants(supabase, hotelId),
        listCategories(supabase, hotelId),
      ])
      setRestaurants(nextRestaurants)
      setCategories(nextCategories)
    } catch (cause) {
      setError(readableDiningError(cause))
    } finally {
      setLoading(false)
    }
  }, [hotelId])

  useEffect(() => { void load() }, [load])

  async function onDelete(restaurant: Restaurant) {
    const confirmed = await confirm({
      title: 'Eliminare il ristorante?',
      description: `"${restaurant.name}" verrà rimosso dall'elenco.`,
      confirmLabel: 'Elimina',
    })
    if (!confirmed) return
    try {
      await deleteRestaurant(supabase, restaurant.id)
      await load()
    } catch (cause) {
      setError(readableDiningError(cause))
    }
  }

  async function toggleRecommended(restaurant: Restaurant) {
    setRestaurants((current) => current.map((r) => r.id === restaurant.id ? { ...r, is_recommended: !r.is_recommended } : r))
    try {
      await updateRestaurant(supabase, restaurant.id, { is_recommended: !restaurant.is_recommended })
    } catch (cause) {
      setError(readableDiningError(cause))
      await load()
    }
  }

  async function toggleVisible(restaurant: Restaurant) {
    setRestaurants((current) => current.map((r) => r.id === restaurant.id ? { ...r, active: !r.active } : r))
    try {
      await updateRestaurant(supabase, restaurant.id, { active: !restaurant.active })
    } catch (cause) {
      setError(readableDiningError(cause))
      await load()
    }
  }

  // Alphabetical for browsing, same choice the approved prototype made --
  // the one place display order is deliberate is Impostazioni's own
  // classification table (sort_order / "Priorità"), not this catalog.
  const visible = restaurants
    .filter((r) => filter === 'tutti' || (filter === 'consigliati' && r.is_recommended) || (filter === 'visibili' && r.active))
    .slice()
    .sort((a, b) => a.name.localeCompare(b.name, 'it'))

  return (
    <section className="shell-card">
      <div className="section-heading split">
        <div><h2>Ristoranti</h2><p>Ristoranti interni o convenzionati, con orari e link alle mappe.</p></div>
        {canManage && categories.length > 0 ? <button className="secondary-action" type="button" onClick={() => setCreating(true)}><Plus size={16} /> Nuovo ristorante</button> : null}
      </div>
      {error ? <div className="shell-alert error" role="alert">{error}</div> : null}
      {!loading && categories.length === 0 ? <p className="muted dining-empty-hint">Crea prima una categoria nella scheda "Categorie".</p> : null}
      {categories.length > 0 ? (
        <div className="filters" style={{ display: 'flex', gap: 6, flexWrap: 'wrap', padding: '0 20px 14px' }}>
          <button className={`chip${filter === 'tutti' ? ' is-active' : ''}`} type="button" onClick={() => setFilter('tutti')}>Tutti</button>
          <button className={`chip${filter === 'consigliati' ? ' is-active' : ''}`} type="button" onClick={() => setFilter('consigliati')}>Consigliati</button>
          <button className={`chip${filter === 'visibili' ? ' is-active' : ''}`} type="button" onClick={() => setFilter('visibili')}>Visibili</button>
        </div>
      ) : null}
      <div>
        {visible.map((restaurant) => (
          <div className="dining-rest-row" key={restaurant.id} onClick={() => setManaging(restaurant)}>
            <div className="dining-rest-thumb">{restaurant.name[0]}</div>
            <div className="dining-rest-main">
              <strong>{restaurant.name}</strong>
              <div className="meta">
                {categoryName(restaurant.category_id)}
                {restaurant.cuisine ? ` · ${restaurant.cuisine}` : ''}
                {restaurant.price_tier ? ` · ${'€'.repeat(restaurant.price_tier)}` : ''}
                {!restaurant.active ? ' · Disattivato' : ''}
              </div>
            </div>
            {canManage ? (
              <button
                type="button"
                className={`dining-rec-badge${restaurant.is_recommended ? ' is-on' : ''}`}
                onClick={(event) => { event.stopPropagation(); void toggleRecommended(restaurant) }}
                title="Impostato dall'hotel"
              >
                Consigliato
              </button>
            ) : restaurant.is_recommended ? <span className="dining-rec-badge is-on">Consigliato</span> : <span />}
            {canManage ? (
              <div className="dining-vis-toggle" onClick={(event) => event.stopPropagation()}>
                Visibile <Switch checked={restaurant.active} onChange={() => void toggleVisible(restaurant)} aria-label={`Visibile — ${restaurant.name}`} />
              </div>
            ) : <span />}
            {canManage ? (
              <div style={{ display: 'flex', gap: 2 }} onClick={(event) => event.stopPropagation()}>
                <button className="icon-button" type="button" onClick={() => setHoursFor(restaurant)} aria-label="Orari"><Clock size={16} /></button>
                <button className="icon-button" type="button" onClick={() => setManaging(restaurant)} aria-label="Gestisci"><Settings2 size={16} /></button>
                <button className="icon-button" type="button" onClick={() => void onDelete(restaurant)} aria-label="Elimina"><Trash2 size={16} /></button>
              </div>
            ) : <span />}
          </div>
        ))}
        {!loading && visible.length === 0 && categories.length > 0 ? <p className="muted dining-empty-hint">Nessun ristorante trovato.</p> : null}
      </div>
      <CreateRestaurantModal
        open={creating}
        categories={categories}
        hotelId={hotelId}
        onClose={() => setCreating(false)}
        onSaved={async () => { setCreating(false); await load() }}
      />
      <RestaurantManagementSlideOver
        restaurant={managing}
        categories={categories}
        onClose={() => setManaging(null)}
        onSaved={async () => { setManaging(null); await load() }}
      />
      <HoursModal restaurant={hoursFor} onClose={() => setHoursFor(null)} />
      {confirmDialog}
    </section>
  )
}

function CreateRestaurantModal({ open, categories, hotelId, onClose, onSaved }: {
  open: boolean
  categories: DiningCategory[]
  hotelId: string
  onClose: () => void
  onSaved: () => Promise<void>
}) {
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [categoryId, setCategoryId] = useState('')
  const [isExternal, setIsExternal] = useState(true)
  const [requiresOnlineBooking, setRequiresOnlineBooking] = useState(false)

  useEffect(() => {
    if (open) {
      setSaving(false)
      setError(null)
      setCategoryId(categories[0]?.id ?? '')
      setIsExternal(true)
      setRequiresOnlineBooking(false)
    }
  }, [open, categories])

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setSaving(true)
    setError(null)
    try {
      const form = new FormData(event.currentTarget)
      const input: RestaurantInput = {
        category_id: categoryId,
        name: String(form.get('name')),
        description: String(form.get('description') || '') || null,
        is_external: isExternal,
        maps_url: String(form.get('maps_url') || '') || null,
        website_url: String(form.get('website_url') || '') || null,
        phone: String(form.get('phone') || '') || null,
        address: String(form.get('address') || '') || null,
        requires_online_booking: requiresOnlineBooking,
        cuisine: String(form.get('cuisine') || '') || null,
        price_tier: null,
        walk_minutes: null,
        short_description: null,
        guest_tags: [],
        is_recommended: false,
        concierge_description: null,
        ideal_for: null,
        guest_profile: null,
      }
      await createRestaurant(supabase, hotelId, input)
      await onSaved()
    } catch (cause) {
      setError(readableDiningError(cause))
      setSaving(false)
    }
  }

  return (
    <Modal
      open={open}
      title="Nuovo ristorante"
      description="I dettagli curati (consigliato, descrizione per l'ospite, dati operativi) si aggiungono dopo, dalla sua scheda di gestione."
      onClose={onClose}
      dismissible={false}
      footer={(
        <>
          <Button variant="secondary" onClick={onClose}>Annulla</Button>
          <Button variant="primary" type="submit" form="restaurant-create-form" disabled={saving}>{saving ? 'Salvataggio…' : 'Crea'}</Button>
        </>
      )}
    >
      <form className="modal-form" id="restaurant-create-form" onSubmit={submit}>
        <label className="form-field"><span>Nome</span><input name="name" required minLength={1} maxLength={120} /></label>
        <label className="form-field"><span>Categoria</span>
          <Select id="restaurant-category" name="category" value={categoryId} onChange={setCategoryId}>
            {categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}
          </Select>
        </label>
        <label className="form-field"><span>Cucina</span><input name="cuisine" maxLength={60} /></label>
        <label className="form-field"><span>Descrizione</span><textarea name="description" rows={2} maxLength={500} spellCheck={false} /></label>
        <label className="form-field switch-field"><span>Ristorante convenzionato (esterno)</span><Switch checked={isExternal} onChange={() => setIsExternal((v) => !v)} aria-label="Ristorante esterno" /></label>
        <label className="form-field switch-field"><span>Prenotazione richiesta solo dal sito del ristorante</span><Switch checked={requiresOnlineBooking} onChange={() => setRequiresOnlineBooking((v) => !v)} aria-label="Prenotazione solo online" /></label>
        <label className="form-field"><span>Link Google Maps</span><input name="maps_url" type="url" placeholder="https://maps.google.com/…" /></label>
        <label className="form-field"><span>Sito web</span><input name="website_url" type="url" placeholder="https://…" /></label>
        <label className="form-field"><span>Telefono</span><input name="phone" /></label>
        <label className="form-field"><span>Indirizzo</span><input name="address" /></label>
        {error ? <p className="form-error" role="alert">{error}</p> : null}
      </form>
    </Modal>
  )
}

function HoursModal({ restaurant, onClose }: { restaurant: Restaurant | null; onClose: () => void }) {
  const [hours, setHours] = useState<RestaurantHour[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [day, setDay] = useState('1')
  const [opensAt, setOpensAt] = useState('12:00')
  const [closesAt, setClosesAt] = useState('15:00')

  const load = useCallback(async () => {
    if (!restaurant) return
    try {
      setLoading(true)
      setError(null)
      setHours(await listHours(supabase, restaurant.id))
    } catch (cause) {
      setError(readableDiningError(cause))
    } finally {
      setLoading(false)
    }
  }, [restaurant])

  useEffect(() => { void load() }, [load])

  async function onAdd(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!restaurant) return
    try {
      setError(null)
      await addHour(supabase, restaurant.id, Number(day), opensAt, closesAt)
      await load()
    } catch (cause) {
      setError(readableDiningError(cause))
    }
  }

  async function onRemove(hour: RestaurantHour) {
    try {
      await deleteHour(supabase, hour.id)
      await load()
    } catch (cause) {
      setError(readableDiningError(cause))
    }
  }

  return (
    <Modal open={Boolean(restaurant)} title={`Orari — ${restaurant?.name ?? ''}`} description="Puoi aggiungere più fasce orarie per lo stesso giorno (es. pranzo e cena)." onClose={onClose}>
      {error ? <p className="form-error" role="alert">{error}</p> : null}
      <ul className="dining-hours-list">
        {hours.map((hour) => (
          <li key={hour.id}>
            <span>{DAY_LABELS[hour.day_of_week]}</span>
            <span>{hour.opens_at.slice(0, 5)} – {hour.closes_at.slice(0, 5)}</span>
            <button className="icon-button" type="button" onClick={() => void onRemove(hour)} aria-label="Rimuovi orario"><Trash2 size={14} /></button>
          </li>
        ))}
        {!loading && hours.length === 0 ? <li className="muted">Nessun orario configurato.</li> : null}
      </ul>
      <form className="dining-hours-form" onSubmit={onAdd}>
        <Select id="hour-day" name="day" value={day} onChange={setDay}>
          {DAY_LABELS.map((label, index) => <option key={label} value={String(index)}>{label}</option>)}
        </Select>
        <input type="time" value={opensAt} onChange={(event) => setOpensAt(event.target.value)} required />
        <input type="time" value={closesAt} onChange={(event) => setClosesAt(event.target.value)} required />
        <Button variant="secondary" type="submit"><Plus size={14} /> Aggiungi</Button>
      </form>
    </Modal>
  )
}
