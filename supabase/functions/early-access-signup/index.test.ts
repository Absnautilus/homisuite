// Deno tests for the early-access-signup Edge Function. Run with:
//   deno test --allow-env --allow-read supabase/functions/early-access-signup
//
// No real network or database calls anywhere here: the Supabase admin
// client and the email provider are both injected as in-memory fakes (see
// AdminClient/sendEmail in index.ts) -- this sandbox has no Supabase
// CLI/Docker to run a real local stack (same constraint already documented
// against supabase/tests), and a unit suite for an unauthenticated,
// public-facing endpoint should never send real email regardless.
import {
  buildConfirmationEmail,
  buildNotificationEmail,
  corsHeadersFor,
  handleRequest,
  isHoneypotTriggered,
  readAllowedOrigins,
  upsertLead,
  validateLead,
  type AdminClient,
  type Lead,
} from './index.ts'

function assertEquals(actual: unknown, expected: unknown, message: string) {
  const a = JSON.stringify(actual)
  const e = JSON.stringify(expected)
  if (a !== e) throw new Error(`${message}\n  actual:   ${a}\n  expected: ${e}`)
}

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(message)
}

function fakeEnv(vars: Record<string, string>): typeof Deno.env {
  return { get: (key: string) => vars[key] } as typeof Deno.env
}

type FakeRow = Record<string, unknown> & { id: string; email: string }

function createFakeAdminClient(seed: FakeRow[] = []): { client: AdminClient; rows: () => FakeRow[] } {
  const rows = new Map<string, FakeRow>(seed.map((row) => [row.email, { ...row }]))
  let nextId = seed.length + 1

  const client: AdminClient = {
    from(table: string) {
      if (table !== 'early_access_signups') throw new Error(`unexpected table ${table}`)
      return {
        select(_columns: string) {
          return {
            eq(_column: string, value: string) {
              return {
                maybeSingle() {
                  const row = rows.get(value)
                  return Promise.resolve({ data: row ? { ...row } : null, error: null })
                },
              }
            },
          }
        },
        insert(row: Record<string, unknown>) {
          const email = row.email as string
          if (rows.has(email)) return Promise.resolve({ error: { code: '23505', message: 'duplicate key value violates unique constraint' } })
          rows.set(email, { id: String(nextId++), ...row } as FakeRow)
          return Promise.resolve({ error: null })
        },
        update(patch: Record<string, unknown>) {
          return {
            eq(_column: string, id: string) {
              for (const [email, existing] of rows) {
                if (existing.id === id) {
                  rows.set(email, { ...existing, ...patch })
                  return Promise.resolve({ error: null })
                }
              }
              return Promise.resolve({ error: null })
            },
          }
        },
      }
    },
  }

  return { client, rows: () => [...rows.values()] }
}

const validPayload = () => ({
  email: 'Mario.Rossi@Hotel-Test.it',
  hotel_name: 'Hotel Test',
  role: 'general_manager',
  rooms_range: '21-50',
  main_problem: 'guest_requests',
  marketing_consent: true,
  utm_source: 'google',
  utm_medium: 'cpc',
  utm_campaign: 'launch',
  landing_path: '/early-access',
})

function makeRequest(body: unknown, opts: { origin?: string | null; method?: string; contentType?: string | null } = {}): Request {
  const headers = new Headers()
  if (opts.contentType !== null) headers.set('Content-Type', opts.contentType ?? 'application/json')
  if (opts.origin) headers.set('Origin', opts.origin)
  return new Request('https://backend.example.com/early-access-signup', {
    method: opts.method ?? 'POST',
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  })
}

const ALLOWED_ORIGIN = 'https://homisuite.com'
const testEnv = fakeEnv({ EARLY_ACCESS_ALLOWED_ORIGINS: ALLOWED_ORIGIN })

// ---------------------------------------------------------------------------
// Pure logic
// ---------------------------------------------------------------------------

Deno.test('readAllowedOrigins parses a comma-separated list, trimming blanks', () => {
  const env = fakeEnv({ EARLY_ACCESS_ALLOWED_ORIGINS: ' https://homisuite.com , https://www.homisuite.com,,http://localhost:5173 ' })
  assertEquals(
    readAllowedOrigins(env),
    ['https://homisuite.com', 'https://www.homisuite.com', 'http://localhost:5173'],
    'origins should be trimmed and empty entries dropped',
  )
})

