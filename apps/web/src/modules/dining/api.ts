import type { SupabaseClient } from '@supabase/supabase-js'
import type { AttendanceStatus, ChangeLogEntry, ConfirmationStatus, DiningCategory, GuestTag, ReservationAlternative, ReservationFeedback, ReservationRequest, Restaurant, RestaurantHour, RestaurantOperationalProfile, ServicePartner, ServicePartnerUser, ServicePartnerWithContext } from './types'

// Untyped SupabaseClient, same as HousekeepingModule's own `supabase` prop:
// the shared Database type (core-sdk) doesn't know about this module's
// tables, and there's no reason it should -- Dining lives entirely inside
// apps/web, so it just queries its own tables directly through the raw
// client, the same escape hatch CoreClient.raw exists for.

// A Supabase .update()/.delete() with no matching row (RLS silently
// filtered it out, or the id is simply wrong) returns `error: null` and an
// empty result -- NOT an error. Every mutation below that doesn't already
// read back a row via a transactional RPC routes through this instead of a
// bare `if (error) throw error`, so a 0-row write surfaces as a real,
// catchable error instead of a silent no-op the UI reports as "Salvato".
async function mutateOneOrThrow(client: SupabaseClient, table: string, idColumn: string, idValue: string, op: 'update' | 'delete', changes: Record<string, unknown> = {}): Promise<void> {
  const query = op === 'update' ? client.from(table).update(changes).eq(idColumn, idValue) : client.from(table).delete().eq(idColumn, idValue)
  const { data, error } = await query.select(idColumn)
  if (error) throw error
  if (!data || data.length === 0) {
    throw new Error(`${op} on ${table} affected no rows -- not found, or not permitted`)
  }
}

export async function listCategories(client: SupabaseClient, hotelId: string): Promise<DiningCategory[]> {
  const { data, error } = await client
    .from('dining_categories')
    .select('*')
    .eq('hotel_id', hotelId)
    .order('sort_order')
  if (error) throw error
  return data as DiningCategory[]
}

export async function createCategory(client: SupabaseClient, hotelId: string, name: string): Promise<void> {
  const { error } = await client.from('dining_categories').insert({ hotel_id: hotelId, name })
  if (error) throw error
}

export async function updateCategory(client: SupabaseClient, id: string, changes: Partial<Pick<DiningCategory, 'name' | 'active' | 'sort_order' | 'image_url'>>): Promise<void> {
  await mutateOneOrThrow(client, 'dining_categories', 'id', id, 'update', changes)
}

export async function deleteCategory(client: SupabaseClient, id: string): Promise<void> {
  await mutateOneOrThrow(client, 'dining_categories', 'id', id, 'delete')
}

// Undo for deleteCategory -- re-inserts the exact row (same id) the caller
// captured just before deleting it.
export async function restoreCategory(client: SupabaseClient, category: DiningCategory): Promise<void> {
  const { error } = await client.from('dining_categories').insert(category)
  if (error) throw error
}

// Same mechanism Housekeeping's own queue uses (subscribeToQueue) -- without
// it, one staff member adding/editing a category only ever shows up for
// everyone else's already-open session on their next manual reload.
//
// The suffix makes every call's channel topic unique: DiningPage keeps all
// five of its tabs mounted at once (only hidden, never unmounted), so
// RestaurantsTab and CategoriesTab both subscribe to this same table at the
// same time -- without a unique topic per subscriber, both tried to join
// the identical Phoenix channel name, which the server read as a duplicate
// join and force-closed, and the client kept rejoining (and getting closed
// again) in a tight loop -- the "continuous refresh" this was causing.
export function subscribeToCategories(client: SupabaseClient, hotelId: string, onChange: () => void): () => void {
  const channel = client
    .channel(`dining-categories-${hotelId}-${crypto.randomUUID()}`)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'dining_categories', filter: `hotel_id=eq.${hotelId}` }, onChange)
    .subscribe()
  return () => {
    client.removeChannel(channel)
  }
}

