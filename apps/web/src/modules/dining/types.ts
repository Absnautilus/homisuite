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
  cuisine: string | null
  price_tier: 1 | 2 | 3 | 4 | null
  walk_minutes: number | null
  short_description: string | null
  guest_tags: string[]
  is_recommended: boolean
  concierge_description: string | null
  ideal_for: string | null
  guest_profile: string | null
}

export type CommercialAgreement = 'partner_commission' | 'partner_no_commission' | 'none'
export type PreferredContactMethod = 'phone' | 'whatsapp' | 'email'

export interface RestaurantOperationalProfile {
  restaurant_id: string
  contact_phone: string | null
  contact_email: string | null
  contact_whatsapp: string | null
  preferred_contact_method: PreferredContactMethod | null
  contact_person: string | null
  commercial_agreement: CommercialAgreement
  commission_rate: number | null
  booking_notes: string | null
  difficult_times: string | null
  last_verified_on: string | null
}

export const COMMERCIAL_AGREEMENT_LABELS: Record<CommercialAgreement, string> = {
  partner_commission: 'Convenzionato con provvigione',
  partner_no_commission: 'Convenzionato senza provvigione',
  none: 'Nessun accordo',
}

export interface RestaurantHour {
  id: string
  restaurant_id: string
  day_of_week: number
  opens_at: string
  closes_at: string
}

// 'pending'/'declined' are the legacy values -- kept valid by the schema for
// rows already in that state, but new staff/guest flows use the more
// specific values below instead (see 20261006100000_dining_concierge_workflow).
export type ConfirmationStatus =
  | 'new' | 'scheduled' | 'in_progress' | 'unavailable' | 'confirmed' | 'cancelled'
  | 'pending' | 'declined'

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
  assigned_to: string | null
  guest_preference_tags: string[]
  created_at: string
}

export const CONFIRMATION_STATUS_LABELS: Record<ConfirmationStatus, string> = {
  new: 'Nuova richiesta',
  scheduled: 'Da prenotare',
  in_progress: 'In attesa',
  unavailable: 'Non disponibile',
  confirmed: 'Confermata',
  cancelled: 'Annullata',
  pending: 'In attesa',
  declined: 'Rifiutata',
}

// The "Da gestire" queue only ever shows requests still open for action --
// everything else (confermata/annullata/rifiutata/da prenotare) belongs in
// "Tutte", not the urgent queue.
export const QUEUE_STATUSES: ConfirmationStatus[] = ['new', 'pending', 'in_progress', 'unavailable']

export interface ReservationAlternative {
  id: string
  reservation_id: string
  restaurant_id: string
  rank: number
}

export interface GuestTag {
  id: string
  hotel_id: string
  label: string
  active: boolean
  sort_order: number
}

export interface ReservationFeedback {
  id: string
  reservation_id: string
  rating: 1 | 2 | 3 | 4 | 5
  comment: string | null
  created_at: string
}

export const DAY_LABELS = ['Domenica', 'Lunedì', 'Martedì', 'Mercoledì', 'Giovedì', 'Venerdì', 'Sabato']

export type ChangeLogAction = 'created' | 'updated' | 'deleted'
export type ChangeLogEntityType = 'category' | 'restaurant' | 'hours' | 'reservation'

export interface ChangeLogEntry {
  id: string
  hotel_id: string
  entity_type: ChangeLogEntityType
  entity_id: string
  action: ChangeLogAction
  actor_profile_id: string | null
  actor_name: string
  summary: string
  created_at: string
}