Deno.test('corsHeadersFor: no Origin header -> empty headers, request proceeds', () => {
  assertEquals(corsHeadersFor(null, [ALLOWED_ORIGIN]), {}, 'a non-browser caller with no Origin is not blocked')
})

Deno.test('corsHeadersFor: allowed origin -> reflected back', () => {
  const headers = corsHeadersFor(ALLOWED_ORIGIN, [ALLOWED_ORIGIN])
  assert(headers !== null, 'an allowed origin must not be rejected')
  assertEquals(headers!['Access-Control-Allow-Origin'], ALLOWED_ORIGIN, 'the allowed origin is reflected')
})

Deno.test('corsHeadersFor: disallowed origin -> null (reject)', () => {
  assertEquals(corsHeadersFor('https://evil.example', [ALLOWED_ORIGIN]), null, 'an origin outside the allowlist must be rejected')
})

Deno.test('validateLead accepts a fully valid payload', () => {
  const lead = validateLead(validPayload())
  assert(lead !== null, 'a valid payload must validate')
  assertEquals(lead!.email, 'mario.rossi@hotel-test.it', 'email is trimmed and lowercased')
})

Deno.test('validateLead rejects an invalid email', () => {
  assertEquals(validateLead({ ...validPayload(), email: 'not-an-email' }), null, 'invalid email must be rejected')
})

Deno.test('validateLead rejects a missing hotel_name', () => {
  const payload: Record<string, unknown> = { ...validPayload() }
  delete payload.hotel_name
  assertEquals(validateLead(payload), null, 'missing hotel_name must be rejected')
})

Deno.test('validateLead rejects an invalid role', () => {
  assertEquals(validateLead({ ...validPayload(), role: 'ceo' }), null, 'a role outside the whitelist must be rejected')
})

Deno.test('validateLead rejects an invalid rooms_range', () => {
  assertEquals(validateLead({ ...validPayload(), rooms_range: '500+' }), null, 'a rooms_range outside the whitelist must be rejected')
})

Deno.test('validateLead rejects an invalid main_problem', () => {
  assertEquals(validateLead({ ...validPayload(), main_problem: 'world_peace' }), null, 'a main_problem outside the whitelist must be rejected')
})

Deno.test('validateLead rejects a non-boolean marketing_consent', () => {
  assertEquals(validateLead({ ...validPayload(), marketing_consent: 'yes' }), null, 'marketing_consent must be a real boolean')
})

Deno.test('isHoneypotTriggered: only a non-empty website field counts', () => {
  assert(isHoneypotTriggered({ website: 'http://spam.example' }), 'a filled honeypot must be detected')
  assert(!isHoneypotTriggered({ website: '' }), 'an empty honeypot must not be flagged')
  assert(!isHoneypotTriggered({}), 'a missing honeypot field must not be flagged')
})

Deno.test('buildNotificationEmail escapes HTML in user-controlled fields', () => {
  const lead: Lead = { ...validateLead(validPayload())!, hotel_name: '<script>alert(1)</script>' }
  const email = buildNotificationEmail(lead, true)
  assert(!email.html.includes('<script>alert(1)</script>'), 'raw HTML from the hotel name must not reach the email body unescaped')
  assert(email.html.includes('&lt;script&gt;'), 'the escaped form must be present instead')
})

Deno.test('buildConfirmationEmail escapes HTML in user-controlled fields', () => {
  const lead: Lead = { ...validateLead(validPayload())!, hotel_name: '<script>alert(1)</script>' }
  const email = buildConfirmationEmail(lead, true)
  assert(!email.html.includes('<script>alert(1)</script>'), 'raw HTML from the hotel name must not reach the email body unescaped')
  assert(email.html.includes('&lt;script&gt;'), 'the escaped form must be present instead')
})

Deno.test('buildConfirmationEmail: subject and copy differ for a new vs. an updated lead', () => {
  const lead = validateLead(validPayload())!
  const created = buildConfirmationEmail(lead, true)
  const updated = buildConfirmationEmail(lead, false)
  assertEquals(created.subject, 'Richiesta ricevuta — homisuite early access', 'subject is fixed regardless of new/updated')
  assertEquals(updated.subject, created.subject, 'subject does not change for an update')
  assert(created.html.includes('abbiamo ricevuto la tua richiesta'), 'a new lead gets the "received" wording')
  assert(updated.html.includes('abbiamo aggiornato la tua richiesta'), 'an updated lead gets the "updated" wording instead')
})

