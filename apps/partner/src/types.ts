export type ReservationConfirmationStatus = 'pending' | 'confirmed' | 'declined' | 'cancelled'

// Flattened shape of restaurant_reservation_requests joined with the
// restaurant/hotel names a partner needs to tell bookings apart -- this
// account only ever sees rows for restaurants linked to its own
// service_partner (restaurant_reservation_requests_partner_read), so there's
// no partner_id/service_partner_id on this type: it would always be the
// caller's own.
export interface PartnerReservation {
  id: string
  hotel_name: string
  restaurant_name: string
  guest_name: string
  party_size: number
  reservation_date: string
  reservation_time: string
  booking_reference: string | null
  confirmation_status: ReservationConfirmationStatus
  confirmation_note: string | null
  special_requests: string | null
  source: 'staff' | 'guest'
  created_at: string
}
