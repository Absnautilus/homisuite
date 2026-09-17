# End-to-end (browser) tests for `apps/web`

The browser suite lives in `apps/web/e2e/smoke.spec.ts`. CI runs it against
the disposable Supabase stack created by the database job, after the complete
migration, seed and pgTAP run. The fixture script creates only fictitious
`@example.test` users and deterministic local rows; it never accepts or uses a
hosted-project reference.

## Test 1: login form renders (no backend needed)

Only needs the dev server up and *some* value for `VITE_SUPABASE_URL` /
`VITE_SUPABASE_ANON_KEY` in `apps/web/.env.local` — constructing the
Supabase client doesn't make a network call, so a placeholder is enough
(same assumption `packages/core-sdk/src/client.test.ts` already makes).

```bash
cd apps/web
npm run test:e2e -- -g "shows the login form"
```

## Authenticated suite (needs a local Supabase stack)

1. `supabase start` (from the repository root)
2. Get the local URL, anon key and service-role key from `supabase status -o json`.
3. Provision the deterministic fixtures (idempotent, safe to re-run):
   ```bash
   SUPABASE_URL=http://127.0.0.1:54321 \
   SUPABASE_SERVICE_ROLE_KEY=<paste> \
   node scripts/e2e/provision-fixtures.mjs
   ```
   This creates an organization admin, a property-scoped receptionist with a
   deterministic job title, a mapped Housekeeping hotel, one room and one
   active stay.
4. Point `apps/web/.env.local` at the same local stack (`supabase status`
   again for the URL and anon key):
   ```
   VITE_SUPABASE_URL=http://127.0.0.1:54321
   VITE_SUPABASE_ANON_KEY=<paste>
   ```
5. Run the suite:
   ```bash
   cd apps/web
   npm run test:e2e
   ```

The suite covers signed-out rendering, authenticated login/logout, property
switching, Team administrator and read-only behavior, Housekeeping capability
navigation with a real stay, category/item creation and cascade removal in
Gestione, and authenticated unknown-route fallback.

CI is the authoritative full run because `ubuntu-latest` provides Docker.
Developer machines without Docker can still run the signed-out test alone.
