# Hotel Core: rooms and stays (migration plan)

Status: architecture foundation; **not implemented by this document**. This is the target contract for the subsequent implementation PRs. The current Housekeeping routes and RLS remain unchanged until replacement Core operations are tested.

## Decision

`rooms` and `stays` are **hotel-wide Core resources**, not Housekeeping features. Their canonical records remain the existing `public.rooms` and `public.stays` tables, linked to the existing legacy hotel ↔ Core property mapping. Do not duplicate tables or migrate live stay records unnecessarily.

Hotel Core owns:
- Room inventory, room number, active/deactivated state.
- Stay creation, editing, check-out, cancellation, active-state transitions and overlap checks.
- Guest identity associated with stays (do not introduce a duplicate guest table until a separate guest-domain design is approved).
- Property-scoped authorization and audit of these actions.

Housekeeping, Dining, Smart Inbox and future modules **consume** these records through Core APIs. They may keep module-specific records and module-specific guest workflows, but must not gate access to the underlying room/stay inventory.

## Verified current coupling

- `modules/housekeeping/src/staff/admin/rooms-page.tsx` owns the room editor and calls `@/lib/admin-api`.
- `modules/housekeeping/src/staff/stays/stays-page.tsx` owns the stay editor and calls `@/lib/stays-api`.
- `apps/web/src/modules/housekeeping/HousekeepingModuleGate.tsx` blocks the entire Housekeeping module if not entitled.
- `apps/web/src/pages/SettingsPage.tsx` currently has property settings but no Core rooms/stays entries.
- `apps/web/src/app/App.tsx` exposes Housekeeping routes but no independent Core rooms/stays routes.
- The production `stays` INSERT policy is currently tied to `current_staff_manages_front_desk()`, while the Platform Admin's operational access is SELECT-only. An attempted stay activation on 2026-11-09 failed with PostgreSQL RLS rejection, not a confirmed overlap.
- The existing database exclusion constraint `stays_no_overlapping_active` must be preserved.

## Target routes and UX

Under the property shell:
- `/settings/rooms` — room inventory and management.
- `/settings/stays` — stays list, create/edit/checkout/cancel, where authorized.

Both appear under **Impostazioni → Struttura** (or a future **Hotel → Gestione operativa** Core section). They must render and work with Housekeeping disabled or uninstalled. If a user's permission allows reading but not editing, show a genuine read-only view; do not render buttons that will fail RLS.

Legacy Housekeeping deep links must redirect to the corresponding Core route for ordinary users, or remain temporarily available as compatibility wrappers while the transition is tested. Do not break guest links, Opera import, room history, or existing Housekeeping requests.

## Authorization contract

Define explicit property-scoped Core capabilities (final names to be reconciled with `permissions` and role grants):
- `core.rooms.read` and `core.rooms.manage`
- `core.stays.read` and `core.stays.manage`

Do not infer write permission from `guest_requests` module entitlement, `staff_profiles.role`, or a broad `is_platform_admin()` predicate.

For tenant staff, authorize by active Core membership in the selected property, the appropriate capability and any explicit deny overrides. For Admin Master, standing global access may allow reading according to the platform policy; writes must use a separate, explicit platform authorization path, with MFA and audit. In **Visualizza come**, check a live, scoped impersonation session and the selected staff member's *Core* capability, and log the true platform actor plus viewed-as identity. Platform Support must never inherit global write access merely from `platform.support.read`.

Keep tenant INSERT/UPDATE RLS intact until the Core replacements are tested; never grant blanket bypasses or manufacture staff memberships.

## Safe delivery sequence

1. **Backend/Core API:** introduce property-scoped Core room/stay services and authorization, with pgTAP coverage for active/inactive membership, explicit deny, wrong property, disabled Housekeeping, platform read-only and impersonation. Preserve all existing stay constraints and references.
2. **Frontend Core:** extract room and stay UI into Core-owned pages and services; mount independent routes and settings navigation. Avoid importing Housekeeping feature modules into Core pages. The hotel timezone must be used consistently for dates.
3. **Compatibility:** update Housekeeping to consume Core APIs and redirect legacy navigation; migrate Opera import and guest-link integration safely.
4. **Cleanup:** remove Housekeeping-specific room/stay write policies and duplicated UI only after parity and production smoke tests.

## Acceptance tests (must pass before declaring complete)

- A property with Housekeeping disabled can create a room and a stay as an authorized Core user.
- An authorized property member can create, edit, check out and cancel stays; an unauthorized member cannot.
- Cross-property reads and writes are denied even when the room UUID is known.
- Overlapping active stays are rejected; nonoverlapping and historical stays are allowed.
- A stale `active` stay whose checkout is in the past does not block a later nonoverlapping stay.
- Admin Master ordinary operational view cannot perform unapproved writes; a valid impersonation session exercises only the viewed-as user's Core permission and produces correct audit attribution.
- Platform Support without explicit access is denied.
- Existing Housekeeping, Dining and guest access continue to work against the same room/stay IDs.
- `npm` typecheck/build, Playwright smoke and relevant pgTAP tests pass in CI.

## Relationship to the earlier draft stay fix

The separate draft branch `fix/platform-impersonated-stay-activation` introduced a Housekeeping-coupled RPC that checks `guest_requests` entitlement. **Do not merge that draft unchanged.** Its behavior conflicts with this decision; redesign the RPC to use Core permissions and independently test it as part of step 1.
