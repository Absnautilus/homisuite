import { createClient } from 'npm:@supabase/supabase-js@2.116.0'
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2.116.0'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

// A generic Google Places lookup, not a Dining-specific function -- any
// authenticated staff member can call it (it never reads or writes this
// project's own tables, only proxies to Google), so a future feature
// elsewhere in Homisuite can reuse it as-is instead of duplicating the URL
// parsing and Places API calls below.
Deno.serve(async (request: Request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (request.method !== 'POST') return json({ error: 'method_not_allowed' }, 405)

  const authorization = request.headers.get('Authorization')
  if (!authorization) return json({ error: 'missing_authorization' }, 401)

  try {
    const body = await request.json() as { url?: unknown; hotelAddress?: unknown }
    const inputUrl = String(body.url ?? '').trim()
    const hotelAddress = typeof body.hotelAddress === 'string' ? body.hotelAddress.trim() : ''
    if (!inputUrl) return json({ error: 'invalid_input' }, 400)

    const supabaseUrl = Deno.env.get('SUPABASE_URL')
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY')
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
    const placesApiKey = Deno.env.get('GOOGLE_PLACES_API_KEY')
    if (!supabaseUrl || !anonKey || !serviceRoleKey || !placesApiKey) return json({ error: 'server_not_configured' }, 500)

    const caller = createClient(supabaseUrl, anonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { headers: { Authorization: authorization } },
    })
    const { data: userData, error: userError } = await caller.auth.getUser()
    if (userError || !userData.user) return json({ error: 'invalid_session' }, 401)

    // The photo upload below writes to the dining-photos bucket under no
    // particular caller's identity (it's a cache of Google's own data, not
    // anyone's content) -- the service role key bypasses Storage RLS for
    // that one write, same as any other server-side-only bucket write. The
    // caller's own session is still required and checked above first.
    const storage = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } })

    // A maps.app.goo.gl / goo.gl short link carries nothing parseable
    // itself -- it has to be followed to the real, parameter-rich
    // google.com/maps/... URL first. Already-expanded links just resolve
    // to themselves.
    const resolvedUrl = await resolveRedirect(inputUrl)
    const { name, lat, lng } = extractNameAndCoords(resolvedUrl)
    if (!name) {
      return json({ error: 'place_not_recognized' }, 422)
    }

    const candidate = await textSearch(placesApiKey, name, lat, lng)
    if (!candidate) return json({ error: 'place_not_found' }, 404)

    const details = await placeDetails(placesApiKey, candidate.id)

    // Best-effort: walking time needs the Routes API, which may not be
    // enabled yet on this key, and needs the hotel's own address to even
    // attempt -- neither is a reason to fail the rest of the import.
    let walkMinutes: number | null = null
    if (hotelAddress && details.location) {
      try {
        const hotelPlace = await textSearch(placesApiKey, hotelAddress, null, null, 'places.location')
        if (hotelPlace?.location) {
          walkMinutes = await walkingMinutesBetween(placesApiKey, hotelPlace.location, details.location)
        }
      } catch (cause) {
        console.error('walking distance lookup failed', cause)
      }
    }

    // Best-effort, same reasoning as walking distance above: a photo
    // upload failing (Photo Media not enabled yet, a transient fetch
    // error, Storage hiccup, ...) is never a reason to fail the rest of
    // an otherwise-successful import.
    let coverImageUrl: string | null = null
    let coverImageAttribution: string | null = null
    const firstPhoto = details.photos?.[0]
    if (firstPhoto) {
      try {
        const uploaded = await importCoverPhoto(storage, placesApiKey, candidate.id, firstPhoto.name)
        coverImageUrl = uploaded
        coverImageAttribution = (firstPhoto.authorAttributions ?? [])
          .map((attribution) => attribution.displayName)
          .filter((value): value is string => Boolean(value))
          .join(', ') || null
      } catch (cause) {
        console.error('cover photo import failed', cause)
      }
    }

    return json({
      name: details.displayName?.text ?? name,
      address: details.formattedAddress ?? null,
      phone: details.internationalPhoneNumber ?? null,
      websiteUrl: details.websiteUri ?? null,
      mapsUrl: details.googleMapsUri ?? inputUrl,
      priceTier: mapPriceLevel(details.priceLevel),
      cuisineHint: details.primaryTypeDisplayName?.text ?? cuisineHintFromTypes(details.types ?? []),
      businessStatus: details.businessStatus ?? null,
      walkMinutes,
      hours: hoursFromOpeningHours(details.regularOpeningHours),
      coverImageUrl,
      coverImageAttribution,
    }, 200)
  } catch (error) {
    console.error('maps-place-lookup failed', error)
    return json({ error: 'unexpected_error' }, 500)
  }
})

