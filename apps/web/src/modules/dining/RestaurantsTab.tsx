import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { Button, Modal, useUndo } from '@homisuite/ui'
import { ArrowUpDown, Clock, Download, Images, Plus, Search, Settings2, Trash2 } from 'lucide-react'
import { Select } from '../../components/Select'
import { Switch } from '../../components/Switch'
import { useConfirm } from '../../components/ConfirmDialog'
import { supabase } from '../../core/client'
import { addHour, createRestaurant, deleteHour, deleteRestaurant, listCategories, listHours, listRestaurantPhotos, listRestaurants, lookupMapsPlace, MapsLookupError, replaceRestaurantPhotos, restoreHour, restoreRestaurant, subscribeToCategories, subscribeToRestaurants, updateRestaurant, type MapsImportedHour, type MapsImportedPhoto, type RestaurantInput, type RestaurantPhoto } from './api'
import type { DiningCategory, Restaurant, RestaurantHour } from './types'
import { DAY_LABELS } from './types'
import { readableDiningError } from './readableDiningError'
import { RestaurantManagementSlideOver } from './RestaurantManagementSlideOver'

interface RestaurantsTabProps {
  hotelId: string
  hotelAddress: string | null
  canManage: boolean
}

export function RestaurantsTab({ hotelId, hotelAddress, canManage }: RestaurantsTabProps) {
  const [restaurants, setRestaurants] = useState<Restaurant[]>([])
  const [categories, setCategories] = useState<DiningCategory[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [managing, setManaging] = useState<Restaurant | null>(null)
  const [hoursFor, setHoursFor] = useState<Restaurant | null>(null)
  const [galleryFor, setGalleryFor] = useState<Restaurant | null>(null)
  const [filter, setFilter] = useState<'tutti' | 'consigliati' | 'visibili'>('tutti')
  const [search, setSearch] = useState('')
  const [sortByPriority, setSortByPriority] = useState(false)
  const [confirmDialog, confirm] = useConfirm()
  const pushUndo = useUndo()

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

  // Keeps this list in sync with another staff member's own changes
  // (adding a restaurant, editing a category, ...) without waiting on this
  // session to happen to reload the page.
  useEffect(() => {
    const unsubscribeRestaurants = subscribeToRestaurants(supabase, hotelId, () => void load())
    const unsubscribeCategories = subscribeToCategories(supabase, hotelId, () => void load())
    return () => {
      unsubscribeRestaurants()
      unsubscribeCategories()
    }
  }, [hotelId, load])

  async function onDelete(restaurant: Restaurant) {
    const confirmed = await confirm({
      title: 'Eliminare il ristorante?',
      description: `"${restaurant.name}" verrà rimosso dall'elenco.`,
      confirmLabel: 'Elimina',
    })
    if (!confirmed) return
    try {
      // Captured before deleting -- the delete cascades to both tables,
      // and undoing it needs to put everything back, not just the
      // restaurant's own row.
      const [hours, photos] = await Promise.all([
        listHours(supabase, restaurant.id),
        listRestaurantPhotos(supabase, restaurant.id),
      ])
      await deleteRestaurant(supabase, restaurant.id)
      await load()
      pushUndo({
        message: `"${restaurant.name}" eliminato.`,
        undo: async () => {
          await restoreRestaurant(supabase, restaurant, hours, photos)
          await load()
        },
      })
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

  async function setPriority(restaurant: Restaurant, value: number) {
    setRestaurants((current) => current.map((r) => r.id === restaurant.id ? { ...r, sort_order: value } : r))
    try {
      await updateRestaurant(supabase, restaurant.id, { sort_order: value })
    } catch (cause) {
      setError(readableDiningError(cause))
      await load()
    }
  }

  // Alphabetical by default (easiest to scan while browsing); "Ordina per
  // priorità" switches this catalog's own order to match sort_order, so
  // editing Priorità has a visible effect without leaving this tab.
  const searchQuery = search.trim().toLowerCase()
  const visible = restaurants
    .filter((r) => filter === 'tutti' || (filter === 'consigliati' && r.is_recommended) || (filter === 'visibili' && r.active))
    .filter((r) => !searchQuery || r.name.toLowerCase().includes(searchQuery))
    .slice()
    .sort((a, b) => sortByPriority ? (a.sort_order - b.sort_order || a.name.localeCompare(b.name, 'it')) : a.name.localeCompare(b.name, 'it'))

  // Grouped by category (in the same order as the Categorie tab lists
  // them) instead of one flat list -- a category with nothing matching
  // the current filter/search just doesn't get a section, rather than an
  // empty header.
  const groups = categories
    .map((category) => ({ category, restaurants: visible.filter((r) => r.category_id === category.id) }))
    .filter((group) => group.restaurants.length > 0)

  return (
    <section className="shell-card">
      <div className="section-heading split">
        <div><h2>Ristoranti</h2><p>Ristoranti interni o convenzionati, con orari e link alle mappe.</p></div>
        {canManage && categories.length > 0 ? <button className="secondary-action" type="button" onClick={() => setCreating(true)}><Plus size={16} /> Nuovo ristorante</button> : null}
      </div>
      {error ? <div className="shell-alert error" role="alert">{error}</div> : null}
      {!loading && categories.length === 0 ? <p className="muted dining-empty-hint">Crea prima una categoria nella scheda "Categorie".</p> : null}
      {categories.length > 0 ? (
        <div className="dining-grid-toolbar">
          <div className="dining-search-box">
            <Search size={15} />
            <input type="search" placeholder="Cerca ristorante…" value={search} onChange={(event) => setSearch(event.target.value)} />
          </div>
          <Button variant="chip" pressed={filter === 'tutti'} onClick={() => setFilter('tutti')}>Tutti</Button>
          <Button variant="chip" pressed={filter === 'consigliati'} onClick={() => setFilter('consigliati')}>Consigliati</Button>
          <Button variant="chip" pressed={filter === 'visibili'} onClick={() => setFilter('visibili')}>Visibili</Button>
          <Button variant="chip" pressed={sortByPriority} onClick={() => setSortByPriority((v) => !v)}>
            <ArrowUpDown size={13} /> Priorità
          </Button>
        </div>
      ) : null}
      <div>
        {groups.length > 0 ? (
          <div className="dining-rest-row dining-rest-head">
            <span /><span /><span>Consigliato</span><span>Visibile</span><span>Priorità</span><span />
          </div>
        ) : null}
        {groups.map(({ category, restaurants: groupRestaurants }) => (
          <div key={category.id}>
            <div className="dining-category-heading">{category.name} <span className="muted">({groupRestaurants.length})</span></div>
            {groupRestaurants.map((restaurant) => (
              <div className="dining-rest-row" key={restaurant.id} onClick={() => setManaging(restaurant)}>
                {restaurant.cover_image_url
                  ? <img className="dining-rest-thumb" src={restaurant.cover_image_url} alt="" />
                  : <div className="dining-rest-thumb">{restaurant.name[0]}</div>}
                <div className="dining-rest-main">
                  <strong>{restaurant.name}</strong>
                  <div className="meta">
                    {restaurant.cuisine ?? ''}
                    {restaurant.price_tier ? ` · ${'€'.repeat(restaurant.price_tier)}` : ''}
                    {restaurant.google_rating != null ? ` · ★ ${restaurant.google_rating.toFixed(1)}${restaurant.google_rating_count != null ? ` (${restaurant.google_rating_count})` : ''}` : ''}
                    {!restaurant.active ? ' · Disattivato' : ''}
                  </div>
                </div>
                <div className="dining-switch-cell" onClick={canManage ? (event) => event.stopPropagation() : undefined}>
                  <Switch checked={restaurant.is_recommended} onChange={() => void toggleRecommended(restaurant)} aria-label={`Consigliato — ${restaurant.name}`} disabled={!canManage} />
                </div>
                <div className="dining-switch-cell" onClick={canManage ? (event) => event.stopPropagation() : undefined}>
                  <Switch checked={restaurant.active} onChange={() => void toggleVisible(restaurant)} aria-label={`Visibile — ${restaurant.name}`} disabled={!canManage} />
                </div>
                {canManage ? (
                  <input
                    type="number"
                    className="dining-priority-input"
                    value={restaurant.sort_order}
                    onClick={(event) => event.stopPropagation()}
                    onChange={(e) => void setPriority(restaurant, Number(e.target.value))}
                    aria-label={`Priorità — ${restaurant.name}`}
                  />
                ) : <span />}
                {canManage ? (
                  <div style={{ display: 'flex', gap: 2 }} onClick={(event) => event.stopPropagation()}>
                    <button className="icon-button" type="button" onClick={() => setGalleryFor(restaurant)} aria-label="Galleria foto"><Images size={16} /></button>
                    <button className="icon-button" type="button" onClick={() => setHoursFor(restaurant)} aria-label="Orari"><Clock size={16} /></button>
                    <button className="icon-button" type="button" onClick={() => setManaging(restaurant)} aria-label="Gestisci"><Settings2 size={16} /></button>
                    <button className="icon-button" type="button" onClick={() => void onDelete(restaurant)} aria-label="Elimina"><Trash2 size={16} /></button>
                  </div>
                ) : <span />}
              </div>
            ))}
          </div>
        ))}
        {!loading && visible.length === 0 && categories.length > 0 ? <p className="muted dining-empty-hint">Nessun ristorante trovato.</p> : null}
      </div>
      <CreateRestaurantModal
        open={creating}
        categories={categories}
        hotelId={hotelId}
        hotelAddress={hotelAddress}
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
      <GalleryModal restaurant={galleryFor} hotelAddress={hotelAddress} onClose={() => setGalleryFor(null)} onSaved={load} />
      {confirmDialog}
    </section>
  )
}

const MAPS_LOOKUP_ERROR_MESSAGES: Record<string, string> = {
  place_not_recognized: 'Non riesco a riconoscere un locale da questo link. Prova a incollare il link dalla pagina del ristorante aperta su Google Maps (non una ricerca o un link condiviso diverso).',
  place_not_found: 'Nessun locale trovato su Google Maps con questo link.',
  invalid_input: 'Incolla prima un link di Google Maps.',
}

const BUSINESS_STATUS_WARNINGS: Record<string, string> = {
  CLOSED_TEMPORARILY: 'Attenzione: Google Maps segna questo locale come chiuso temporaneamente.',
  CLOSED_PERMANENTLY: 'Attenzione: Google Maps segna questo locale come chiuso definitivamente.',
}

interface CreateRestaurantFormState {
  name: string
  cuisine: string
  description: string
  mapsUrl: string
  websiteUrl: string
  phone: string
  address: string
  priceTier: 1 | 2 | 3 | 4 | null
  walkMinutes: number | null
  photos: MapsImportedPhoto[]
  googleRating: number | null
  googleRatingCount: number | null
}

const EMPTY_CREATE_FORM: CreateRestaurantFormState = {
  name: '', cuisine: '', description: '', mapsUrl: '', websiteUrl: '', phone: '', address: '', priceTier: null, walkMinutes: null,
  photos: [], googleRating: null, googleRatingCount: null,
}

function CreateRestaurantModal({ open, categories, hotelId, hotelAddress, onClose, onSaved }: {
  open: boolean
  categories: DiningCategory[]
  hotelId: string
  hotelAddress: string | null
  onClose: () => void
  onSaved: () => Promise<void>
}) {
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [categoryId, setCategoryId] = useState('')
  const [isExternal, setIsExternal] = useState(true)
  const [requiresOnlineBooking, setRequiresOnlineBooking] = useState(false)
  const [form, setForm] = useState<CreateRestaurantFormState>(EMPTY_CREATE_FORM)

  const [importUrl, setImportUrl] = useState('')
  const [importing, setImporting] = useState(false)
  const [importNotice, setImportNotice] = useState<string | null>(null)
  // Separate from importNotice -- a neutral "ecco cosa ho trovato" summary
  // after a successful import, never styled like the warnings/errors above.
  const [importInfo, setImportInfo] = useState<string | null>(null)
  // Orari arrivano come righe separate (restaurant_hours), non un campo del
  // form -- tenute qui finché il ristorante non esiste davvero, poi
  // inserite una per una subito dopo la creazione (vedi submit()).
  const [importedHours, setImportedHours] = useState<MapsImportedHour[]>([])

  // Resets the whole form, but ONLY on open itself -- `categories` (read
  // below for its starting default) is deliberately NOT a dependency here.
  // `categories` is a fresh array every time RestaurantsTab reloads it, and
  // reloads can happen while this modal is already open and someone is
  // mid-edit (typing, or having just run "Importa da Google Maps"); with
  // `categories` in this effect's deps, that reload re-ran this reset and
  // silently wiped everything they'd just entered.
  useEffect(() => {
    if (open) {
      setSaving(false)
      setError(null)
      setCategoryId((current) => current || categories[0]?.id || '')
      setIsExternal(true)
      setRequiresOnlineBooking(false)
      setForm(EMPTY_CREATE_FORM)
      setImportUrl('')
      setImportNotice(null)
      setImportInfo(null)
      setImportedHours([])
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  // Picks a default category once the list is available, without
  // overwriting a choice already made -- covers the modal opening before
  // `categories` has loaded (the "Nuovo ristorante" button is hidden until
  // then today, but this stays correct even if that changes).
  useEffect(() => {
    if (open && !categoryId && categories.length > 0) setCategoryId(categories[0].id)
  }, [open, categories, categoryId])

  async function onImport() {
    if (!importUrl.trim()) {
      setImportNotice(MAPS_LOOKUP_ERROR_MESSAGES.invalid_input)
      return
    }
    setImporting(true)
    setImportNotice(null)
    setImportInfo(null)
    try {
      const place = await lookupMapsPlace(supabase, importUrl.trim(), hotelAddress)
      setForm((current) => ({
        ...current,
        name: place.name,
        address: place.address ?? current.address,
        phone: place.phone ?? current.phone,
        websiteUrl: place.websiteUrl ?? current.websiteUrl,
        mapsUrl: place.mapsUrl,
        // Only a loose hint from Google's own categories -- never
        // overwrites something the person already typed by hand.
        cuisine: current.cuisine || place.cuisineHint || '',
        priceTier: place.priceTier ?? current.priceTier,
        walkMinutes: place.walkMinutes ?? current.walkMinutes,
        photos: place.photos.length > 0 ? place.photos : current.photos,
        googleRating: place.googleRating ?? current.googleRating,
        googleRatingCount: place.googleRatingCount ?? current.googleRatingCount,
      }))
      setImportedHours(place.hours)
      const infoParts = [
        place.hours.length > 0 ? `Orari importati (${place.hours.length} fasce).` : null,
        place.walkMinutes != null ? `Distanza a piedi: ${place.walkMinutes} min.` : null,
        place.photos.length > 0 ? `Foto importate (${place.photos.length}).` : null,
        place.googleRating != null ? `Voto Google: ${place.googleRating.toFixed(1)}${place.googleRatingCount != null ? ` (${place.googleRatingCount} recensioni)` : ''}.` : null,
      ].filter(Boolean)
      setImportInfo(infoParts.length > 0 ? infoParts.join(' ') : null)
      setImportNotice(place.businessStatus ? (BUSINESS_STATUS_WARNINGS[place.businessStatus] ?? null) : null)
    } catch (cause) {
      const code = cause instanceof MapsLookupError ? cause.code : null
      setImportNotice((code && MAPS_LOOKUP_ERROR_MESSAGES[code]) ?? 'Importazione non riuscita. Puoi comunque compilare i campi a mano.')
    } finally {
      setImporting(false)
    }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setSaving(true)
    setError(null)
    try {
      const input: RestaurantInput = {
        category_id: categoryId,
        name: form.name,
        description: form.description || null,
        is_external: isExternal,
        maps_url: form.mapsUrl || null,
        website_url: form.websiteUrl || null,
        phone: form.phone || null,
        address: form.address || null,
        requires_online_booking: requiresOnlineBooking,
        cuisine: form.cuisine || null,
        price_tier: form.priceTier,
        walk_minutes: form.walkMinutes,
        cover_image_url: form.photos[0]?.url ?? null,
        cover_image_attribution: form.photos[0]?.attribution ?? null,
        google_rating: form.googleRating,
        google_rating_count: form.googleRatingCount,
        short_description: null,
        guest_tags: [],
        is_recommended: false,
        concierge_description: null,
        ideal_for: null,
        guest_profile: null,
      }
      const created = await createRestaurant(supabase, hotelId, input)
      // Orari importati da Google Maps: righe a parte (restaurant_hours),
      // inseribili solo ora che il ristorante ha davvero un id. Un
      // fallimento qui non deve far sembrare la creazione stessa fallita --
      // il ristorante esiste già; gli orari si aggiungono comunque a mano
      // dalla scheda "Orari".
      for (const hour of importedHours) {
        try {
          await addHour(supabase, created.id, hour.dayOfWeek, hour.opensAt, hour.closesAt)
        } catch (cause) {
          console.error('import orari failed', cause)
        }
      }
      if (form.photos.length > 0) {
        try {
          await replaceRestaurantPhotos(supabase, created.id, form.photos)
        } catch (cause) {
          console.error('import galleria failed', cause)
        }
      }
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
      <div className="form-field" style={{ marginBottom: 14 }}>
        <span>Importa da Google Maps (facoltativo)</span>
        <div style={{ display: 'flex', gap: 8 }}>
          <input
            type="url"
            value={importUrl}
            onChange={(event) => setImportUrl(event.target.value)}
            placeholder="https://maps.app.goo.gl/… o il link della pagina del ristorante"
            style={{ flex: 1 }}
          />
          <Button type="button" variant="secondary" onClick={() => void onImport()} disabled={importing}>
            <Download size={14} /> {importing ? 'Importo…' : 'Importa'}
          </Button>
        </div>
        {importNotice ? <p className="form-error" role="alert" style={{ marginTop: 6 }}>{importNotice}</p> : null}
        {importInfo ? <p className="muted" style={{ marginTop: 6 }}>{importInfo}</p> : null}
        {!hotelAddress ? <p className="muted" style={{ marginTop: 6 }}>Imposta l'indirizzo della struttura in Impostazioni per importare anche la distanza a piedi.</p> : null}
        {form.photos.length > 0 ? (
          <div style={{ marginTop: 10, display: 'flex', gap: 8, overflowX: 'auto', paddingBottom: 4 }}>
            {/* Google's Place Photos terms require crediting each photo's
                own author wherever it's shown -- each thumbnail carries its
                own attribution as a title (shown on hover), since the
                strip can mix photos from different contributors. */}
            {form.photos.map((photo, index) => (
              <img key={index} src={photo.url} alt="" title={photo.attribution ?? undefined} style={{ width: 72, height: 72, borderRadius: 8, objectFit: 'cover', flexShrink: 0 }} />
            ))}
          </div>
        ) : null}
      </div>
      <form className="modal-form" id="restaurant-create-form" onSubmit={submit}>
        <label className="form-field"><span>Nome</span><input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} required minLength={1} maxLength={120} /></label>
        <label className="form-field"><span>Categoria</span>
          <Select id="restaurant-category" name="category" value={categoryId} onChange={setCategoryId}>
            {categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}
          </Select>
        </label>
        <label className="form-field"><span>Fascia prezzo</span>
          <Select id="restaurant-price-tier" name="price_tier" value={String(form.priceTier ?? '')} onChange={(v) => setForm((f) => ({ ...f, priceTier: (v ? Number(v) : null) as CreateRestaurantFormState['priceTier'] }))}>
            <option value="">—</option>
            <option value="1">€</option><option value="2">€€</option><option value="3">€€€</option><option value="4">€€€€</option>
          </Select>
        </label>
        <label className="form-field"><span>Distanza a piedi (minuti)</span><input type="number" min={0} value={form.walkMinutes ?? ''} onChange={(e) => setForm((f) => ({ ...f, walkMinutes: e.target.value ? Number(e.target.value) : null }))} /></label>
        <label className="form-field"><span>Cucina</span><input value={form.cuisine} onChange={(e) => setForm((f) => ({ ...f, cuisine: e.target.value }))} maxLength={60} /></label>
        <label className="form-field"><span>Descrizione</span><textarea value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} rows={2} maxLength={500} spellCheck={false} /></label>
        <label className="form-field switch-field"><span>Ristorante convenzionato (esterno)</span><Switch checked={isExternal} onChange={() => setIsExternal((v) => !v)} aria-label="Ristorante esterno" /></label>
        <label className="form-field switch-field"><span>Prenotazione richiesta solo dal sito del ristorante</span><Switch checked={requiresOnlineBooking} onChange={() => setRequiresOnlineBooking((v) => !v)} aria-label="Prenotazione solo online" /></label>
        <label className="form-field"><span>Link Google Maps</span><input value={form.mapsUrl} onChange={(e) => setForm((f) => ({ ...f, mapsUrl: e.target.value }))} type="url" placeholder="https://maps.google.com/…" /></label>
        <label className="form-field"><span>Sito web</span><input value={form.websiteUrl} onChange={(e) => setForm((f) => ({ ...f, websiteUrl: e.target.value }))} type="url" placeholder="https://…" /></label>
        <label className="form-field"><span>Telefono</span><input value={form.phone} onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))} /></label>
        <label className="form-field"><span>Indirizzo</span><input value={form.address} onChange={(e) => setForm((f) => ({ ...f, address: e.target.value }))} /></label>
        {error ? <p className="form-error" role="alert">{error}</p> : null}
      </form>
    </Modal>
  )
}

function HoursModal({ restaurant, onClose }: { restaurant: Restaurant | null; onClose: () => void }) {
  const [hours, setHours] = useState<RestaurantHour[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const pushUndo = useUndo()
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
      pushUndo({
        message: `Orario di ${DAY_LABELS[hour.day_of_week]} eliminato.`,
        undo: async () => {
          await restoreHour(supabase, hour)
          await load()
        },
      })
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

function GalleryModal({ restaurant, hotelAddress, onClose, onSaved }: {
  restaurant: Restaurant | null
  hotelAddress: string | null
  onClose: () => void
  onSaved: () => Promise<void>
}) {
  const [photos, setPhotos] = useState<RestaurantPhoto[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  const [refreshNotice, setRefreshNotice] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!restaurant) return
    try {
      setLoading(true)
      setError(null)
      setPhotos(await listRestaurantPhotos(supabase, restaurant.id))
    } catch (cause) {
      setError(readableDiningError(cause))
    } finally {
      setLoading(false)
    }
  }, [restaurant])

  useEffect(() => { void load() }, [load])
  useEffect(() => { if (restaurant) setRefreshNotice(null) }, [restaurant])

  // Re-runs the same Google Maps lookup the creation form uses, keyed off
  // this restaurant's own maps_url (no link to paste again) -- replaces
  // its whole gallery and cover photo, and refreshes its rating, with
  // whatever Google has now.
  async function onRefresh() {
    if (!restaurant) return
    if (!restaurant.maps_url) {
      setRefreshNotice('Questo ristorante non ha un link Google Maps salvato: aggiungilo dalla scheda "Gestisci" prima di poter aggiornare le foto.')
      return
    }
    setRefreshing(true)
    setRefreshNotice(null)
    try {
      const place = await lookupMapsPlace(supabase, restaurant.maps_url, hotelAddress)
      await replaceRestaurantPhotos(supabase, restaurant.id, place.photos)
      await updateRestaurant(supabase, restaurant.id, {
        cover_image_url: place.photos[0]?.url ?? null,
        cover_image_attribution: place.photos[0]?.attribution ?? null,
        google_rating: place.googleRating,
        google_rating_count: place.googleRatingCount,
      })
      await load()
      await onSaved()
      setRefreshNotice(place.photos.length > 0 ? `Foto aggiornate (${place.photos.length}).` : 'Nessuna foto trovata su Google Maps per questo locale.')
    } catch (cause) {
      const code = cause instanceof MapsLookupError ? cause.code : null
      setRefreshNotice((code && MAPS_LOOKUP_ERROR_MESSAGES[code]) ?? 'Aggiornamento non riuscito. Riprova.')
    } finally {
      setRefreshing(false)
    }
  }

  return (
    <Modal
      open={Boolean(restaurant)}
      title={`Foto — ${restaurant?.name ?? ''}`}
      description="Scorri per vedere tutte le foto importate da Google Maps."
      onClose={onClose}
      footer={<Button variant="secondary" onClick={() => void onRefresh()} disabled={refreshing}><Download size={14} /> {refreshing ? 'Aggiorno…' : 'Aggiorna da Google Maps'}</Button>}
    >
      {error ? <p className="form-error" role="alert">{error}</p> : null}
      {refreshNotice ? <p className="muted" style={{ marginBottom: 10 }}>{refreshNotice}</p> : null}
      {photos.length > 0 ? (
        <div style={{ display: 'flex', gap: 10, overflowX: 'auto', paddingBottom: 6 }}>
          {photos.map((photo) => (
            <img key={photo.id} src={photo.image_url} alt="" title={photo.attribution ?? undefined} style={{ width: 160, height: 160, borderRadius: 10, objectFit: 'cover', flexShrink: 0 }} />
          ))}
        </div>
      ) : (!loading ? <p className="muted">Nessuna foto importata. Usa "Aggiorna da Google Maps" per recuperarle.</p> : null)}
    </Modal>
  )
}