// ---------------------------------------------------------------------------
// upsertLead
// ---------------------------------------------------------------------------

Deno.test('upsertLead inserts a brand new lead', async () => {
  const { client, rows } = createFakeAdminClient()
  const lead = validateLead(validPayload())!
  const outcome = await upsertLead(client, lead)
  assertEquals(outcome, { isNew: true }, 'a new email must be reported as new')
  assertEquals(rows().length, 1, 'exactly one row must exist after the insert')
})

Deno.test('upsertLead updates an existing lead instead of duplicating it, keeping id/created_at/status', async () => {
  const { client, rows } = createFakeAdminClient([
    {
      id: '1',
      email: 'mario.rossi@hotel-test.it',
      hotel_name: 'Old Name',
      role: 'owner',
      rooms_range: '1-20',
      main_problem: 'handover',
      marketing_consent: false,
      status: 'qualified',
      created_at: '2020-01-01T00:00:00.000Z',
      utm_source: 'previous-source',
      utm_medium: null,
      utm_campaign: null,
      landing_path: '/old-path',
    },
  ])
  const lead = validateLead({ ...validPayload(), utm_source: undefined, utm_campaign: 'new-campaign' })!
  const outcome = await upsertLead(client, lead)
  assertEquals(outcome, { isNew: false }, 'a re-submission must be reported as an update')
  const [row] = rows()
  assertEquals(row.id, '1', 'the original id must be kept')
  assertEquals(row.created_at, '2020-01-01T00:00:00.000Z', 'the original created_at must be kept')
  assertEquals(row.status, 'qualified', 'status must never be reset by a re-submission')
  assertEquals(row.hotel_name, 'Hotel Test', 'hotel_name must be overwritten with the new value')
  assertEquals(row.utm_source, 'previous-source', 'a blank UTM in the new payload must not erase the previous value')
  assertEquals(row.utm_campaign, 'new-campaign', 'a non-blank UTM in the new payload must overwrite the previous value')
})

// ---------------------------------------------------------------------------
// handleRequest -- full request/response cycle, DB and email both faked
// ---------------------------------------------------------------------------

Deno.test('handleRequest: valid payload -> 201 created, both emails sent after the DB write', async () => {
  const { client } = createFakeAdminClient()
  const calls: string[] = []
  const request = makeRequest(validPayload(), { origin: ALLOWED_ORIGIN })
  const response = await handleRequest(request, {
    createAdminClient: () => {
      calls.push('db')
      return client
    },
    sendEmail: (_lead, isNew) => {
      calls.push('email')
      assertEquals(isNew, true, 'the notification handler must be told this is a new lead')
      return Promise.resolve()
    },
    sendConfirmation: (lead, isNew) => {
      calls.push('confirmation')
      assertEquals(isNew, true, 'the confirmation handler must be told this is a new lead')
      assertEquals(lead.email, 'mario.rossi@hotel-test.it', 'the confirmation must go to the lead, not to the internal notification address')
      return Promise.resolve()
    },
    env: testEnv,
  })
  assertEquals(response.status, 201, 'a brand new lead must return 201')
  assertEquals(await response.json(), { ok: true, status: 'created' }, 'the created response body must match the documented shape')
  assertEquals(calls, ['db', 'email', 'confirmation'], 'the database write must happen before either email, notification before confirmation')
})

Deno.test('handleRequest: same email again -> 200 updated', async () => {
  const { client } = createFakeAdminClient()
  const env = testEnv
  await handleRequest(makeRequest(validPayload(), { origin: ALLOWED_ORIGIN }), {
    createAdminClient: () => client,
    sendEmail: () => Promise.resolve(),
    env,
  })
  const response = await handleRequest(makeRequest({ ...validPayload(), hotel_name: 'Hotel Test Rinominato' }, { origin: ALLOWED_ORIGIN }), {
    createAdminClient: () => client,
    sendEmail: () => Promise.resolve(),
    env,
  })
  assertEquals(response.status, 200, 'a duplicate email must return 200')
  assertEquals(await response.json(), { ok: true, status: 'updated' }, 'the updated response body must match the documented shape')
})