export async function listRestaurants(client: SupabaseClient, hotelId: string): Promise<Restaurant[]> {
  const { data, error } = await client
    .from('restaurants')
    .select('*')
    .eq('hotel_id', hotelId)
    .order('sort_order')
  if (error) throw error
  return data as Restaurant[]
}

// partner_id excluded same as sort_order/active -- a new restaurant starts
// unlinked, set later from its management screen, never at creation time.
export type RestaurantInput = Omit<Restaurant, 'id' | 'hotel_id' | 'sort_order' | 'active' | 'partner_id'>

export async function createRestaurant(client: SupabaseClient, hotelId: string, input: RestaurantInput): Promise<Restaurant> {
  const { data, error } = await client
    .from('restaurants')
    .insert({ ...input, hotel_id: hotelId })
    .select('*')
    .single()
  if (error) throw error
  return data as Restaurant
}

export async function updateRestaurant(client: SupabaseClient, id: string, changes: Partial<RestaurantInput & { active: boolean; sort_order: number; partner_id: string | null }>): Promise<void> {
  await mutateOneOrThrow(client, 'restaurants', 'id', id, 'update', changes)
}

export async function deleteRestaurant(client: SupabaseClient, id: string): Promise<void> {
  await mutateOneOrThrow(client, 'restaurants', 'id', id, 'delete')
}

// Undo for deleteRestaurant -- the delete cascades to restaurant_hours and
// restaurant_photos, so the caller captures those too (just before
// deleting) and this puts all three back, same ids, in one call.
export async function restoreRestaurant(client: SupabaseClient, restaurant: Restaurant, hours: RestaurantHour[], photos: RestaurantPhoto[]): Promise<void> {
  const { error } = await client.from('restaurants').insert(restaurant)
  if (error) throw error
  if (hours.length > 0) {
    const { error: hoursError } = await client.from('restaurant_hours').insert(hours)
    if (hoursError) throw hoursError
  }
  if (photos.length > 0) {
    const { error: photosError } = await client.from('restaurant_photos').insert(photos)
    if (photosError) throw photosError
  }
}

// Same reasoning as subscribeToCategories above -- a restaurant another
// staff member just added (or edited, or deleted) otherwise never appears
// here until this session happens to reload the page.
export function subscribeToRestaurants(client: SupabaseClient, hotelId: string, onChange: () => void): () => void {
  // Unique per call, same reasoning as subscribeToCategories above -- only
  // one tab subscribes to this table today, but a unique topic costs
  // nothing and means a second one added later can never collide either.
  const channel = client
    .channel(`dining-restaurants-${hotelId}-${crypto.randomUUID()}`)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'restaurants', filter: `hotel_id=eq.${hotelId}` }, onChange)
    .subscribe()
  return () => {
    client.removeChannel(channel)
  }
}

// service_partners isn't hotel_id-scoped (see its own migration comment) --
// any staff with dining.manage on any property can read/link/create one,
// enforced by has_permission_anywhere() rather than the usual per-hotel
// check every other function in this file relies on.
export async function listServicePartners(client: SupabaseClient, kind: ServicePartner['kind'] = 'restaurant'): Promise<ServicePartner[]> {
  const { data, error } = await client
    .from('service_partners')
    .select('id, kind, name, notes')
    .eq('kind', kind)
    .order('name')
  if (error) throw error
  return data as ServicePartner[]
}

export async function createServicePartner(client: SupabaseClient, kind: ServicePartner['kind'], name: string): Promise<ServicePartner> {
  const { data, error } = await client
    .from('service_partners')
    .insert({ kind, name })
    .select('id, kind, name, notes')
    .single()
  if (error) throw error
  return data as ServicePartner
}

