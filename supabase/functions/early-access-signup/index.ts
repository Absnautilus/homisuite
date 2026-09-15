import { createClient } from 'npm:@supabase/supabase-js@2.116.0'

// Public, unauthenticated endpoint for the marketing landing page (a
// separate repository/deployment, not this one). There is no caller JWT to
// check here -- the origin allowlist below is the entire access boundary
// for browsers, and the service-role client is the only thing that ever
// touches early_access_signups (RLS denies anon/authenticated outright,
// see 20260915140000_early_access_signups.sql).

const MAX_BODY_BYTES = 20_000
const MAX_HOTEL_NAME_LENGTH = 200
const MAX_UTM_LENGTH = 250
const MAX_LANDING_PATH_LENGTH = 500

const ROLES = ['general_manager', 'front_office_manager', 'front_office', 'operations', 'owner', 'other'] as const
const ROOMS_RANGES = ['1-20', '21-50', '51-100', '101-200', '200+'] as const
const MAIN_PROBLEMS = ['guest_requests', 'shift_planning', 'internal_communication', 'transfer', 'restaurants_experiences', 'handover', 'other'] as const

const ROLE_LABELS: Record<string, string> = {
  general_manager: 'General Manager',
  front_office_manager: 'Front Office Manager',
  front_office: 'Front Office',
  operations: 'Operations',
  owner: 'Proprietario',
  other: 'Altro',
}

const PROBLEM_LABELS: Record<string, string> = {
  guest_requests: 'Richieste ospiti',
  shift_planning: 'Pianificazione turni',
  internal_communication: 'Comunicazione interna',
  transfer: 'Transfer',
  restaurants_experiences: 'Ristoranti ed esperienze',
  handover: 'Passaggio di consegne',
  other: 'Altro',
}

type RawPayload = Record<string, unknown>

export interface Lead {
  email: string
  hotel_name: string
  role: (typeof ROLES)[number]
  rooms_range: (typeof ROOMS_RANGES)[number]
  main_problem: (typeof MAIN_PROBLEMS)[number]
  marketing_consent: boolean
  utm_source: string | null
  utm_medium: string | null
  utm_campaign: string | null
  utm_content: string | null
  utm_term: string | null
  landing_path: string | null
}

// ---------------------------------------------------------------------------
// CORS -- the landing is a separate deployment, so unlike this project's
// other (internal, JWT-gated) functions, "*" isn't an option: the origin
// allowlist is genuinely the access boundary for a browser here.
// ---------------------------------------------------------------------------

export function readAllowedOrigins(env = Deno.env): string[] {
  return (env.get('EARLY_ACCESS_ALLOWED_ORIGINS') ?? '')
    .split(',')
    .map((value) => value.trim())
    .filter((value) => value.length > 0)
}

// null = origin present but not allowed (caller must reject); {} = no
// Origin header at all (non-browser caller, e.g. a server-to-server check;
// nothing for a browser's CORS to enforce, so let it through unheadered).
export function corsHeadersFor(origin: string | null, allowedOrigins: string[]): Record<string, string> | null {
  if (!origin) return {}
  if (!allowedOrigins.includes(origin)) return null
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'content-type',
    'Vary': 'Origin',
  }
}

// ---------------------------------------------------------------------------
// Validation -- never trust the landing's own client-side checks.
// ---------------------------------------------------------------------------

function isEmail(value: string): boolean {
  return value.length > 0 && value.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)
}

// undefined = invalid (wrong type or too long); null = absent/empty, valid.
function readOptionalString(value: unknown, maxLength: number): string | null | undefined {
  if (value === undefined || value === null) return null
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  if (trimmed.length > maxLength) return undefined
  return trimmed.length > 0 ? trimmed : null
}

export function isHoneypotTriggered(payload: RawPayload): boolean {
  return typeof payload.website === 'string' && payload.website.trim().length > 0
}

