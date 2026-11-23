export type ReservationConfirmationStatus = 'pending' | 'confirmed' | 'declined' | 'cancelled'
export type AttendanceStatus = 'pending' | 'arrived' | 'no_show'

export const ATTENDANCE_LABELS: Record<AttendanceStatus, string> = {
  pending: 'Da segnare',
  arrived: 'Arrivato',
  no_show: 'Non presentato',
}

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
  attendance_status: AttendanceStatus
  confirmation_note: string | null
  special_requests: string | null
  source: 'staff' | 'guest'
  created_at: string
}

export interface PartnerCapacity {
  seatsIndoor: number | null
  seatsOutdoor: number | null
  availabilityNotes: string | null
}

export interface PartnerHours {
  id: string
  dayOfWeek: number
  opensAt: string
  closesAt: string
}

export interface PartnerBlackoutDate {
  id: string
  blackoutDate: string
  note: string | null
}

export const DAY_LABELS = ['Domenica', 'Lunedì', 'Martedì', 'Mercoledì', 'Giovedì', 'Venerdì', 'Sabato']
