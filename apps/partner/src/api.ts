import { supabase } from './lib/supabase'
import type { PartnerBlackoutDate, PartnerCapacity, PartnerHours, PartnerReservation } from './types'

// Untyped SupabaseClient (see lib/supabase.ts) -- same escape hatch the
// dining module's own apps/web/src/modules/dining/api.ts already uses for
// tables outside the shared core-sdk Database type.
interface RawReservationRow {
  id: string
  guest_name: string
  party_size: number
  reservation_date: string
  reservation_time: string
  booking_reference: string | null
  confirmation_status: PartnerReservation['confirmation_status']
  attendance_status: PartnerReservation['attendance_status']
  confirmation_note: string | null
  special_requests: string | null
  source: PartnerReservation['source']
  created_at: string
  restaurants: { name: string } | null
  hotels: { name: string } | null
}

export class NoPartnerAccountError extends Error {}

// A signed-in user with no active service_partner_users row shouldn't
// normally reach the dashboard (an invited account always gets one in the
// same transaction, see invite-service-partner-user), but a deactivated
// account hits this too -- surfaced as its own error so the dashboard can
// show a clear "access revoked" message instead of an empty list.
export async function getMyPartner(): Promise<{ servicePartnerId: string; businessName: string; capacity: PartnerCapacity }> {
  const { data, error } = await supabase
    .from('service_partner_users')
    .select('service_partner_id, service_partners(name, seats_indoor, seats_outdoor, availability_notes)')
    .eq('active', true)
    .maybeSingle()
  if (error) throw error
  const partner = data?.service_partners as unknown as { name: string; seats_indoor: number | null; seats_outdoor: number | null; availability_notes: string | null } | null
  if (!data || !partner) throw new NoPartnerAccountError('no_active_partner_account')
  return {
    servicePartnerId: data.service_partner_id as string,
    businessName: partner.name,
    capacity: { seatsIndoor: partner.seats_indoor, seatsOutdoor: partner.seats_outdoor, availabilityNotes: partner.availability_notes },
  }
}

export async function updateCapacity(capacity: PartnerCapacity): Promise<void> {
  const { error } = await supabase.rpc('partner_update_capacity', {
    p_seats_indoor: capacity.seatsIndoor,
    p_seats_outdoor: capacity.seatsOutdoor,
    p_availability_notes: capacity.availabilityNotes,
  })
  if (error) throw error
}

export async function listMyHours(): Promise<PartnerHours[]> {
  const { data, error } = await supabase
    .from('service_partner_hours')
    .select('id, day_of_week, opens_at, closes_at')
    .order('day_of_week')
    .order('opens_at')
  if (error) throw error
  return (data as { id: string; day_of_week: number; opens_at: string; closes_at: string }[]).map((row) => ({
    id: row.id, dayOfWeek: row.day_of_week, opensAt: row.opens_at, closesAt: row.closes_at,
  }))
}

// Not transactional (a plain delete then insert, two round trips) -- this
// is the partner's own displayed-hours preference, not booking-critical
// data, so a failure between the two steps (leaving it briefly empty,
// recoverable by saving again) is an acceptable trade for not building a
// dedicated RPC just for this.
export async function setMyHours(servicePartnerId: string, hours: { dayOfWeek: number; opensAt: string; closesAt: string }[]): Promise<void> {
  const { error: deleteError } = await supabase.from('service_partner_hours').delete().eq('service_partner_id', servicePartnerId)
  if (deleteError) throw deleteError
  if (hours.length === 0) return
  const { error: insertError } = await supabase.from('service_partner_hours').insert(
    hours.map((h) => ({ service_partner_id: servicePartnerId, day_of_week: h.dayOfWeek, opens_at: h.opensAt, closes_at: h.closesAt })),
  )
  if (insertError) throw insertError
}