export function validateLead(payload: RawPayload): Lead | null {
  const email = typeof payload.email === 'string' ? payload.email.trim().toLowerCase() : ''
  if (!isEmail(email)) return null

  const hotelName = typeof payload.hotel_name === 'string' ? payload.hotel_name.trim() : ''
  if (hotelName.length === 0 || hotelName.length > MAX_HOTEL_NAME_LENGTH) return null

  const role = typeof payload.role === 'string' ? payload.role : ''
  if (!(ROLES as readonly string[]).includes(role)) return null

  const roomsRange = typeof payload.rooms_range === 'string' ? payload.rooms_range : ''
  if (!(ROOMS_RANGES as readonly string[]).includes(roomsRange)) return null

  const mainProblem = typeof payload.main_problem === 'string' ? payload.main_problem : ''
  if (!(MAIN_PROBLEMS as readonly string[]).includes(mainProblem)) return null

  if (typeof payload.marketing_consent !== 'boolean') return null

  const utmSource = readOptionalString(payload.utm_source, MAX_UTM_LENGTH)
  const utmMedium = readOptionalString(payload.utm_medium, MAX_UTM_LENGTH)
  const utmCampaign = readOptionalString(payload.utm_campaign, MAX_UTM_LENGTH)
  const utmContent = readOptionalString(payload.utm_content, MAX_UTM_LENGTH)
  const utmTerm = readOptionalString(payload.utm_term, MAX_UTM_LENGTH)
  const landingPath = readOptionalString(payload.landing_path, MAX_LANDING_PATH_LENGTH)
  if ([utmSource, utmMedium, utmCampaign, utmContent, utmTerm, landingPath].some((value) => value === undefined)) {
    return null
  }

  return {
    email,
    hotel_name: hotelName,
    role: role as Lead['role'],
    rooms_range: roomsRange as Lead['rooms_range'],
    main_problem: mainProblem as Lead['main_problem'],
    marketing_consent: payload.marketing_consent,
    utm_source: utmSource ?? null,
    utm_medium: utmMedium ?? null,
    utm_campaign: utmCampaign ?? null,
    utm_content: utmContent ?? null,
    utm_term: utmTerm ?? null,
    landing_path: landingPath ?? null,
  }
}

// ---------------------------------------------------------------------------
// Database -- the only writer to early_access_signups. A plain
// select-then-branch rather than PostgREST's upsert: the table's
// case-insensitive uniqueness is a functional index on lower(trim(email)),
// not a plain-column constraint, so there's no single column name to hand
// upsert()'s onConflict -- and email is already stored pre-normalized here,
// so eq('email', lead.email) matches it directly.
// ---------------------------------------------------------------------------

// The slice of the supabase-js client this module actually calls -- kept
// minimal and structural so tests can pass an in-memory fake instead of a
// real network client (no local Supabase stack in this sandbox; see
// supabase/tests' own comments on the same constraint).
export interface AdminClient {
  from(table: string): {
    select(columns: string): { eq(column: string, value: string): { maybeSingle(): Promise<{ data: Record<string, unknown> | null; error: { code?: string; message: string } | null }> } }
    insert(row: Record<string, unknown>): Promise<{ error: { code?: string; message: string } | null }>
    update(row: Record<string, unknown>): { eq(column: string, value: string): Promise<{ error: { code?: string; message: string } | null }> }
  }
}

export async function upsertLead(admin: AdminClient, lead: Lead, attempt = 0): Promise<{ isNew: boolean }> {
  const { data: existing, error: selectError } = await admin
    .from('early_access_signups')
    .select('id, utm_source, utm_medium, utm_campaign, utm_content, utm_term, landing_path')
    .eq('email', lead.email)
    .maybeSingle()
  if (selectError) throw selectError

  // UTM/landing_path are additive: a re-submission's blank values must
  // never wipe out attribution a previous, more-complete submission
  // already recorded.
  const merged = {
    utm_source: lead.utm_source ?? (existing?.utm_source as string | null | undefined) ?? null,
    utm_medium: lead.utm_medium ?? (existing?.utm_medium as string | null | undefined) ?? null,
    utm_campaign: lead.utm_campaign ?? (existing?.utm_campaign as string | null | undefined) ?? null,
    utm_content: lead.utm_content ?? (existing?.utm_content as string | null | undefined) ?? null,
    utm_term: lead.utm_term ?? (existing?.utm_term as string | null | undefined) ?? null,
    landing_path: lead.landing_path ?? (existing?.landing_path as string | null | undefined) ?? null,
  }

  if (existing) {
    const { error: updateError } = await admin
      .from('early_access_signups')
      .update({
        hotel_name: lead.hotel_name,
        role: lead.role,
        rooms_range: lead.rooms_range,
        main_problem: lead.main_problem,
        marketing_consent: lead.marketing_consent,
        ...merged,
      })
      .eq('id', existing.id as string)
    if (updateError) throw updateError
    return { isNew: false }
  }

  const { error: insertError } = await admin.from('early_access_signups').insert({
    email: lead.email,
    hotel_name: lead.hotel_name,
    role: lead.role,
    rooms_range: lead.rooms_range,
    main_problem: lead.main_problem,
    marketing_consent: lead.marketing_consent,
    ...merged,
  })
  if (insertError) {
    // Someone else's request inserted the same email between our SELECT and
    // this INSERT -- retry once as an update rather than surfacing a
    // spurious failure for what is, from the caller's point of view, a
    // perfectly ordinary duplicate submission.
    if (insertError.code === '23505' && attempt === 0) return upsertLead(admin, lead, attempt + 1)
    throw insertError
  }
  return { isNew: true }
}