// Dining's own Impostazioni tab (SettingsTab/PartnerAccountsSection) --
// every service_partner this ONE hotel's restaurants link to, each with
// the account(s) already created for it. Two round trips (restaurants+
// service_partners, then service_partner_users for those partner ids)
// rather than one deep nested select: PostgREST embedding a many-to-many
// through restaurants would repeat each partner once per linked
// restaurant at this hotel, which this grouping has to undo anyway.
export async function listServicePartnersForHotel(client: SupabaseClient, hotelId: string): Promise<ServicePartnerWithContext[]> {
  const { data: restaurantRows, error: restaurantError } = await client
    .from('restaurants')
    .select('name, partner_id, service_partners(id, kind, name, notes)')
    .eq('hotel_id', hotelId)
    .not('partner_id', 'is', null)
  if (restaurantError) throw restaurantError

  const byPartnerId = new Map<string, ServicePartnerWithContext>()
  for (const row of (restaurantRows ?? []) as unknown as { name: string; partner_id: string; service_partners: ServicePartner | null }[]) {
    if (!row.service_partners) continue
    const existing = byPartnerId.get(row.partner_id)
    if (existing) {
      existing.restaurantNames.push(row.name)
    } else {
      byPartnerId.set(row.partner_id, { ...row.service_partners, restaurantNames: [row.name], users: [] })
    }
  }
  if (byPartnerId.size === 0) return []

  const { data: userRows, error: usersError } = await client
    .from('service_partner_users')
    .select('id, full_name, active, created_at, service_partner_id')
    .in('service_partner_id', [...byPartnerId.keys()])
    .order('created_at')
  if (usersError) throw usersError
  for (const user of (userRows ?? []) as unknown as (ServicePartnerUser & { service_partner_id: string })[]) {
    byPartnerId.get(user.service_partner_id)?.users.push(user)
  }

  return [...byPartnerId.values()].sort((a, b) => a.name.localeCompare(b.name, 'it'))
}

export async function setServicePartnerUserActive(client: SupabaseClient, id: string, active: boolean): Promise<void> {
  await mutateOneOrThrow(client, 'service_partner_users', 'id', id, 'update', { active })
}

export class CreatePartnerUserError extends Error {
  constructor(readonly code: string | null) {
    super(code ?? 'create_failed')
  }
}

export async function createServicePartnerUserCredentials(
  client: SupabaseClient, servicePartnerId: string, fullName: string, email: string, password: string,
): Promise<void> {
  const { error } = await client.functions.invoke('create-service-partner-user-credentials', {
    body: { servicePartnerId, fullName, email, password },
  })
  if (error) {
    let code: string | null = null
    const context = (error as { context?: unknown }).context
    if (context instanceof Response) {
      const payload = await context.json().catch(() => null) as { error?: unknown } | null
      code = typeof payload?.error === 'string' ? payload.error : null
    }
    throw new CreatePartnerUserError(code)
  }
}

// Same error-unwrapping shape as lookupMapsPlace's own helper below --
// supabase.functions.invoke puts a non-2xx response's {error: code} body on
// error.context rather than throwing it directly.
export class InvitePartnerUserError extends Error {
  constructor(readonly code: string | null) {
    super(code ?? 'invite_failed')
  }
}

export async function inviteServicePartnerUser(client: SupabaseClient, servicePartnerId: string, fullName: string, email: string): Promise<void> {
  const { error } = await client.functions.invoke('invite-service-partner-user', { body: { servicePartnerId, fullName, email } })
  if (error) {
    let code: string | null = null
    const context = (error as { context?: unknown }).context
    if (context instanceof Response) {
      const payload = await context.json().catch(() => null) as { error?: unknown } | null
      code = typeof payload?.error === 'string' ? payload.error : null
    }
    throw new InvitePartnerUserError(code)
  }
}

export class MapsLookupError extends Error {
  constructor(readonly code: string | null) {
    super(code ?? 'maps_lookup_failed')
    this.name = 'MapsLookupError'
  }
}

export interface MapsImportedHour {
  dayOfWeek: number
  opensAt: string
  closesAt: string
}

export interface MapsImportedPhoto {
  url: string
  // null only when Google supplied no author name for this specific
  // photo -- display it alongside the image wherever shown, per Google's
  // Place Photos attribution requirement.
  attribution: string | null
}

