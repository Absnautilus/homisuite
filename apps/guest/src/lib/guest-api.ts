import { supabase } from '@/lib/supabase'
import {
  getHotelId,
  getHotelLogoPath,
  getHotelLogoUpdatedAt,
  getHotelSlugFromPath,
  getStoredHotelBranding,
  getStoredHotelId,
  getStoredHotelName,
  setResolvedHotel,
} from '@/lib/env'
import type { DiningCategory, DiningHour, DiningRestaurant, GuestRequest, RequestCategory, RequestType } from '@/lib/types'

export function isInvalidSessionError(error: unknown): boolean {
  return error instanceof Error && error.message.includes('invalid_session')
}

// Resolves this visit's hotel from the URL's slug (see
// getHotelSlugFromPath), falling back to a previously resolved id
// (localStorage) for a bare-origin revisit. Returns false when neither
// source yields a real hotel -- the caller should show an invalid-link
// screen rather than a login form that can never succeed.
export async function resolveHotelFromSlug(): Promise<boolean> {
  const slug = getHotelSlugFromPath()
  if (slug) {
    try {
      // A table-returning RPC comes back as an array of rows -- empty (not
      // an error) for an unknown or inactive slug.
      const { data, error } = await supabase.rpc('resolve_hotel_guest_slug', { p_slug: slug })
      const row = Array.isArray(data)
        ? (data[0] as
            | { id: string; name: string; brand_color: string | null; logo_path: string | null; logo_updated_at: string | null }
            | undefined)
        : undefined
      if (!error && row) {
        setResolvedHotel(row.id, row.name, {
          brandColor: row.brand_color,
          logoPath: row.logo_path,
          logoUpdatedAt: row.logo_updated_at,
        })
        return true
      }
    } catch {
      // network failure resolving the slug -- fall through to a previously
      // resolved id below rather than leaving the caller hanging
    }
  }
  const stored = getStoredHotelId()
  if (stored) {
    setResolvedHotel(stored, getStoredHotelName(), getStoredHotelBranding())
    return true
  }
  return false
}

export async function guestLogin(roomNumber: string, pin: string): Promise<string | null> {
  const { data, error } = await supabase.rpc('guest_login', {
    p_hotel_id: getHotelId(),
    p_room_number: roomNumber,
    p_pin: pin,
  })
  if (error) throw error
  return data
}

export async function fetchMenu(): Promise<{ categories: RequestCategory[]; types: RequestType[] }> {
  // request_categories/request_types RLS only checks `active`, not
  // hotel_id (a guest session has no per-hotel scope to enforce it with) —
  // this filter is what actually keeps another hotel's menu out of view.
  const categoriesRes = await supabase.from('request_categories').select('*').eq('hotel_id', getHotelId()).order('sort_order')
  if (categoriesRes.error) throw categoriesRes.error
  const categories = categoriesRes.data ?? []

  const categoryIds = categories.map((c) => c.id)
  if (categoryIds.length === 0) return { categories, types: [] }

  const typesRes = await supabase.from('request_types').select('*').in('category_id', categoryIds).order('sort_order')
  if (typesRes.error) throw typesRes.error
  return { categories, types: typesRes.data ?? [] }
}

// Dining's own public-read tables (restaurants_public_read/
// dining_categories_public_read/restaurant_hours_public_read, see
// 20260918100000_dining_module + 20261006100000_dining_concierge_workflow)
// are already gated the same way request_categories/request_types are --
// `active` plus hotel_has_module(), enforced server-side by RLS, not by
// this filter. No guest session/token needed, same as fetchMenu: this is
// public reference data (today's hours, is there a recommended spot
// nearby), not anything guest-specific.
export async function fetchDiningCatalog(): Promise<{ categories: DiningCategory[]; restaurants: DiningRestaurant[] }> {
  const hotelId = getHotelId()
  const categoriesRes = await supabase.from('dining_categories').select('*').eq('hotel_id', hotelId).order('sort_order')
  if (categoriesRes.error) throw categoriesRes.error
  const categories = (categoriesRes.data ?? []) as DiningCategory[]

  const restaurantsRes = await supabase.from('restaurants').select('*').eq('hotel_id', hotelId).order('sort_order')
  if (restaurantsRes.error) throw restaurantsRes.error
  const restaurants = (restaurantsRes.data ?? []) as DiningRestaurant[]

  return { categories, restaurants }
}

export async function fetchDiningHours(restaurantId: string): Promise<DiningHour[]> {
  const { data, error } = await supabase.from('restaurant_hours').select('*').eq('restaurant_id', restaurantId).order('day_of_week').order('opens_at')
  if (error) throw error
  return (data ?? []) as DiningHour[]
}

