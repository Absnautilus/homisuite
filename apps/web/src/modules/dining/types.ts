export interface DiningCategory {
  id: string
  hotel_id: string
  name: string
  icon: string | null
  active: boolean
  sort_order: number
}

export interface Restaurant {
  id: string
  hotel_id: string
  category_id: string
  name: string
  description: string | null
  is_external: boolean
  maps_url: string | null
  website_url: string | null
  phone: string | null
  address: string | null
  requires_online_booking: boolean
  active: boolean
  sort_order: number
}

export interface RestaurantHour {
  id: string
  restaurant_id: string
  day_of_week: number
  opens_at: string
  closes_at: string
}

export type ConfirmationStatus = 'pending' | 'confirmed' | 'declined' | 'cancelled'

export interface ReservationRequest {
  id: string
  hotel_id: string
  restaurant_id: string
  stay_id: string | null
  room_number: string | null
  guest_name: string
  party_size: number
  reservation_date: string
  reservation_time: string
  booking_reference: string | null
  confirmation_status: ConfirmationStatus
  confirmation_note: string | null
  special_requests: string | null
  staff_notes: string | null
  source: 'staff' | 'guest'
  created_by: string | null
  created_at: string
}

export const CONFIRMATION_STATUS_LABELS: Record<ConfirmationStatus, string> = {
  pending: 'In attesa',
  confirmed: 'Confermata',
  declined: 'Rifiutata',
  cancelled: 'Annullata',
}

export const DAY_LABELS = ['Domenica', 'Lunedì', 'Martedì', 'Mercoledì', 'Giovedì', 'Venerdì', 'Sabato']