export interface MapsPlaceLookupResult {
  name: string
  address: string | null
  phone: string | null
  websiteUrl: string | null
  mapsUrl: string
  priceTier: 1 | 2 | 3 | 4 | null
  cuisineHint: string | null
  businessStatus: string | null
  // null when the hotel's own address wasn't supplied, or the Routes API
  // call failed (not enabled yet on this key, a transient error, ...) --
  // never a reason to fail the rest of the import.
  walkMinutes: number | null
  hours: MapsImportedHour[]
  // Best-effort, same reasoning as walkMinutes -- empty if the place has
  // no photos, or every Photo Media fetch/upload failed. Capped server-side
  // (not every photo Google has).
  photos: MapsImportedPhoto[]
  googleRating: number | null
  googleRatingCount: number | null
}

// Same error-unwrapping shape as Smart Inbox's own `invoke` helper --
// supabase.functions.invoke puts a non-2xx response in `error.context`
// rather than throwing with the function's own {error: code} body.
export async function lookupMapsPlace(client: SupabaseClient, url: string, hotelAddress: string | null): Promise<MapsPlaceLookupResult> {
  const { data, error } = await client.functions.invoke('maps-place-lookup', { body: { url, hotelAddress } })
  if (error) {
    let code: string | null = null
    const context = (error as { context?: unknown }).context
    if (context instanceof Response) {
      const payload = await context.json().catch(() => null) as { error?: unknown } | null
      code = typeof payload?.error === 'string' ? payload.error : null
    }
    throw new MapsLookupError(code)
  }
  return data as MapsPlaceLookupResult
}

export async function listHours(client: SupabaseClient, restaurantId: string): Promise<RestaurantHour[]> {
  const { data, error } = await client
    .from('restaurant_hours')
    .select('*')
    .eq('restaurant_id', restaurantId)
    .order('day_of_week')
    .order('opens_at')
  if (error) throw error
  return data as RestaurantHour[]
}

export async function addHour(client: SupabaseClient, restaurantId: string, dayOfWeek: number, opensAt: string, closesAt: string): Promise<void> {
  const { error } = await client
    .from('restaurant_hours')
    .insert({ restaurant_id: restaurantId, day_of_week: dayOfWeek, opens_at: opensAt, closes_at: closesAt })
  if (error) throw error
}

export async function deleteHour(client: SupabaseClient, id: string): Promise<void> {
  await mutateOneOrThrow(client, 'restaurant_hours', 'id', id, 'delete')
}

export async function restoreHour(client: SupabaseClient, hour: RestaurantHour): Promise<void> {
  const { error } = await client.from('restaurant_hours').insert(hour)
  if (error) throw error
}

export interface RestaurantPhoto {
  id: string
  restaurant_id: string
  image_url: string
  attribution: string | null
  sort_order: number
}

export async function listRestaurantPhotos(client: SupabaseClient, restaurantId: string): Promise<RestaurantPhoto[]> {
  const { data, error } = await client
    .from('restaurant_photos')
    .select('*')
    .eq('restaurant_id', restaurantId)
    .order('sort_order')
  if (error) throw error
  return data as RestaurantPhoto[]
}

// Swaps a restaurant's whole gallery for a freshly imported one -- re-running
// an import (the create flow, or "Aggiorna foto" on an existing restaurant)
// is meant to replace what Google has now, not pile duplicates on top of
// whatever was imported last time.
export async function replaceRestaurantPhotos(client: SupabaseClient, restaurantId: string, photos: MapsImportedPhoto[]): Promise<void> {
  const { error: deleteError } = await client.from('restaurant_photos').delete().eq('restaurant_id', restaurantId)
  if (deleteError) throw deleteError
  if (photos.length === 0) return
  const { error: insertError } = await client
    .from('restaurant_photos')
    .insert(photos.map((photo, index) => ({
      restaurant_id: restaurantId,
      image_url: photo.url,
      attribution: photo.attribution,
      sort_order: index,
    })))
  if (insertError) throw insertError
}

