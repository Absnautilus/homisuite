import type { SupabaseClient } from '@supabase/supabase-js'
import type { ConfirmationStatus, DiningCategory, ReservationRequest, Restaurant, RestaurantHour } from './types'

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

export async function updateRestaurant(client: SupabaseClient, id: string, changes: Partial<RestaurantInput & { active: boolean }>): Promise<void> {
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
}

export async function createReservation(client: SupabaseClient, hotelId: string, staffProfileId: string | null, input: CreateReservationInput): Promise<void> {
  const { error } = await client.from('restaurant_reservation_requests').insert({
    ...input,
    hotel_id: hotelId,
    source: 'staff',
    created_by: staffProfileId,
  })
  if (error) throw error
}

export async function updateReservation(
  client: SupabaseClient,
  id: string,
  changes: Partial<CreateReservationInput & { confirmation_status: ConfirmationStatus; confirmation_note: string | null }>,
): Promise<void> {
  const { error } = await client.from('restaurant_reservation_requests').update(changes).eq('id', id)
  if (error) throw error
}

export async function deleteReservation(client: SupabaseClient, id: string): Promise<void> {
  const { error } = await client.from('restaurant_reservation_requests').delete().eq('id', id)
  if (error) throw error
}