async function resolveRedirect(url: string): Promise<string> {
  try {
    const response = await fetch(url, {
      method: 'GET',
      redirect: 'follow',
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; HomisuiteBot/1.0)' },
    })
    // Drain and discard the body -- only the final, redirected URL matters
    // here, and leaving the response unread would hold the connection open.
    await response.body?.cancel()
    return response.url || url
  } catch {
    return url
  }
}

// Google's "expanded" Maps URLs put the place's display name in the path
// right after /maps/place/ (+-encoded, so a straight decodeURIComponent
// after swapping + for space recovers it) and the map's center coordinate
// after an @ segment -- both present on every such URL regardless of which
// of Google's many internal encodings (data=, cid, feature id, ...) follows
// them, which is why this reads the name/coordinate instead of trying to
// decode any of those.
function extractNameAndCoords(url: string): { name: string | null; lat: number | null; lng: number | null } {
  let name: string | null = null
  const placeMatch = url.match(/\/maps\/place\/([^/@]+)/)
  if (placeMatch) {
    name = decodeURIComponent(placeMatch[1].replace(/\+/g, ' '))
  }
  let lat: number | null = null
  let lng: number | null = null
  const atMatch = url.match(/@(-?\d+\.\d+),(-?\d+\.\d+)/)
  if (atMatch) {
    lat = Number(atMatch[1])
    lng = Number(atMatch[2])
  }
  return { name, lat, lng }
}

interface LatLng { latitude: number; longitude: number }
interface PlaceCandidate { id: string; location?: LatLng }

async function textSearch(apiKey: string, query: string, lat: number | null, lng: number | null, extraFields = ''): Promise<PlaceCandidate | null> {
  const requestBody: Record<string, unknown> = { textQuery: query, languageCode: 'it' }
  // Biases the search toward the coordinate the link itself was centered
  // on -- without it, a common restaurant name could resolve to a
  // same-named place in a different city entirely.
  if (lat != null && lng != null) {
    requestBody.locationBias = { circle: { center: { latitude: lat, longitude: lng }, radius: 500 } }
  }
  const fieldMask = ['places.id', 'places.displayName', extraFields].filter(Boolean).join(',')
  const response = await fetch('https://places.googleapis.com/v1/places:searchText', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': apiKey,
      'X-Goog-FieldMask': fieldMask,
    },
    body: JSON.stringify(requestBody),
  })
  if (!response.ok) throw new Error(`places_search_http_${response.status}`)
  const data = await response.json() as { places?: PlaceCandidate[] }
  return data.places?.[0] ?? null
}

interface OpeningHoursPeriodPoint { day: number; hour: number; minute: number }
interface OpeningHoursPeriod { open?: OpeningHoursPeriodPoint; close?: OpeningHoursPeriodPoint }
interface OpeningHours { periods?: OpeningHoursPeriod[] }

interface PlacePhotoAttribution { displayName?: string }
interface PlacePhoto { name: string; authorAttributions?: PlacePhotoAttribution[] }

interface PlaceDetails {
  displayName?: { text?: string }
  formattedAddress?: string
  internationalPhoneNumber?: string
  websiteUri?: string
  googleMapsUri?: string
  priceLevel?: string
  types?: string[]
  businessStatus?: string
  location?: LatLng
  primaryTypeDisplayName?: { text?: string }
  regularOpeningHours?: OpeningHours
  photos?: PlacePhoto[]
}

async function placeDetails(apiKey: string, placeId: string): Promise<PlaceDetails> {
  const fields = [
    'displayName', 'formattedAddress', 'internationalPhoneNumber', 'websiteUri', 'googleMapsUri',
    'priceLevel', 'types', 'businessStatus', 'location', 'primaryTypeDisplayName', 'regularOpeningHours', 'photos',
  ].join(',')
  // languageCode is a query param here (this is a GET, unlike Text Search's
  // POST body) -- keeps displayName/primaryTypeDisplayName in Italian
  // regardless of whoever last indexed the place, matching the rest of the
  // app, rather than whatever language Google happens to default to.
  const response = await fetch(`https://places.googleapis.com/v1/places/${placeId}?languageCode=it`, {
    headers: {
      'X-Goog-Api-Key': apiKey,
      'X-Goog-FieldMask': fields,
    },
  })
  if (!response.ok) throw new Error(`place_details_http_${response.status}`)
  return await response.json() as PlaceDetails
}