// ---------------------------------------------------------------------------
// Notification email -- no transactional email provider exists anywhere
// else in this project (confirmed by searching the repo before adding
// this); Resend is the default provider, chosen only via env, with no
// credentials of any kind committed here. Swappable via EMAIL_PROVIDER so
// a different provider doesn't mean touching this function's core logic.
// ---------------------------------------------------------------------------

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

export function buildNotificationEmail(lead: Lead, isNew: boolean): { subject: string; text: string; html: string } {
  const roleLabel = ROLE_LABELS[lead.role] ?? lead.role
  const problemLabel = PROBLEM_LABELS[lead.main_problem] ?? lead.main_problem
  const consentLabel = lead.marketing_consent ? 'Sì' : 'No'
  const kindLabel = isNew ? 'Nuovo lead' : 'Lead già esistente aggiornato'
  const timestamp = new Date().toISOString()

  const lines: [string, string][] = [
    ['Hotel', lead.hotel_name],
    ['Email', lead.email],
    ['Ruolo', roleLabel],
    ['Numero camere', lead.rooms_range],
    ['Problema principale', problemLabel],
    ['Consenso aggiornamenti', consentLabel],
  ]

  const text = [
    'Nuova richiesta Early Access',
    '',
    ...lines.flatMap(([label, value]) => [`${label}:`, value, '']),
    'Origine:',
    `utm_source: ${lead.utm_source ?? '-'}`,
    `utm_medium: ${lead.utm_medium ?? '-'}`,
    `utm_campaign: ${lead.utm_campaign ?? '-'}`,
    '',
    'Landing:',
    lead.landing_path ?? '-',
    '',
    'Tipo:', kindLabel,
    '',
    'Data:', timestamp,
  ].join('\n')

  const html = `
    <div style="font-family: sans-serif; font-size: 14px; color: #16182b;">
      <h2>Nuova richiesta Early Access</h2>
      ${lines.map(([label, value]) => `<p><strong>${escapeHtml(label)}:</strong><br>${escapeHtml(value)}</p>`).join('\n')}
      <p><strong>Origine:</strong><br>
        utm_source: ${escapeHtml(lead.utm_source ?? '-')}<br>
        utm_medium: ${escapeHtml(lead.utm_medium ?? '-')}<br>
        utm_campaign: ${escapeHtml(lead.utm_campaign ?? '-')}
      </p>
      <p><strong>Landing:</strong><br>${escapeHtml(lead.landing_path ?? '-')}</p>
      <p><strong>Tipo:</strong><br>${escapeHtml(kindLabel)}</p>
      <p><strong>Data:</strong><br>${escapeHtml(timestamp)}</p>
    </div>
  `.trim()

  return { subject: `[homisuite] Nuova richiesta Early Access — ${lead.hotel_name}`, text, html }
}

export async function sendNotificationEmail(
  lead: Lead,
  isNew: boolean,
  env = Deno.env,
  fetchImpl: typeof fetch = fetch,
): Promise<void> {
  const to = env.get('EARLY_ACCESS_NOTIFICATION_TO')
  const from = env.get('EMAIL_FROM')
  if (!to || !from) throw new Error('email_not_configured')

  const provider = (env.get('EMAIL_PROVIDER') ?? 'resend').toLowerCase()
  const message = buildNotificationEmail(lead, isNew)

  if (provider === 'resend') {
    const apiKey = env.get('RESEND_API_KEY')
    if (!apiKey) throw new Error('resend_api_key_missing')
    const response = await fetchImpl('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from, to: [to], subject: message.subject, text: message.text, html: message.html }),
    })
    if (!response.ok) throw new Error(`resend_request_failed_${response.status}`)
    return
  }

  throw new Error(`unsupported_email_provider_${provider}`)
}

