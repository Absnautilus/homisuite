import { createClient } from 'npm:@supabase/supabase-js@2.116.0'

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
    const body = await request.json() as { url?: unknown }
    const inputUrl = String(body.url ?? '').trim()
    if (!inputUrl) return json({ error: 'invalid_input' }, 400)

    const supabaseUrl = Deno.env.get('SUPABASE_URL')
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY')
    const placesApiKey = Deno.env.get('GOOGLE_PLACES_API_KEY')
    if (!supabaseUrl || !anonKey || !placesApiKey) return json({ error: 'server_not_configured' }, 500)

    const caller = createClient(supabaseUrl, anonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { headers: { Authorization: authorization } },
    })
    const { data: userData, error: userError } = await caller.auth.getUser()
    if (userError || !userData.user) return json({ error: 'invalid_session' }, 401)

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

    return json({
      name: details.displayName?.text ?? name,
      address: details.formattedAddress ?? null,
      phone: details.internationalPhoneNumber ?? null,
      websiteUrl: details.websiteUri ?? null,
      mapsUrl: details.googleMapsUri ?? inputUrl,
      priceTier: mapPriceLevel(details.priceLevel),
      cuisineHint: cuisineHintFromTypes(details.types ?? []),
      businessStatus: details.businessStatus ?? null,
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

interface PlaceCandidate { id: string }

async function textSearch(apiKey: string, query: string, lat: number | null, lng: number | null): Promise<PlaceCandidate | null> {
  const requestBody: Record<string, unknown> = { textQuery: query }
  // Biases the search toward the coordinate the link itself was centered
  // on -- without it, a common restaurant name could resolve to a
  // same-named place in a different city entirely.
  if (lat != null && lng != null) {
    requestBody.locationBias = { circle: { center: { latitude: lat, longitude: lng }, radius: 500 } }
  }
  const response = await fetch('https://places.googleapis.com/v1/places:searchText', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': apiKey,
      'X-Goog-FieldMask': 'places.id,places.displayName',
    },
    body: JSON.stringify(requestBody),
  })
  if (!response.ok) throw new Error(`places_search_http_${response.status}`)
  const data = await response.json() as { places?: PlaceCandidate[] }
  return data.places?.[0] ?? null
}

interface PlaceDetails {
  displayName?: { text?: string }
  formattedAddress?: string
  internationalPhoneNumber?: string
  websiteUri?: string
  googleMapsUri?: string
  priceLevel?: string
  types?: string[]
  businessStatus?: string
}

async function placeDetails(apiKey: string, placeId: string): Promise<PlaceDetails> {
  const fields = ['displayName', 'formattedAddress', 'internationalPhoneNumber', 'websiteUri', 'googleMapsUri', 'priceLevel', 'types', 'businessStatus'].join(',')
  const response = await fetch(`https://places.googleapis.com/v1/places/${placeId}`, {
    headers: {
      'X-Goog-Api-Key': apiKey,
      'X-Goog-FieldMask': fields,
    },
  })
  if (!response.ok) throw new Error(`place_details_http_${response.status}`)
  return await response.json() as PlaceDetails
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
