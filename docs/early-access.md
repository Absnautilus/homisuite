# Early Access signups

Backend for the "Early Access" form on the public marketing landing page.
The landing lives in a **separate repository/deployment**
(`Absnautilus/Homisuite-landing`) and is never touched by this doc or by
the code it documents — this repo only exposes the endpoint the landing
calls.

## Architecture

```
homisuite landing (separate repo/deployment)
    |
    | POST <function URL>          (fetch from the browser)
    v
early-access-signup Edge Function  (supabase/functions/early-access-signup)
    |
    | service-role client only
    v
public.early_access_signups        (Supabase Postgres)
    |
    +--> notification email -> EARLY_ACCESS_NOTIFICATION_TO (info@homisuite.com)
    |
    +--> confirmation email -> the lead's own email address
```

The landing's browser **never** talks to Supabase directly: no
`@supabase/supabase-js` client, no anon key used for this table, no direct
table write. The only thing the browser calls is the Edge Function's public
HTTPS endpoint over JSON.

**Why an Edge Function and not a Vercel Function**: this repo has no
Vercel Functions / `api/` convention anywhere (`apps/web` and `apps/guest`
are both pure static Vite SPAs — see their `vercel.json`, which is
rewrite-only). The established, already-proven pattern for "public-ish
endpoint using a service-role key, validated server-side" is a Supabase
Edge Function (see `invite-team-member` for the same shape used
internally). This reuses that pattern instead of introducing a new runtime
into the project.

## Endpoint

```
POST https://<project-ref>.supabase.co/functions/v1/early-access-signup
```

`<project-ref>` is this project's Supabase project ref (the same one
`SUPABASE_PROJECT_REF` names in CI). From the landing's point of view this
is just an external URL it `fetch()`s; it is not literally
`/api/early-access` because the landing and this backend are two separate
deployments and can't share a path namespace regardless of which
technology backs the endpoint. The landing should be given this as one
configured base URL (e.g. `VITE_HOMISUITE_API_BASE_URL =
https://<project-ref>.supabase.co/functions/v1`) plus the fixed
`/early-access-signup` path, not a hardcoded full URL.

**No `Authorization` header is needed or expected.** Every other Edge
Function in this project is called by an already-authenticated app user
and defaults to the platform's standard `verify_jwt = true`; this one has
no caller at all (an anonymous landing visitor), so `supabase/config.toml`
explicitly sets `[functions.early-access-signup] verify_jwt = false` for
it — otherwise the platform gateway would reject every request with `401`
before this function's own code (CORS, honeypot, validation) ever runs.
This setting must be in place, and the function (re)deployed with it,
before the landing can get anything but a `401` from this endpoint.

Request body (`application/json`):

```json
{
  "email": "mario.rossi@hotel.it",
  "hotel_name": "Hotel Roma",
  "role": "general_manager",
  "rooms_range": "21-50",
  "main_problem": "guest_requests",
  "marketing_consent": true,
  "utm_source": "google",
  "utm_medium": "cpc",
  "utm_campaign": "launch",
  "utm_content": "",
  "utm_term": "",
  "landing_path": "/early-access",
  "website": ""
}
```

`website` is a honeypot (see below) and is never stored.

### Responses

| Case | Status | Body |
|---|---|---|
| New lead | 201 | `{"ok": true, "status": "created"}` |
| Existing lead updated | 200 | `{"ok": true, "status": "updated"}` |
| Invalid payload | 400 | `{"ok": false, "error": "invalid_payload"}` |
| Origin not allowed | 403 | `{"ok": false, "error": "origin_not_allowed"}` |
| Internal error | 500 | `{"ok": false, "error": "internal_error"}` |
| Honeypot triggered | 201 | `{"ok": true, "status": "created"}` (fake — nothing is saved) |

No response body ever includes a SQL error, stack trace, Supabase detail,
email-provider detail, or any environment variable value.

## Database — `public.early_access_signups`