export async function listReservations(client: SupabaseClient, hotelId: string): Promise<ReservationRequest[]> {
  const { data, error } = await client
    .from('restaurant_reservation_requests')
    .select('*')
    .eq('hotel_id', hotelId)
    .order('reservation_date', { ascending: false })
    .order('reservation_time', { ascending: false })
  if (error) throw error
  // guest_preference_tags is a column this module's own migration adds --
  // on a database where that migration hasn't been applied yet, the key is
  // simply absent from the row, and every renderer that calls .length/.map
  // on it (OggiPanel, TuttePanel, BookingDetailSlideOver) would crash the
  // whole page instead of just rendering an empty tag list.
  return (data as ReservationRequest[]).map((row) => ({ ...row, guest_preference_tags: row.guest_preference_tags ?? [] }))
}

// Same reasoning as subscribeToCategories/subscribeToRestaurants above --
// without it, two reception staff working the "Da gestire" queue together
// only ever see each other's claims/updates on a manual reload, which is
// exactly the tab where that lag matters most.
export function subscribeToReservations(client: SupabaseClient, hotelId: string, onChange: () => void): () => void {
  const channel = client
    .channel(`dining-reservations-${hotelId}-${crypto.randomUUID()}`)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'restaurant_reservation_requests', filter: `hotel_id=eq.${hotelId}` }, onChange)
    .subscribe()
  return () => {
    client.removeChannel(channel)
  }
}

export interface CreateReservationInput {
  // Exactly one of the two -- see the restaurant_reservation_requests_restaurant_xor_custom
  // check constraint. A restaurant not on this hotel's own list (custom_restaurant_name set)
  // leaves restaurant_id null.
  restaurant_id: string | null
  custom_restaurant_name: string | null
  room_number: string | null
  guest_name: string
  party_size: number
  reservation_date: string
  reservation_time: string
  booking_reference: string | null
  special_requests: string | null
  staff_notes: string | null
  guest_preference_tags?: string[]
  // Manual staff entry defaults to 'scheduled' ("Da prenotare") in the
  // caller rather than here -- this stays optional so other callers (e.g. a
  // future guest-submission path) can omit it and take the column's own
  // 'new' default.
  confirmation_status?: ConfirmationStatus
}

export async function createReservation(client: SupabaseClient, hotelId: string, staffProfileId: string | null, input: CreateReservationInput): Promise<void> {
  const { error } = await client.from('restaurant_reservation_requests').insert({
    ...input,
    hotel_id: hotelId,
    source: 'staff',
    created_by: staffProfileId,
    assigned_to: staffProfileId,
  })
  if (error) throw error
}

export async function updateReservation(
  client: SupabaseClient,
  id: string,
  changes: Partial<CreateReservationInput & { confirmation_status: ConfirmationStatus; attendance_status: AttendanceStatus; confirmation_note: string | null; assigned_to: string | null }>,
): Promise<void> {
  await mutateOneOrThrow(client, 'restaurant_reservation_requests', 'id', id, 'update', changes)
}

export async function deleteReservation(client: SupabaseClient, id: string): Promise<void> {
  await mutateOneOrThrow(client, 'restaurant_reservation_requests', 'id', id, 'delete')
}

// Undo for deleteReservation -- the delete cascades to
// restaurant_reservation_alternatives, so the caller captures that too
// (just before deleting) and this puts both back, same ids, in one call.
// dining_change_log keeps its own rows for this reservation_id regardless
// (no FK to cascade), so its history survives the round trip untouched.
//
// restaurant_reservation_feedback also cascades, but can't be restored the
// same way: it's guest-submitted and the `authenticated` role has no
// INSERT grant on it at all (only service_role does, via whatever path
// guests use to leave feedback), so a staff session can never recreate a
// feedback row directly. The caller warns at delete time instead -- see
// BookingDetailSlideOver's onDelete -- rather than letting the whole undo
// throw once it gets around to that insert.
export async function restoreReservation(client: SupabaseClient, reservation: ReservationRequest, alternatives: ReservationAlternative[]): Promise<void> {
  const { error } = await client.from('restaurant_reservation_requests').insert(reservation)
  if (error) throw error
  if (alternatives.length > 0) {
    const { error: altError } = await client.from('restaurant_reservation_alternatives').insert(alternatives)
    if (altError) throw altError
  }
}