// create_dining_reservation_request (20261006110000_dining_guest_reservation_rpc)
// mirrors createGuestRequest's own shape exactly: same token, same
// 'invalid_session' contract, same SECURITY DEFINER RPC as the only way an
// anon guest ever touches restaurant_reservation_requests.
export async function createDiningReservationRequest(
  token: string,
  restaurantId: string,
  reservationDate: string,
  reservationTime: string,
  partySize: number,
  specialRequests: string | null,
): Promise<void> {
  const { error } = await supabase.rpc('create_dining_reservation_request', {
    p_token: token,
    p_restaurant_id: restaurantId,
    p_reservation_date: reservationDate,
    p_reservation_time: reservationTime,
    p_party_size: partySize,
    p_special_requests: specialRequests,
  })
  if (error) throw error
}

export async function createGuestRequest(
  token: string,
  requestTypeId: string,
  quantity: number | null,
  note: string | null,
): Promise<GuestRequest> {
  const { data, error } = await supabase.rpc('create_guest_request', {
    p_token: token,
    p_request_type_id: requestTypeId,
    p_quantity: quantity,
    p_note: note,
  })
  if (error) throw error
  return data
}

export async function listMyRequests(token: string): Promise<GuestRequest[]> {
  const { data, error } = await supabase.rpc('list_my_requests', { p_token: token })
  if (error) throw error
  return data ?? []
}

export interface AvailableModule {
  slug: string
  display_name: string
}

// First step toward this hotel's guest experience becoming a real
// directory of services instead of a single hardcoded Housekeeping flow:
// which guest-facing modules (see modules.guest_facing) the hotel's mapped
// Core property actually has enabled. Keyed by hotel_id, not a guest
// session token -- same trust model as fetchMenu's request_categories
// lookup below: which service categories a hotel offers isn't sensitive,
// and no per-guest data is involved. Today this only ever returns
// guest_requests; the caller (guest-app.tsx) skips the directory screen
// entirely whenever there's exactly one.
export async function fetchAvailableModules(): Promise<AvailableModule[]> {
  const { data, error } = await supabase.rpc('guest_available_modules', { p_hotel_id: getHotelId() })
  if (error) throw error
  return data ?? []
}

export interface StayInfo {
  room_number: string
  guest_last_name: string
  check_out_at: string
  hotel_name: string | null
  hotel_phone: string | null
  hotel_address: string | null
  hotel_email: string | null
  // "HH:MM" (Settings' "Orario check-out predefinito"), or null if the
  // hotel never set one -- see Greeting.tsx for the fallback to
  // check_out_at's own time-of-day.
  hotel_check_out_time: string | null
  hotel_wifi_network: string | null
  hotel_wifi_password: string | null
  hotel_breakfast_hours: string | null
  hotel_bar_hours: string | null
  // Storage path in the "property-logos" bucket, e.g. "<property_id>/logo.png"
  // -- always resolved when the hotel has a Core mapping, whether or not a
  // logo was actually uploaded there. hotel_logo_updated_at is the real
  // "has a logo" signal (see getHotelLogoUrl below); hotel_logo_path alone
  // is never enough to know a logo exists.
  hotel_logo_path: string | null
  hotel_logo_updated_at: string | null
  // Hex string ("#0f9d78", Settings' "Colore del marchio"), or null if the
  // hotel never customized it -- see index.css's default --accent for the
  // fallback.
  hotel_brand_color: string | null
  hotel_website: string | null
}

export async function getStayInfo(token: string): Promise<StayInfo | null> {
  const { data, error } = await supabase.rpc('guest_stay_info', { p_token: token })
  if (error) throw error
  return data?.[0] ?? null
}

// Same "<bucket>/<path>?v=<logoUpdatedAt>" URL apps/web's own Settings page
// builds for the staff-facing logo preview -- null whenever the hotel never
// uploaded one, so the navbar can fall back to the generic Homisuite mark
// instead of requesting a file that was never there.
export function getHotelLogoUrl(stay: Pick<StayInfo, 'hotel_logo_path' | 'hotel_logo_updated_at'>): string | null {
  if (!stay.hotel_logo_path || !stay.hotel_logo_updated_at) return null
  const { data } = supabase.storage.from('property-logos').getPublicUrl(stay.hotel_logo_path)
  return `${data.publicUrl}?v=${encodeURIComponent(stay.hotel_logo_updated_at)}`
}

// Same URL, built from the slug-resolution cache (env.ts) instead of a
// StayInfo row -- for the LoginScreen, which renders before a guest session
// (and therefore a StayInfo) exists.
export function getPreLoginHotelLogoUrl(): string | null {
  return getHotelLogoUrl({ hotel_logo_path: getHotelLogoPath(), hotel_logo_updated_at: getHotelLogoUpdatedAt() })
}

export async function cancelMyRequest(token: string, requestId: string): Promise<GuestRequest> {
  const { data, error } = await supabase.rpc('cancel_my_request', {
    p_token: token,
    p_request_id: requestId,
  })
  if (error) throw error
  return data
}
