import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { Clock, Globe, MapPin, Pencil, Plus, Trash2 } from 'lucide-react'
import { Modal } from '../../components/Modal'
import { Select } from '../../components/Select'
import { Switch } from '../../components/Switch'
import { useConfirm } from '../../components/ConfirmDialog'
import { supabase } from '../../core/client'
import { addHour, createRestaurant, deleteHour, deleteRestaurant, listCategories, listHours, listRestaurants, updateRestaurant, type RestaurantInput } from './api'
import type { DiningCategory, Restaurant, RestaurantHour } from './types'
import { DAY_LABELS } from './types'
import { readableDiningError } from './readableDiningError'

interface RestaurantsTabProps {
  hotelId: string
  canManage: boolean
}

export function RestaurantsTab({ hotelId, canManage }: RestaurantsTabProps) {
  const [restaurants, setRestaurants] = useState<Restaurant[]>([])
  const [categories, setCategories] = useState<DiningCategory[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [editing, setEditing] = useState<Restaurant | 'new' | null>(null)
  const [hoursFor, setHoursFor] = useState<Restaurant | null>(null)
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

  return (
    <section className="shell-card">
      <div className="section-heading split">
        <div><h2>Ristoranti</h2><p>Ristoranti interni o convenzionati, con orari e link alle mappe.</p></div>
        {canManage && categories.length > 0 ? <button className="secondary-action" type="button" onClick={() => setEditing('new')}><Plus size={16} /> Nuovo ristorante</button> : null}
      </div>
      {error ? <div className="shell-alert error" role="alert">{error}</div> : null}
      {!loading && categories.length === 0 ? <p className="muted dining-empty-hint">Crea prima una categoria nella scheda "Categorie".</p> : null}
      <div className="dining-restaurant-list">
        {restaurants.map((restaurant) => (
          <div className="shell-card dining-restaurant-row" key={restaurant.id}>
            <div>
              <strong>{restaurant.name}</strong>
              <span className="status-chip">{categoryName(restaurant.category_id)}</span>
              {restaurant.is_external ? <span className="status-chip">Convenzionato</span> : <span className="status-chip">Interno</span>}
              {restaurant.requires_online_booking ? <span className="status-chip">Prenotazione solo online</span> : null}
              {!restaurant.active ? <span className="status-chip">Disattivato</span> : null}
              <div className="dining-restaurant-links">
                {restaurant.maps_url ? <a href={restaurant.maps_url} target="_blank" rel="noreferrer"><MapPin size={14} /> Mappa</a> : null}
                {restaurant.website_url ? <a href={restaurant.website_url} target="_blank" rel="noreferrer"><Globe size={14} /> Sito web</a> : null}
              </div>
            </div>
            {canManage ? (
              <div className="dining-restaurant-actions">
                <button className="icon-button" type="button" onClick={() => setHoursFor(restaurant)} aria-label="Orari"><Clock size={16} /></button>
                <button className="icon-button" type="button" onClick={() => setEditing(restaurant)} aria-label="Modifica"><Pencil size={16} /></button>
                <button className="icon-button" type="button" onClick={() => void onDelete(restaurant)} aria-label="Elimina"><Trash2 size={16} /></button>
              </div>
            ) : null}
          </div>
        ))}
        {!loading && restaurants.length === 0 && categories.length > 0 ? <span className="muted">Nessun ristorante creato.</span> : null}
      </div>
      <RestaurantModal
        restaurant={editing}
        categories={categories}
        hotelId={hotelId}
        onClose={() => setEditing(null)}
        onSaved={async () => { setEditing(null); await load() }}
      />
      <HoursModal restaurant={hoursFor} onClose={() => setHoursFor(null)} />
      {confirmDialog}
    </section>
  )
}

function RestaurantModal({ restaurant, categories, hotelId, onClose, onSaved }: {
  restaurant: Restaurant | 'new' | null
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
  const existing = restaurant && restaurant !== 'new' ? restaurant : null

  useEffect(() => {
    if (!restaurant) return
    setSaving(false)
    setError(null)
    setCategoryId(existing?.category_id ?? categories[0]?.id ?? '')
    setIsExternal(existing?.is_external ?? true)
    setRequiresOnlineBooking(existing?.requires_online_booking ?? false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [restaurant])

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
      }
      if (existing) await updateRestaurant(supabase, existing.id, input)
      else await createRestaurant(supabase, hotelId, input)
      await onSaved()
    } catch (cause) {
      setError(readableDiningError(cause))
      setSaving(false)
    }
  }

  return (
    <Modal
      open={Boolean(restaurant)}
      title={existing ? 'Modifica ristorante' : 'Nuovo ristorante'}
      onClose={onClose}
      dismissible={false}
      footer={(
        <>
          <button className="btn btn-secondary" type="button" onClick={onClose}>Annulla</button>
          <button className="btn btn-primary" type="submit" form="restaurant-form" disabled={saving}>{saving ? 'Salvataggio…' : 'Salva'}</button>
        </>
      )}
    >
      <form className="modal-form" id="restaurant-form" onSubmit={submit}>
        <label className="form-field"><span>Nome</span><input name="name" required minLength={1} maxLength={120} defaultValue={existing?.name ?? ''} /></label>
        <label className="form-field"><span>Categoria</span>
          <Select id="restaurant-category" name="category" value={categoryId} onChange={setCategoryId}>
            {categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}
          </Select>
        </label>
        <label className="form-field"><span>Descrizione</span><textarea name="description" rows={2} maxLength={500} spellCheck={false} defaultValue={existing?.description ?? ''} /></label>
        <label className="form-field switch-field"><span>Ristorante convenzionato (esterno)</span><Switch checked={isExternal} onChange={() => setIsExternal((v) => !v)} aria-label="Ristorante esterno" /></label>
        <label className="form-field switch-field"><span>Prenotazione richiesta solo dal sito del ristorante</span><Switch checked={requiresOnlineBooking} onChange={() => setRequiresOnlineBooking((v) => !v)} aria-label="Prenotazione solo online" /></label>
        <label className="form-field"><span>Link Google Maps</span><input name="maps_url" type="url" placeholder="https://maps.google.com/…" defaultValue={existing?.maps_url ?? ''} /></label>
        <label className="form-field"><span>Sito web</span><input name="website_url" type="url" placeholder="https://…" defaultValue={existing?.website_url ?? ''} /></label>
        <label className="form-field"><span>Telefono</span><input name="phone" defaultValue={existing?.phone ?? ''} /></label>
        <label className="form-field"><span>Indirizzo</span><input name="address" defaultValue={existing?.address ?? ''} /></label>
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
        <button className="btn btn-secondary" type="submit"><Plus size={14} /> Aggiungi</button>
      </form>
    </Modal>
  )
}