export async function getOperationalProfile(client: SupabaseClient, restaurantId: string): Promise<RestaurantOperationalProfile | null> {
  const { data, error } = await client
    .from('restaurant_operational_profiles')
    .select('*')
    .eq('restaurant_id', restaurantId)
    .maybeSingle()
  if (error) throw error
  return data as RestaurantOperationalProfile | null
}

export type OperationalProfileInput = Omit<RestaurantOperationalProfile, 'restaurant_id'>

// restaurant_operational_profiles is 1:1 on restaurant_id with no separate
// surrogate key, so "save" is always an upsert keyed on that column -- the
// management panel's Operativo tab never needs to know whether a row
// already exists.
export async function saveOperationalProfile(client: SupabaseClient, restaurantId: string, input: OperationalProfileInput): Promise<void> {
  const { data, error } = await client
    .from('restaurant_operational_profiles')
    .upsert({ ...input, restaurant_id: restaurantId }, { onConflict: 'restaurant_id' })
    .select('restaurant_id')
  if (error) throw error
  if (!data || data.length === 0) {
    throw new Error('operational profile upsert affected no rows -- not found, or not permitted')
  }
}

// save_restaurant_management: RestaurantManagementSlideOver's "Salva
// modifiche" writes `restaurants` and `restaurant_operational_profiles`
// behind one button, which used to be two separate client calls -- a
// failure on the second silently left the restaurant's public fields saved
// but its operational profile not, with nothing telling the user which
// half actually persisted. This RPC does both in one transaction: either
// the whole form saves, or none of it does.
export interface RestaurantManagementInput {
  name: string
  category_id: string
  cuisine: string | null
  price_tier: Restaurant['price_tier']
  walk_minutes: number | null
  address: string | null
  website_url: string | null
  maps_url: string | null
  short_description: string | null
  guest_tags: string[]
  is_recommended: boolean
  sort_order: number
  concierge_description: string | null
  ideal_for: string | null
  guest_profile: string | null
  active: boolean
}

export async function saveRestaurantManagement(
  client: SupabaseClient,
  restaurantId: string,
  restaurant: RestaurantManagementInput,
  operational: OperationalProfileInput,
): Promise<void> {
  const { error } = await client.rpc('save_restaurant_management', {
    p_restaurant_id: restaurantId,
    p_name: restaurant.name,
    p_category_id: restaurant.category_id,
    p_cuisine: restaurant.cuisine,
    p_price_tier: restaurant.price_tier,
    p_walk_minutes: restaurant.walk_minutes,
    p_address: restaurant.address,
    p_website_url: restaurant.website_url,
    p_maps_url: restaurant.maps_url,
    p_short_description: restaurant.short_description,
    p_guest_tags: restaurant.guest_tags,
    p_is_recommended: restaurant.is_recommended,
    p_sort_order: restaurant.sort_order,
    p_concierge_description: restaurant.concierge_description,
    p_ideal_for: restaurant.ideal_for,
    p_guest_profile: restaurant.guest_profile,
    p_active: restaurant.active,
    p_contact_phone: operational.contact_phone,
    p_contact_email: operational.contact_email,
    p_contact_whatsapp: operational.contact_whatsapp,
    p_preferred_contact_method: operational.preferred_contact_method,
    p_contact_person: operational.contact_person,
    p_commercial_agreement: operational.commercial_agreement,
    p_commission_rate: operational.commission_rate,
    p_booking_notes: operational.booking_notes,
    p_difficult_times: operational.difficult_times,
    p_last_verified_on: operational.last_verified_on,
    p_commission_type: operational.commission_type,
    p_commission_basis: operational.commission_basis,
  })
  if (error) throw error
}

