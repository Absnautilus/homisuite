function required(name: string, value: string | undefined): string {
  if (!value) {
    throw new Error(`Missing ${name} — copy .env.example to .env and fill it in.`)
  }
  return value
}

export const SUPABASE_URL = required('VITE_SUPABASE_URL', import.meta.env.VITE_SUPABASE_URL)
export const SUPABASE_ANON_KEY = required('VITE_SUPABASE_ANON_KEY', import.meta.env.VITE_SUPABASE_ANON_KEY)

// This is one deployment shared by every hotel on one domain -- there is no
// per-deployment hotel configuration. Each hotel's own link is
// https://<this-domain>/<guest_slug>, e.g. /palazzo-veneziano (see
// supabase/migrations/20260912110000_hotels_guest_slug.sql). The slug isn't
// the hotel id itself -- resolveHotelFromSlug (guest-api.ts) looks it up
// against the database and caches the result here.
const HOTEL_ID_KEY = 'guest_hotel_id'
const HOTEL_NAME_KEY = 'guest_hotel_name'
const HOTEL_BRAND_COLOR_KEY = 'guest_hotel_brand_color'
const HOTEL_LOGO_PATH_KEY = 'guest_hotel_logo_path'
const HOTEL_LOGO_UPDATED_AT_KEY = 'guest_hotel_logo_updated_at'
let cachedHotelId: string | null = null
let cachedHotelName: string | null = null
let cachedHotelBrandColor: string | null = null
let cachedHotelLogoPath: string | null = null
let cachedHotelLogoUpdatedAt: string | null = null

export interface HotelBranding {
  brandColor: string | null
  logoPath: string | null
  logoUpdatedAt: string | null
}

export function getHotelId(): string {
  if (!cachedHotelId) {
    throw new Error('missing_hotel_id')
  }
  return cachedHotelId
}

// Null when the login screen shouldn't name the hotel -- either resolution
// hasn't run yet, or it fell back to a stored id from before this was
// cached (see getStoredHotelName). Callers should fall back to a
// hotel-agnostic title in that case, not show a blank name.
export function getHotelName(): string | null {
  return cachedHotelName
}

// Same "resolution hasn't happened yet or predates this" caveat as
// getHotelName -- lets the pre-login LoginScreen brand itself the same way
// PublicHeader does post-login (see brandColorStyle/getHotelLogoUrl).
export function getHotelBrandColor(): string | null {
  return cachedHotelBrandColor
}

export function getHotelLogoPath(): string | null {
  return cachedHotelLogoPath
}

export function getHotelLogoUpdatedAt(): string | null {
  return cachedHotelLogoUpdatedAt
}

// Called only by resolveHotelFromSlug once a slug has actually resolved to
// a real hotel -- never with unverified user input. hotelName/branding are
// best effort: the stored-id fallback path in resolveHotelFromSlug may only
// have previously cached values (or none, for a visit that predates this).
export function setResolvedHotel(
  hotelId: string,
  hotelName: string | null,
  branding: HotelBranding = { brandColor: null, logoPath: null, logoUpdatedAt: null },
): void {
  cachedHotelId = hotelId
  cachedHotelName = hotelName
  cachedHotelBrandColor = branding.brandColor
  cachedHotelLogoPath = branding.logoPath
  cachedHotelLogoUpdatedAt = branding.logoUpdatedAt
  try {
    localStorage.setItem(HOTEL_ID_KEY, hotelId)
    if (hotelName) localStorage.setItem(HOTEL_NAME_KEY, hotelName)
    if (branding.brandColor) localStorage.setItem(HOTEL_BRAND_COLOR_KEY, branding.brandColor)
    if (branding.logoPath) localStorage.setItem(HOTEL_LOGO_PATH_KEY, branding.logoPath)
    if (branding.logoUpdatedAt) localStorage.setItem(HOTEL_LOGO_UPDATED_AT_KEY, branding.logoUpdatedAt)
  } catch {
    // localStorage unavailable (private mode, etc.) -- the id still works
    // for this visit, it just won't survive a reload without the URL slug.
  }
}

export function getStoredHotelId(): string | null {
  try {
    return localStorage.getItem(HOTEL_ID_KEY)
  } catch {
    return null
  }
}

export function getStoredHotelName(): string | null {
  try {
    return localStorage.getItem(HOTEL_NAME_KEY)
  } catch {
    return null
  }
}

export function getStoredHotelBranding(): HotelBranding {
  try {
    return {
      brandColor: localStorage.getItem(HOTEL_BRAND_COLOR_KEY),
      logoPath: localStorage.getItem(HOTEL_LOGO_PATH_KEY),
      logoUpdatedAt: localStorage.getItem(HOTEL_LOGO_UPDATED_AT_KEY),
    }
  } catch {
    return { brandColor: null, logoPath: null, logoUpdatedAt: null }
  }
}

// The URL's first path segment, e.g. "palazzo-veneziano" from
// "/palazzo-veneziano". Null for a bare-origin visit (no slug at all).
export function getHotelSlugFromPath(): string | null {
  return window.location.pathname.split('/').filter(Boolean)[0] ?? null
}

// Optional: push notifications are simply unavailable (the on-duty toggle
// hides itself) when this isn't set, rather than throwing like the required
// Supabase vars above — lets the app run without it during local setup.
export const VAPID_PUBLIC_KEY = import.meta.env.VITE_VAPID_PUBLIC_KEY ?? null