// ---------------------------------------------------------------------------
// Request handling
// ---------------------------------------------------------------------------

function json(body: unknown, status: number, headers: Record<string, string>): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...headers, 'Content-Type': 'application/json' } })
}

export interface HandleRequestDeps {
  createAdminClient?: () => AdminClient
  sendEmail?: typeof sendNotificationEmail
  env?: typeof Deno.env
}

export async function handleRequest(request: Request, deps: HandleRequestDeps = {}): Promise<Response> {
  const env = deps.env ?? Deno.env
  const allowedOrigins = readAllowedOrigins(env)
  const origin = request.headers.get('Origin')
  const cors = corsHeadersFor(origin, allowedOrigins)

  if (request.method === 'OPTIONS') {
    return cors === null ? new Response(null, { status: 403 }) : new Response(null, { status: 204, headers: cors })
  }

  if (cors === null) return json({ ok: false, error: 'origin_not_allowed' }, 403, {})

  if (request.method !== 'POST') return json({ ok: false, error: 'method_not_allowed' }, 405, cors)

  const contentType = request.headers.get('Content-Type') ?? ''
  if (!contentType.toLowerCase().includes('application/json')) {
    return json({ ok: false, error: 'invalid_payload' }, 400, cors)
  }

  let rawBody: string
  try {
    rawBody = await request.text()
  } catch {
    return json({ ok: false, error: 'invalid_payload' }, 400, cors)
  }
  if (rawBody.length === 0 || rawBody.length > MAX_BODY_BYTES) {
    return json({ ok: false, error: 'invalid_payload' }, 400, cors)
  }

  let payload: RawPayload
  try {
    const parsed = JSON.parse(rawBody)
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) throw new Error('not_an_object')
    payload = parsed as RawPayload
  } catch {
    return json({ ok: false, error: 'invalid_payload' }, 400, cors)
  }

  // Honeypot, checked before real validation: a bot that also botches every
  // other field must see the same "success" a real visitor would, not a
  // validation error that would tell it which field gave it away.
  if (isHoneypotTriggered(payload)) {
    return json({ ok: true, status: 'created' }, 201, cors)
  }

  // TODO(turnstile): once Cloudflare Turnstile is added on the landing,
  // verify the token here (before touching Supabase) and fall through to
  // the same 400 invalid_payload response on failure -- no separate error
  // code for callers to branch on.

  const lead = validateLead(payload)
  if (!lead) return json({ ok: false, error: 'invalid_payload' }, 400, cors)

  const supabaseUrl = env.get('SUPABASE_URL')
  const serviceRoleKey = env.get('SUPABASE_SERVICE_ROLE_KEY')
  const createAdminClient = deps.createAdminClient ?? (() => {
    if (!supabaseUrl || !serviceRoleKey) throw new Error('server_not_configured')
    return createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } }) as unknown as AdminClient
  })

  let outcome: { isNew: boolean }
  try {
    outcome = await upsertLead(createAdminClient(), lead)
  } catch (error) {
    console.error('early-access-signup: database write failed', error instanceof Error ? error.message : error)
    return json({ ok: false, error: 'internal_error' }, 500, cors)
  }

  // The lead is safely stored at this point. A temporary email-provider
  // outage must never look like a lost submission to either the visitor or
  // to this API's caller -- the database is the source of truth, so a
  // notification failure here is logged and swallowed, never surfaced as
  // an API error and never a reason to touch the row just written.
  const sendEmail = deps.sendEmail ?? sendNotificationEmail
  try {
    await sendEmail(lead, outcome.isNew, env)
  } catch (error) {
    console.error('early-access-signup: notification email failed', error instanceof Error ? error.message : error)
  }

  return outcome.isNew
    ? json({ ok: true, status: 'created' }, 201, cors)
    : json({ ok: true, status: 'updated' }, 200, cors)
}

if (import.meta.main) {
  Deno.serve((request) => handleRequest(request))
}