export async function listAlternatives(client: SupabaseClient, reservationId: string): Promise<ReservationAlternative[]> {
  const { data, error } = await client
    .from('restaurant_reservation_alternatives')
    .select('*')
    .eq('reservation_id', reservationId)
    .order('rank')
  if (error) throw error
  return data as ReservationAlternative[]
}

// Replaces the whole ranked list in one go -- the detail panel always edits
// the full ordered list at once (add/remove), never a single row in
// isolation -- via set_restaurant_reservation_alternatives, a single
// transactional RPC rather than a client-side delete-then-insert pair: a
// failure between those two steps used to leave a reservation with NO
// authorized alternatives at all, which is worse than the bad input that
// caused the failure. The RPC also re-validates server-side that every
// restaurant belongs to the reservation's own hotel, so a cross-hotel id
// never reaches the table at all.
export async function setAlternatives(client: SupabaseClient, reservationId: string, restaurantIds: string[]): Promise<void> {
  const { error } = await client.rpc('set_restaurant_reservation_alternatives', {
    p_reservation_id: reservationId,
    p_restaurant_ids: restaurantIds,
  })
  if (error) throw error
}

export async function listGuestTags(client: SupabaseClient, hotelId: string): Promise<GuestTag[]> {
  const { data, error } = await client
    .from('dining_guest_tags')
    .select('*')
    .eq('hotel_id', hotelId)
    .order('sort_order')
  if (error) throw error
  return data as GuestTag[]
}

export async function createGuestTag(client: SupabaseClient, hotelId: string, label: string): Promise<void> {
  const { error } = await client.from('dining_guest_tags').insert({ hotel_id: hotelId, label })
  if (error) throw error
}

export async function updateGuestTag(client: SupabaseClient, id: string, changes: Partial<Pick<GuestTag, 'label' | 'active' | 'sort_order'>>): Promise<void> {
  await mutateOneOrThrow(client, 'dining_guest_tags', 'id', id, 'update', changes)
}

export async function deleteGuestTag(client: SupabaseClient, id: string): Promise<void> {
  await mutateOneOrThrow(client, 'dining_guest_tags', 'id', id, 'delete')
}

export async function restoreGuestTag(client: SupabaseClient, tag: GuestTag): Promise<void> {
  const { error } = await client.from('dining_guest_tags').insert(tag)
  if (error) throw error
}

export interface RestaurantStats {
  total: number
  confirmed: number
}

// Performance tab stats, computed straight from the reservations the
// restaurant already has -- no new aggregate table, since both numbers are
// cheap to derive and only ever viewed one restaurant at a time.
export async function getRestaurantStats(client: SupabaseClient, restaurantId: string): Promise<RestaurantStats> {
  const { data, error } = await client
    .from('restaurant_reservation_requests')
    .select('confirmation_status')
    .eq('restaurant_id', restaurantId)
  if (error) throw error
  const rows = data as { confirmation_status: ConfirmationStatus }[]
  return { total: rows.length, confirmed: rows.filter((r) => r.confirmation_status === 'confirmed').length }
}

export async function getFeedback(client: SupabaseClient, reservationId: string): Promise<ReservationFeedback | null> {
  const { data, error } = await client
    .from('restaurant_reservation_feedback')
    .select('*')
    .eq('reservation_id', reservationId)
    .maybeSingle()
  if (error) throw error
  return data as ReservationFeedback | null
}

// Powers the booking detail panel's "Attività" timeline -- one reservation's
// own history, not the whole hotel's log, so no arbitrary limit is needed.
export async function listChangeLogForEntity(client: SupabaseClient, entityId: string): Promise<ChangeLogEntry[]> {
  const { data, error } = await client
    .from('dining_change_log')
    .select('*')
    .eq('entity_id', entityId)
    .order('created_at', { ascending: true })
  if (error) throw error
  return data as ChangeLogEntry[]
}