Deno.test('handleRequest: invalid email -> 400 invalid_payload', async () => {
  const response = await handleRequest(makeRequest({ ...validPayload(), email: 'not-an-email' }, { origin: ALLOWED_ORIGIN }), { env: testEnv })
  assertEquals(response.status, 400, 'an invalid email must be rejected')
  assertEquals(await response.json(), { ok: false, error: 'invalid_payload' }, 'the error body must match the documented shape')
})

Deno.test('handleRequest: missing hotel_name -> 400', async () => {
  const payload: Record<string, unknown> = validPayload()
  delete payload.hotel_name
  const response = await handleRequest(makeRequest(payload, { origin: ALLOWED_ORIGIN }), { env: testEnv })
  assertEquals(response.status, 400, 'a missing hotel_name must be rejected')
})

Deno.test('handleRequest: invalid role -> 400', async () => {
  const response = await handleRequest(makeRequest({ ...validPayload(), role: 'ceo' }, { origin: ALLOWED_ORIGIN }), { env: testEnv })
  assertEquals(response.status, 400, 'an invalid role must be rejected')
})

Deno.test('handleRequest: invalid rooms_range -> 400', async () => {
  const response = await handleRequest(makeRequest({ ...validPayload(), rooms_range: '500+' }, { origin: ALLOWED_ORIGIN }), { env: testEnv })
  assertEquals(response.status, 400, 'an invalid rooms_range must be rejected')
})

Deno.test('handleRequest: invalid main_problem -> 400', async () => {
  const response = await handleRequest(makeRequest({ ...validPayload(), main_problem: 'world_peace' }, { origin: ALLOWED_ORIGIN }), { env: testEnv })
  assertEquals(response.status, 400, 'an invalid main_problem must be rejected')
})

Deno.test('handleRequest: non-boolean marketing_consent -> 400', async () => {
  const response = await handleRequest(makeRequest({ ...validPayload(), marketing_consent: 'yes' }, { origin: ALLOWED_ORIGIN }), { env: testEnv })
  assertEquals(response.status, 400, 'a non-boolean marketing_consent must be rejected')
})

Deno.test('handleRequest: honeypot filled -> looks like success, nothing written, no email sent', async () => {
  const { client, rows } = createFakeAdminClient()
  let dbTouched = false
  let emailSent = false
  let confirmationSent = false
  const response = await handleRequest(makeRequest({ ...validPayload(), website: 'http://spam.example' }, { origin: ALLOWED_ORIGIN }), {
    createAdminClient: () => {
      dbTouched = true
      return client
    },
    sendEmail: () => {
      emailSent = true
      return Promise.resolve()
    },
    sendConfirmation: () => {
      confirmationSent = true
      return Promise.resolve()
    },
    env: testEnv,
  })
  assertEquals(response.status, 201, 'a honeypot hit must still look like an ordinary success to the caller')
  assertEquals(await response.json(), { ok: true, status: 'created' }, 'the honeypot response must be indistinguishable from a real success')
  assert(!dbTouched, 'the database must never be touched when the honeypot is triggered')
  assert(!emailSent, 'no notification email must be sent when the honeypot is triggered')
  assert(!confirmationSent, 'no confirmation email must be sent when the honeypot is triggered')
  assertEquals(rows().length, 0, 'no row must exist after a honeypot-triggered submission')
})

Deno.test('handleRequest: disallowed origin -> rejected, no CORS header leaked', async () => {
  const response = await handleRequest(makeRequest(validPayload(), { origin: 'https://evil.example' }), { env: testEnv })
  assertEquals(response.status, 403, 'a disallowed origin must be rejected')
  assertEquals(response.headers.get('Access-Control-Allow-Origin'), null, 'no CORS header must be granted to a disallowed origin')
})

Deno.test('handleRequest: OPTIONS preflight from an allowed origin succeeds', async () => {
  const response = await handleRequest(makeRequest(undefined, { origin: ALLOWED_ORIGIN, method: 'OPTIONS', contentType: null }), { env: testEnv })
  assertEquals(response.status, 204, 'a preflight from an allowed origin must succeed')
  assertEquals(response.headers.get('Access-Control-Allow-Origin'), ALLOWED_ORIGIN, 'the preflight response must carry the allowed origin')
})

