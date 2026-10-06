export type RequestStatus = 'requested' | 'in_progress' | 'completed' | 'cancelled'
export type Department = 'reception' | 'housekeeping' | 'maintenance' | 'porter'
// An operatore's own department is only ever 'housekeeping' or 'reception'
// (the other two Department values exist for request_categories only).
// master isn't scoped to one hotel: it creates hotel admins, an admin
// creates operatori for its own hotel only.
export type StaffRole = 'master' | 'admin' | 'operatore'
export type StaffDepartment = Extract<Department, 'housekeeping' | 'reception' | 'maintenance'>

export interface RequestCategory {
  id: string
  hotel_id: string
  name: string
  name_i18n: Record<string, string>
  department: Department
  icon: string | null
  active: boolean
  sort_order: number
}

export interface RequestType {
  id: string
  category_id: string
  name: string
  name_i18n: Record<string, string>
  description: string | null
  description_i18n: Record<string, string>
  allows_quantity: boolean
  // how many the hotel actually has on hand; null = not tracked
  available_quantity: number | null
  active: boolean
  sort_order: number
}

export interface DiningCategory {
  id: string
  name: string
  icon: string | null
  sort_order: number
}

export interface DiningRestaurant {
  id: string
  category_id: string
  name: string
  description: string | null
  is_external: boolean
  maps_url: string | null
  website_url: string | null
  phone: string | null
  address: string | null
  // The curated/guest-facing columns from the Phase 1 schema PR
  // (20261006100000_dining_concierge_workflow) -- optional because this
  // type also describes rows read from production before that migration is
  // applied there, where Postgrest simply omits columns it doesn't have.
  cuisine?: string | null
  price_tier?: 1 | 2 | 3 | 4 | null
  walk_minutes?: number | null
  short_description?: string | null
  guest_tags?: string[]
  is_recommended?: boolean
  concierge_description?: string | null
}

export interface DiningHour {
  id: string
  restaurant_id: string
  day_of_week: number
  opens_at: string
  closes_at: string
}

export interface GuestRequest {
  id: string
  hotel_id: string
  stay_id: string
  room_number: string
  request_type_id: string
  quantity: number | null
  note: string | null
  status: RequestStatus
  assigned_department: Department
  accepted_by: string | null
  created_at: string
  accepted_at: string | null
  completed_at: string | null
  priority: number
  archived_at: string | null
  returned_at: string | null
}
