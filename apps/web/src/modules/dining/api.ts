import type { SupabaseClient } from '@supabase/supabase-js'
import type { ChangeLogEntry, ConfirmationStatus, DiningCategory, GuestTag, ReservationAlternative, ReservationFeedback, ReservationRequest, Restaurant, RestaurantHour, RestaurantOperationalProfile } from './types'

// Untyped SupabaseClient, same as HousekeepingModule's own `supabase` prop:
// the shared Database type (core-sdk) doesn't know about this module's
// tables, and there's no reason it should -- Dining lives entirely inside
// apps/web, so it just queries its own tables directly through the raw
// client, the same escape hatch CoreClient.raw exists for.

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
  const { error } = await client.from('dining_categories').update(changes).eq('id', id)
  if (error) throw error
}

export async function deleteCategory(client: SupabaseClient, id: string): Promise<void> {
  const { error } = await client.from('dining_categories').delete().eq('id', id)
  if (error) throw error
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
  const { error } = await client.from('restaurants').update(changes).eq('id', id)
  if (error) throw error
}

export async function deleteRestaurant(client: SupabaseClient, id: string): Promise<void> {
  const { error } = await client.from('restaurants').delete().eq('id', id)
  if (error) throw error
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
  const { error } = await client.from('restaurant_hours').delete().eq('id', id)
  if (error) throw error
}

export async function listReservations(client: SupabaseClient, hotelId: string): Promise<ReservationRequest[]> {
  const { data, error } = await client
    .from('restaurant_reservation_requests')
    .select('*')
    .eq('hotel_id', hotelId)
    .order('reservation_date', { ascending: false })
    .order('reservation_time', { ascending: false })
  if (error) throw error
  return data as ReservationRequest[]
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
  const { error } = await client.from('restaurant_reservation_requests').update(changes).eq('id', id)
  if (error) throw error
}

export async function deleteReservation(client: SupabaseClient, id: string): Promise<void> {
  const { error } = await client.from('restaurant_reservation_requests').delete().eq('id', id)
  if (error) throw error
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
  const { error } = await client
    .from('restaurant_operational_profiles')
    .upsert({ ...input, restaurant_id: restaurantId }, { onConflict: 'restaurant_id' })
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

// Replaces the whole ranked list in one go (delete + re-insert) rather than
// diffing -- the detail panel always edits the full ordered list at once
// (drag-reorder / add / remove), never a single row in isolation.
export async function setAlternatives(client: SupabaseClient, reservationId: string, restaurantIds: string[]): Promise<void> {
  const { error: deleteError } = await client.from('restaurant_reservation_alternatives').delete().eq('reservation_id', reservationId)
  if (deleteError) throw deleteError
  if (restaurantIds.length === 0) return
  const { error: insertError } = await client
    .from('restaurant_reservation_alternatives')
    .insert(restaurantIds.map((restaurant_id, index) => ({ reservation_id: reservationId, restaurant_id, rank: index + 1 })))
  if (insertError) throw insertError
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
  const { error } = await client.from('dining_guest_tags').update(changes).eq('id', id)
  if (error) throw error
}

export async function deleteGuestTag(client: SupabaseClient, id: string): Promise<void> {
  const { error } = await client.from('dining_guest_tags').delete().eq('id', id)
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
