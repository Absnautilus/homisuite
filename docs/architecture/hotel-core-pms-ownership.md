# Shared PMS/OHIP ownership in Hotel Core

## Current state (verified in repository)

- `public.pms_integrations` is keyed by legacy `hotels.id` and stores mode, OHIP gateway/hotel code and write-only credentials. Browser reads are intentionally restricted to `get_pms_integration_status`; writes go through `save_pms_integration`. No direct authenticated RLS access is granted.
- The legacy Housekeeping admin page `modules/housekeeping/src/staff/admin/pms-integration-page.tsx` owns the UI and calls the legacy RPCs through `admin-api.ts`.
- OHIP synchronization is triggered by `triggerPmsSync` and the `sync-pms-stays` edge function. It must remain server-side. Moving the UI alone is **not** a migration of PMS ownership.
- Hotel Core already maps Core property IDs to legacy hotel IDs through `core_hotel_id_for_property`, but that bridge currently covers room/stay administration, not PMS configuration permissions.

## Target architecture

1. Core property owns a single PMS connection and sync status; use `property_id` as the canonical scope. Keep legacy hotel ID as a compatibility mapping until all consumers migrate.
2. Core-owned server RPCs/edge endpoints enforce `core.property.manage` (or a dedicated `core.integrations.manage`) on the selected property; do **not** use Housekeeping role or a client-supplied hotel ID as the authorization source.
3. Store OHIP secrets server-side, write-only and encrypted/managed with appropriate key handling; never return or log secrets. No direct browser table access. Validate gateway URL against approved Oracle endpoints and prevent arbitrary outbound requests.
4. Shared sync service owns OHIP polling, pagination, idempotent reservation upsert, room mapping, cancellation/checkout reconciliation, error logs, retry/backoff and last successful cursor. Define source precedence to prevent manual edits being overwritten silently.
5. Housekeeping, Dining, Guest Requests and other modules consume Core room/stay read APIs and sync state, not Housekeeping's `admin-api` or PMS UI.
6. Migrate existing `pms_integrations` rows and preserve credentials without returning them to the browser. Verify tenant isolation, permission matrices, reconnect, rollback and test mode before switching the canonical source.
7. Only after parity and migration, replace Housekeeping's PMS tab with a link to Core Integrations and retire legacy RPCs with an explicit compatibility window.

## Release gates

- Property manager can configure and test a connection; receptionist cannot read or modify credentials; Platform Admin operational view stays read-only.
- Existing OHIP-connected properties continue syncing across the transition with no duplicate stays, dropped cancellations or credential loss.
- End-to-end tests cover manual/Opera modes, malformed report, overlapping stays, revoked permissions, stale sync, cross-property isolation and error recovery.
- Do not ship a Core PMS settings form backed by legacy Housekeeping role checks: it would appear centralized while remaining coupled to Housekeeping.