// Routes API, a separate Google API from Places -- walking time is simply
// not something Places itself knows (it has no notion of "from where").
// Falls back to null (never throws past its own caller) if the API isn't
// enabled yet on this key, same as any other transient failure here.
async function walkingMinutesBetween(apiKey: string, origin: LatLng, destination: LatLng): Promise<number | null> {
  const response = await fetch('https://routes.googleapis.com/directions/v2:computeRoutes', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': apiKey,
      'X-Goog-FieldMask': 'routes.duration',
    },
    body: JSON.stringify({
      origin: { location: { latLng: origin } },
      destination: { location: { latLng: destination } },
      travelMode: 'WALK',
    }),
  })
  if (!response.ok) {
    console.error('routes_api_http', response.status, await response.text().catch(() => ''))
    return null
  }
  const data = await response.json() as { routes?: Array<{ duration?: string }> }
  const duration = data.routes?.[0]?.duration
  if (!duration) return null
  // Google returns a protobuf Duration as a string like "423s".
  const seconds = Number(duration.replace(/s$/, ''))
  if (!Number.isFinite(seconds)) return null
  return Math.max(1, Math.round(seconds / 60))
}

// Fetches the actual photo bytes from Google's Photo Media endpoint (a
// separate call from Place Details, its own billed SKU) and re-hosts them
// in our own public bucket, so the restaurant list can show a plain <img
// src> instead of proxying through Google (and so the URL still works if
// this key's photo access ever changes). Google's terms cap how long a
// cached Place Photo may be kept (30 days) before it has to be re-fetched
// -- fine for a one-shot import a staff member can always re-run, but this
// isn't yet wired to auto-refresh if the restaurant's photo is kept far
// longer than that.
async function importCoverPhoto(storage: SupabaseClient, apiKey: string, placeId: string, photoName: string): Promise<string | null> {
  const response = await fetch(`https://places.googleapis.com/v1/${photoName}/media?maxWidthPx=1200`, {
    headers: { 'X-Goog-Api-Key': apiKey },
  })
  if (!response.ok) throw new Error(`place_photo_media_http_${response.status}`)
  const contentType = response.headers.get('content-type') ?? 'image/jpeg'
  const extension = contentType.includes('png') ? 'png' : 'jpg'
  const bytes = new Uint8Array(await response.arrayBuffer())
  const path = `restaurants/${placeId}.${extension}`
  const { error } = await storage.storage.from('dining-photos').upload(path, bytes, { contentType, upsert: true })
  if (error) throw error
  return storage.storage.from('dining-photos').getPublicUrl(path).data.publicUrl
}

interface ImportedHour { dayOfWeek: number; opensAt: string; closesAt: string }

// Google's day field is already 0 = Sunday, the same convention this
// project's own restaurant_hours.day_of_week uses -- no remapping needed.
// A period without both ends (e.g. a 24h place, or a malformed row from
// Google's own data) is dropped rather than guessed at.
function hoursFromOpeningHours(hours: OpeningHours | undefined): ImportedHour[] {
  if (!hours?.periods) return []
  const result: ImportedHour[] = []
  for (const period of hours.periods) {
    if (!period.open || !period.close) continue
    result.push({
      dayOfWeek: period.open.day,
      opensAt: formatTimeOfDay(period.open.hour, period.open.minute),
      closesAt: formatTimeOfDay(period.close.hour, period.close.minute),
    })
  }
  return result
}

function formatTimeOfDay(hour: number, minute: number): string {
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00`
}

function mapPriceLevel(level: string | undefined): 1 | 2 | 3 | 4 | null {
  switch (level) {
    case 'PRICE_LEVEL_INEXPENSIVE': return 1
    case 'PRICE_LEVEL_MODERATE': return 2
    case 'PRICE_LEVEL_EXPENSIVE': return 3
    case 'PRICE_LEVEL_VERY_EXPENSIVE': return 4
    default: return null
  }
}

// Informational only -- Google's place "types" (restaurant, bar,
// italian_restaurant, ...) are a loose hint toward our free-text "Cucina"
// field, never an exact match, so the caller shows this as a suggestion to
// edit rather than writing it in unreviewed.
function cuisineHintFromTypes(types: string[]): string | null {
  const relevant = types.filter((type) => /restaurant|cafe|bar|bakery|food/.test(type) && type !== 'restaurant' && type !== 'food')
  if (relevant.length === 0) return null
  return relevant.map((type) => type.replace(/_/g, ' ')).join(', ')
}

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}
