import { supabase } from './lib/supabase'
import type { PartnerReservation } from './types'

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
export async function getMyPartner(): Promise<{ servicePartnerId: string; businessName: string }> {
  const { data, error } = await supabase
    .from('service_partner_users')
    .select('service_partner_id, service_partners(name)')
    .eq('active', true)
    .maybeSingle()
  if (error) throw error
  const partner = data?.service_partners as unknown as { name: string } | null
  if (!data || !partner) throw new NoPartnerAccountError('no_active_partner_account')
  return { servicePartnerId: data.service_partner_id as string, businessName: partner.name }
}

export async function listMyReservations(): Promise<PartnerReservation[]> {
  const { data, error } = await supabase
    .from('restaurant_reservation_requests')
    .select('id, guest_name, party_size, reservation_date, reservation_time, booking_reference, confirmation_status, confirmation_note, special_requests, source, created_at, restaurants(name), hotels(name)')
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