Migration: `supabase/migrations/20260915140000_early_access_signups.sql`
(additive only — touches nothing else: no changes to `organizations`,
`properties`, `memberships`, `auth`, guest sessions, permissions, or any
other module).

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid` | PK, `gen_random_uuid()` |
| `email` | `text` | normalized (trim + lowercase) before storage |
| `hotel_name` | `text` | required |
| `role` | `text` | whitelist, see below |
| `rooms_range` | `text` | whitelist |
| `main_problem` | `text` | whitelist |
| `marketing_consent` | `boolean` | default `false` |
| `utm_source` / `utm_medium` / `utm_campaign` / `utm_content` / `utm_term` | `text`, nullable | attribution |
| `landing_path` | `text`, nullable | which landing page/variant |
| `status` | `text` | minimal CRM field, default `'new'`, whitelist |
| `created_at` / `updated_at` | `timestamptz` | `updated_at` kept current by the shared `set_updated_at()` trigger (same one `organizations`/`properties` already use) |

Whitelists (enforced via `CHECK`, matching this project's existing
enum-via-CHECK convention — see `housekeeping_department` in
`20260914120000_housekeeping_department_override.sql`):

- `role`: `general_manager`, `front_office_manager`, `front_office`, `operations`, `owner`, `other`
- `rooms_range`: `1-20`, `21-50`, `51-100`, `101-200`, `200+`
- `main_problem`: `guest_requests`, `shift_planning`, `internal_communication`, `transfer`, `restaurants_experiences`, `handover`, `other`
- `status`: `new`, `contacted`, `qualified`, `pilot`, `converted`, `rejected`

### Email uniqueness

`email` is normalized (trim + lowercase) by the Edge Function before it
ever reaches the database, and a functional unique index enforces it at
the database level too:

```sql
create unique index early_access_signups_email_unique_idx
  on early_access_signups (lower(trim(email)));
```

This is the same pattern already used for `property_job_titles`'
`lower(trim(name))` index — no `citext` extension needed. `Test@Hotel.it`
and `test@hotel.it` are the same lead.

### Indexes

Exactly three, all with a clear purpose (no over-indexing): the email
uniqueness index above, plus plain indexes on `created_at` and `status`
(the two columns any future admin/CRM view would filter or sort by).

### Duplicates

A second submission with an email that already exists does **not** create
a second row. The Edge Function:

1. Looks up the existing row by normalized email.
2. If found: **updates** `hotel_name`, `role`, `rooms_range`,
   `main_problem`, `marketing_consent`, and `updated_at` (via the trigger).
   `id` and `created_at` are untouched. `status` is **never** reset to
   `'new'` by a re-submission — it's a CRM field, driven by whatever staff
   do with the lead, not by the visitor filling the form again.
3. UTM fields (and `landing_path`) are merged: a new, non-empty value
   overwrites the old one; a blank/omitted value in the new payload never
   erases attribution a previous submission already recorded.
4. Either way, a notification email is sent — a re-submission is still a
   real event someone should see.

## RLS and security

RLS is enabled with **zero policies** — the same "fully locked down"
pattern this project already uses for `guest_sessions`
(`0007_rls_policies.sql`). With row security on and no matching policy:

- `anon`/`authenticated` SELECT returns 0 rows.
- `anon`/`authenticated` INSERT/UPDATE/DELETE raises a `42501` row-level-security violation.

No `WITH CHECK (true)` policy exists anywhere for this table. No table
grant is hand-managed either — consistent with this project's own stated
convention (see the comment in
`20260827122500_explicit_anon_authenticated_revokes.sql`: tables here rely
on Supabase's standard grant plus RLS as the actual boundary, never a
hand-managed table grant).

The **only** thing that can read or write this table is the Edge
Function's service-role client (`service_role` bypasses RLS by Supabase's
own standard role setup).

The service role key:

- is read from `Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')` inside the Edge
  Function only;
- is never prefixed `VITE_`, never referenced from `apps/web` or
  `apps/guest` source (enforced by an automated test — see Testing below);
- is provided automatically by the Supabase Edge Runtime for every
  function in the project (same as `SUPABASE_URL`) — nothing to configure
  manually for these two specifically.

## CORS

The landing is a separate deployment on its own domain(s), so the
`Access-Control-Allow-Origin: *` this project's other (internal,
JWT-gated) functions use is not appropriate here — for an unauthenticated
endpoint, the origin allowlist **is** the access boundary for browsers.

Configured via `EARLY_ACCESS_ALLOWED_ORIGINS`, a comma-separated list:

```
EARLY_ACCESS_ALLOWED_ORIGINS=https://homisuite.com,https://www.homisuite.com,http://localhost:5173
```

Behavior:

- No `Origin` header at all (non-browser caller) → request proceeds,
  unheadered (nothing for a browser's CORS to enforce anyway).
- `Origin` present and in the allowlist → reflected back in
  `Access-Control-Allow-Origin`, request proceeds.
- `Origin` present and **not** in the allowlist → `403 origin_not_allowed`,
  no CORS header granted.
- `OPTIONS` preflight follows the same allow/deny logic (`204` with CORS
  headers, or `403` with none).

The real landing domain is never hardcoded — if it isn't known yet, leave
`EARLY_ACCESS_ALLOWED_ORIGINS` unset in whichever environment doesn't have
it, rather than guessing a value into the code.

## UTM and honeypot

- `utm_source`, `utm_medium`, `utm_campaign`, `utm_content`, `utm_term`,
  `landing_path`: all optional, all server-validated for type and length
  regardless of what the client claims to send (max 250 chars for UTM
  fields, 500 for `landing_path`).
- `website`: a honeypot. A real visitor never sees or fills this field (the
  landing should render it visually hidden, off-screen — not
  `display:none`, which some bots skip). If it contains any non-blank
  text, the function returns the **same success response** a real
  submission would get, but saves nothing and sends no email — the bot
  never learns it was detected.
- **Cloudflare Turnstile**: not implemented (per the brief, on purpose —
  no new external service for now). The code has a single, clearly marked
  insertion point (`TODO(turnstile)` in `index.ts`, right before payload
  validation) — verifying a token there and falling through to the same
  `400 invalid_payload` on failure is the entire integration once/if it's
  needed.

## Email notification and confirmation

**No transactional email provider existed anywhere in this repository**
before this feature (confirmed by searching for Resend/SendGrid/Postmark/
SMTP across the whole codebase). A minimal, swappable provider abstraction
was added — **Resend** is the default/suggested provider, selected only
via `EMAIL_PROVIDER`. No account was created and no credentials, real or
placeholder, were added anywhere.

Every valid submission sends **two independent emails**, both for a brand
new lead and for a re-submission that updates an existing one (see
Duplicates above). Delivery order is fixed: **validate → save/update in
Supabase → attempt the notification → attempt the confirmation** — never
before the database write, and the two emails never gate each other: a
failure sending one is logged and does not stop the other from being
attempted (see `handleRequest` in `index.ts`).

**Email failure never loses a lead.** If Supabase write fails, the API
call fails (`500`) and neither email is sent. If Supabase succeeds but an
email fails (provider down, misconfigured, etc.), the lead stays saved
exactly as written, the API still returns its normal `200`/`201` success,
and the failure is only logged server-side (`console.error`, safe message
only — no stack trace or provider response body). The database is the
single source of truth; a temporary email outage is never allowed to look
like a lost submission.

### 1. Internal notification — to `EARLY_ACCESS_NOTIFICATION_TO`

Subject: `[homisuite] Nuova richiesta Early Access — {hotel_name}`

Body (plain text + simple HTML, both generated by `buildNotificationEmail`
in `index.ts`) includes hotel, email, role (human label), rooms range,
main problem (human label), marketing consent (Sì/No), `utm_source`/
`utm_medium`/`utm_campaign`, `landing_path`, whether this is a new or
updated lead, and a timestamp. User-controlled fields are HTML-escaped
before being interpolated into the HTML body. Sent `from` `EMAIL_FROM`.

### 2. Confirmation — to the lead's own email address

Subject: `Richiesta ricevuta — homisuite early access`. Sent `from`
`EARLY_ACCESS_CONFIRMATION_FROM` (`info@homisuite.com`), **not**
`EMAIL_FROM` — the internal notification and the visitor-facing
confirmation are allowed to use different sending addresses, since one
goes to staff and the other to an external inbox.

Body (plain text + styled HTML, generated by `buildConfirmationEmail` in
`index.ts`) reassures the visitor their request was received (or updated,
on a re-submission — the copy branches on `isNew` the same way the
internal notification does), and lists what happens next. It is styled to
match the public landing (`Absnautilus/Homisuite-landing`): same purple
gradient header, same copy tone, laid out as email-safe HTML (tables,
inline styles, an Outlook/VML gradient fallback — modern CSS is not
reliable in email clients). The logo image is served from that repo's
public GitHub content via jsDelivr (`CONFIRMATION_LOGO_URL` in
`index.ts`) since no `homisuite.com`-hosted asset exists yet; update that
constant once one does. User-controlled fields are HTML-escaped the same
way as the notification email.

## Privacy

Deliberately **not** collected or stored anywhere: IP address, user agent,
browser fingerprint, geolocation. `marketing_consent` is a separate,
optional boolean (default `false`) from the Early Access request itself —
the form works identically whether it's `true` or `false`.

## Environment variables

Configured as **Supabase project secrets** (`supabase secrets set ...
--project-ref <ref>`), not as a repo `.env` file — Edge Functions read
`Deno.env.get(...)` at runtime, sourced from the project's secrets, not
from anything checked into this repository.

| Variable | Required | Notes |
|---|---|---|
| `SUPABASE_URL` | provided automatically | injected by the Edge Runtime for every function in the project |
| `SUPABASE_SERVICE_ROLE_KEY` | provided automatically | same as above |
| `EARLY_ACCESS_ALLOWED_ORIGINS` | yes | comma-separated origins, see CORS above |
| `EARLY_ACCESS_NOTIFICATION_TO` | yes | target value: `info@homisuite.com` |
| `EMAIL_FROM` | yes | sender for the *internal* notification, e.g. `homisuite <notifications@homisuite.com>` — needs a verified sending domain with whichever provider is used |
| `EARLY_ACCESS_CONFIRMATION_FROM` | yes | sender for the *lead-facing* confirmation, e.g. `homisuite <info@homisuite.com>` — same verified domain as `EMAIL_FROM`, can be a different address on it |
| `EMAIL_PROVIDER` | no | defaults to `resend`, shared by both emails |
| `RESEND_API_KEY` | yes, if `EMAIL_PROVIDER=resend` (the default) | never commit this |

None of these were set on any real project by this change — see "Manual
steps" below.

## Testing

- **Database**: `supabase/tests/048_early_access_signups.test.sql`
  (pgTAP, matching this project's existing convention) — table existence,
  a service-role insert, case-insensitive uniqueness, each `CHECK`
  constraint (role/rooms_range/main_problem/status), and anon
  SELECT/INSERT/UPDATE all denied.
- **Edge Function**: `supabase/functions/early-access-signup/index.test.ts`
  (Deno's built-in test runner — no existing Edge Function in this project
  had any test coverage before this change, so this establishes the
  pattern). The Supabase client and the email provider are both injected
  as in-memory fakes; no real network or database call happens in the
  suite. Covers: valid payload → created, duplicate → updated (with the
  UTM-merge and status/id/created_at preservation rules), every validation
  rejection (email, hotel_name, role, rooms_range, main_problem,
  marketing_consent), the honeypot short-circuit, disallowed-origin
  rejection (including `OPTIONS` preflight), the DB-write-then-email
  ordering, an email-provider failure not touching the saved lead, a
  database failure returning a clean `500`, and a repo-wide scan
  confirming the service-role/Resend keys never appear in either client
  app's source.

  Run locally, from inside the function's own directory (not the repo
  root — see `deno.json`'s comment in CI for why this matters):
  ```
  cd supabase/functions/early-access-signup
  deno test --allow-env --allow-read .
  ```

## Vercel configuration

None needed. This feature adds no Vercel Function, no `api/` route, and no
change to either `apps/web/vercel.json` or `apps/guest/vercel.json` — the
endpoint is a Supabase Edge Function, deployed independently of any Vercel
build.

## Deploying the function

Manual only, gated exactly like every other Edge Function in this project
(`.github/workflows/deploy-functions.yml`): pick `early-access-signup` (or
`all`) from the workflow's `function_name` input, type the project ref to
confirm, run it. `supabase functions deploy` reads `verify_jwt` from
`supabase/config.toml` (see Endpoint above) and applies it to the deployed
function too — no separate flag needed. **This PR does not run that
workflow** — nothing is deployed by merging it.

## Viewing leads in Supabase

There is no in-app UI for this table (by design, for now — see Status
above, "no app UI reads or writes this yet"). Use the Supabase dashboard's
Table Editor (or SQL Editor) against `public.early_access_signups`,
authenticated as a project member — RLS doesn't apply to the dashboard's
own privileged connection.

## If the notification or confirmation email fails

Nothing to do urgently: the lead is safely in
`public.early_access_signups` regardless (see Email notification and
confirmation above). To recover:

1. Check the function's logs (Supabase dashboard → Edge Functions →
   `early-access-signup` → Logs) for the `early-access-signup: notification
   email failed ...` or `early-access-signup: confirmation email failed
   ...` line — it names the failure (e.g. a Resend HTTP status) without
   leaking the API key. The two are independent: one can fail while the
   other succeeds.
2. Fix the underlying cause (expired/missing `RESEND_API_KEY`, missing
   `EMAIL_FROM` / `EARLY_ACCESS_CONFIRMATION_FROM`, unverified sending
   domain, provider outage, etc.).
3. No lead is ever lost or needs re-entry — it's already a row in the
   table; a missed notification is a visibility gap, not a data-loss one.