Deno.test('handleRequest: OPTIONS preflight from a disallowed origin fails', async () => {
  const response = await handleRequest(makeRequest(undefined, { origin: 'https://evil.example', method: 'OPTIONS', contentType: null }), { env: testEnv })
  assertEquals(response.status, 403, 'a preflight from a disallowed origin must fail')
})

Deno.test('handleRequest: notification email failure does not delete or fail the already-saved lead, confirmation still attempted', async () => {
  const { client, rows } = createFakeAdminClient()
  let confirmationAttempted = false
  const response = await handleRequest(makeRequest(validPayload(), { origin: ALLOWED_ORIGIN }), {
    createAdminClient: () => client,
    sendEmail: () => Promise.reject(new Error('resend_request_failed_500')),
    sendConfirmation: () => {
      confirmationAttempted = true
      return Promise.resolve()
    },
    env: testEnv,
  })
  assertEquals(response.status, 201, 'a notification failure must not surface as an API error')
  assertEquals(await response.json(), { ok: true, status: 'created' }, 'the caller must still see a normal success response')
  assertEquals(rows().length, 1, 'the lead must remain saved even though the notification email failed')
  assert(confirmationAttempted, 'a notification failure must not stop the confirmation email from being attempted')
})

Deno.test('handleRequest: confirmation email failure does not delete or fail the already-saved lead, notification still attempted', async () => {
  const { client, rows } = createFakeAdminClient()
  let notificationAttempted = false
  const response = await handleRequest(makeRequest(validPayload(), { origin: ALLOWED_ORIGIN }), {
    createAdminClient: () => client,
    sendEmail: () => {
      notificationAttempted = true
      return Promise.resolve()
    },
    sendConfirmation: () => Promise.reject(new Error('resend_request_failed_500')),
    env: testEnv,
  })
  assertEquals(response.status, 201, 'a confirmation failure must not surface as an API error')
  assertEquals(await response.json(), { ok: true, status: 'created' }, 'the caller must still see a normal success response')
  assertEquals(rows().length, 1, 'the lead must remain saved even though the confirmation email failed')
  assert(notificationAttempted, 'a confirmation failure must not stop the internal notification from being attempted')
})

Deno.test('handleRequest: database failure -> 500, no technical details leaked', async () => {
  const response = await handleRequest(makeRequest(validPayload(), { origin: ALLOWED_ORIGIN }), {
    createAdminClient: () => ({
      from() {
        return {
          select() {
            return { eq: () => ({ maybeSingle: () => Promise.reject(new Error('connection refused: password authentication failed for user "x"')) }) }
          },
          insert: () => Promise.resolve({ error: null }),
          update: () => ({ eq: () => Promise.resolve({ error: null }) }),
        }
      },
    }),
    env: testEnv,
  })
  assertEquals(response.status, 500, 'a database failure must surface as an internal error')
  const body = await response.json()
  assertEquals(body, { ok: false, error: 'internal_error' }, 'no SQL error, stack trace or provider detail must reach the caller')
})

// ---------------------------------------------------------------------------
// Service role key never reaches the client bundle
// ---------------------------------------------------------------------------

async function* walk(dir: string): AsyncGenerator<string> {
  for await (const entry of Deno.readDir(dir)) {
    const path = `${dir}/${entry.name}`
    if (entry.isDirectory) {
      if (entry.name === 'node_modules' || entry.name === 'dist') continue
      yield* walk(path)
    } else if (entry.isFile) {
      yield path
    }
  }
}

Deno.test('SUPABASE_SERVICE_ROLE_KEY / RESEND_API_KEY never appear in either client app source', async () => {
  const roots = ['../../../apps/web/src', '../../../apps/guest/src']
  const offenders: string[] = []
  for (const root of roots) {
    let resolvedRoot: string
    try {
      resolvedRoot = new URL(root, import.meta.url).pathname
    } catch {
      continue
    }
    try {
      for await (const path of walk(resolvedRoot)) {
        const content = await Deno.readTextFile(path)
        if (content.includes('SUPABASE_SERVICE_ROLE_KEY') || content.includes('RESEND_API_KEY')) offenders.push(path)
      }
    } catch (error) {
      if (!(error instanceof Deno.errors.NotFound)) throw error
    }
  }
  assertEquals(offenders, [], 'no client source file may reference the service role key or the email provider key')
})
