import type { SupabaseClient } from '@supabase/supabase-js'
import type { ChangeLogEntry, ConfirmationStatus, DiningCategory, GuestTag, ReservationAlternative, ReservationFeedback, ReservationRequest, Restaurant, RestaurantHour, RestaurantOperationalProfile } from './types'

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

export async function updateCategory(client: SupabaseClient, id: string, changes: Partial<Pick<DiningCategory, 'name' | 'active' | 'sort_order'>>): Promise<void> {
  await mutateOneOrThrow(client, 'dining_categories', 'id', id, 'update', changes)
}

export async function deleteCategory(client: SupabaseClient, id: string): Promise<void> {
  await mutateOneOrThrow(client, 'dining_categories', 'id', id, 'delete')
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

export type RestaurantInput = Omit<Restaurant, 'id' | 'hotel_id' | 'sort_order' | 'active'>

export async function createRestaurant(client: SupabaseClient, hotelId: string, input: RestaurantInput): Promise<Restaurant> {
  const { data, error } = await client
    .from('restaurants')
    .insert({ ...input, hotel_id: hotelId })
    .select('*')
    .single()
  if (error) throw error
  return data as Restaurant
}

export async function updateRestaurant(client: SupabaseClient, id: string, changes: Partial<RestaurantInput & { active: boolean; sort_order: number }>): Promise<void> {
  await mutateOneOrThrow(client, 'restaurants', 'id', id, 'update', changes)
}

export async function deleteRestaurant(client: SupabaseClient, id: string): Promise<void> {
  await mutateOneOrThrow(client, 'restaurants', 'id', id, 'delete')
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

export interface CreateReservationInput {
  restaurant_id: string
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
  changes: Partial<CreateReservationInput & { confirmation_status: ConfirmationStatus; confirmation_note: string | null; assigned_to: string | null }>,
): Promise<void> {
  await mutateOneOrThrow(client, 'restaurant_reservation_requests', 'id', id, 'update', changes)
}

export async function deleteReservation(client: SupabaseClient, id: string): Promise<void> {
  await mutateOneOrThrow(client, 'restaurant_reservation_requests', 'id', id, 'delete')
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

export async function listChangeLog(client: SupabaseClient, hotelId: string): Promise<ChangeLogEntry[]> {
  const { data, error } = await client
    .from('dining_change_log')
    .select('*')
    .eq('hotel_id', hotelId)
    .order('created_at', { ascending: false })
    .limit(200)
  if (error) throw error
  return data as ChangeLogEntry[]
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