export async function listMyBlackoutDates(): Promise<PartnerBlackoutDate[]> {
  const { data, error } = await supabase
    .from('service_partner_blackout_dates')
    .select('id, blackout_date, note')
    .order('blackout_date')
  if (error) throw error
  return (data as { id: string; blackout_date: string; note: string | null }[]).map((row) => ({
    id: row.id, blackoutDate: row.blackout_date, note: row.note,
  }))
}

export async function addBlackoutDate(servicePartnerId: string, date: string, note: string | null): Promise<string> {
  const { data, error } = await supabase
    .from('service_partner_blackout_dates')
    .insert({ service_partner_id: servicePartnerId, blackout_date: date, note })
    .select('id')
    .single()
  if (error) throw error
  return (data as { id: string }).id
}

export async function deleteBlackoutDate(id: string): Promise<void> {
  const { error } = await supabase.from('service_partner_blackout_dates').delete().eq('id', id)
  if (error) throw error
}

export async function listMyReservations(): Promise<PartnerReservation[]> {
  // Both embeds need an explicit !<fkey> hint. hotels: reachable both via
  // this table's own hotel_id and via restaurant_id -> restaurants.hotel_id.
  // restaurants: reachable both via the plain restaurant_id FK and via a
  // second, composite (hotel_id, restaurant_id) FK that only exists to
  // enforce "this reservation's restaurant belongs to this reservation's
  // hotel" -- a real constraint, but PostgREST sees it as a second
  // relationship path to the same table and refuses to guess, same as the
  // hotels case. The end-to-end verification before this shipped queried a
  // simplified select with no embeds at all, so it never actually
  // exercised this exact query -- caught only once a real account hit the
  // live dashboard.
  const { data, error } = await supabase
    .from('restaurant_reservation_requests')
    .select('id, guest_name, party_size, reservation_date, reservation_time, booking_reference, confirmation_status, attendance_status, confirmation_note, special_requests, source, created_at, restaurants!restaurant_reservation_requests_restaurant_id_fkey(name), hotels!restaurant_reservation_requests_hotel_id_fkey(name)')
    .order('reservation_date', { ascending: false })
    .order('reservation_time', { ascending: false })
  if (error) throw error
  return (data as unknown as RawReservationRow[]).map((row) => ({
    id: row.id,
    hotel_name: row.hotels?.name ?? '—',
    restaurant_name: row.restaurants?.name ?? '—',
    guest_name: row.guest_name,
    party_size: row.party_size,
    reservation_date: row.reservation_date,
    reservation_time: row.reservation_time,
    booking_reference: row.booking_reference,
    confirmation_status: row.confirmation_status,
    attendance_status: row.attendance_status,
    confirmation_note: row.confirmation_note,
    special_requests: row.special_requests,
    source: row.source,
    created_at: row.created_at,
  }))
}

export async function respondToReservation(requestId: string, status: 'confirmed' | 'declined', note: string | null): Promise<void> {
  const { error } = await supabase.rpc('partner_respond_to_reservation', {
    p_request_id: requestId,
    p_status: status,
    p_note: note,
  })
  if (error) throw error
}

export async function setAttendance(requestId: string, status: PartnerReservation['attendance_status']): Promise<void> {
  const { error } = await supabase.rpc('partner_set_attendance', {
    p_request_id: requestId,
    p_attendance: status,
  })
  if (error) throw error
}

// No filter string, unlike modules/housekeeping's subscribeToQueue (which
// filters by hotel_id): a partner's reservations span whichever hotel(s)
// their restaurant(s) serve, with no single tenant column to filter on
// client-side, and listMyReservations() above already reads this same
// table with no .eq() filter at all -- RLS alone (restaurant_reservation_requests'
// own partner-scoped select policy) is what actually limits visibility,
// for the realtime feed exactly as it does for the plain select.
export function subscribeToReservations(onChange: () => void) {
  const channel = supabase
    .channel(`partner-reservations-${crypto.randomUUID()}`)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'restaurant_reservation_requests' }, onChange)
    .subscribe()
  return () => {
    supabase.removeChannel(channel)
  }
}
