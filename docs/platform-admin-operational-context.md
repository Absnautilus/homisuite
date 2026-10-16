# Platform Admin — permanent privileges vs. operational context

Fase C corrects a framing mistake carried over from the original "support
session" draft of this feature. Writing it down explicitly here, since it
governs every PR from C1 onward.

## The distinction

**Admin Master (the platform owner) holds standing, permanent authorization
over the entire platform.** This is not a grant that is requested,
approved, or activated — it is a direct consequence of being an active
`platform_admins` row with the relevant `platform_permissions` granted, and
a verified MFA session, exactly the primitives PR B1 already built
(`is_platform_admin()`, `platform_has_permission()`,
`platform_mfa_satisfied()`). No client, organization, or property ever
authorizes or is asked to authorize this access — the whole point of
`platform_admins` being structurally separate from `memberships` (B1) is
that this authority never flows through, or depends on, the tenant RBAC
model at all.

**An operational session (`platform_operational_sessions`, this PR) is a
narrower, separate thing: which single property is currently "in view".**
It exists for three reasons, none of which is authorization:

1. **Scoping** — real module screens (Housekeeping/Dining/Shifts) need to
   know which one property's data to load; a session makes that explicit
   and server-recorded rather than an unchecked client-supplied parameter.
2. **Safety** — bounding how long a given browser tab stays "in view" of a
   specific property's operational data limits the blast radius of an
   unattended or compromised session, independent of how long the
   underlying account privileges last.
3. **Audit** — a queryable record of when, and on which property, the
   operational console was used, plus (from PR C4 onward) which specific
   screens/records were consulted during it.

A session expiring, or being explicitly closed, **never revokes the
underlying permission or the platform admin identity** — it just means the
"current property in view" has lapsed, and opening a new one is instant,
self-service, and asks no one's permission (same permission + MFA check as
every other privileged Platform Admin action, nothing more).

Conversely, **suspending the admin's `platform_admins` row (`B1`'s
`set_platform_admin_status`) revokes access immediately, regardless of any
still-unexpired session row.** Every function in this PR re-checks
`is_platform_admin()` live, on every call — a session is never a cached
credential that outlives the identity behind it.

## What this PR (C1) does and does not do

- Adds `platform_operational_sessions` and its lifecycle functions
  (`platform_open_operational_session`, `platform_close_operational_session`,
  `platform_revoke_operational_session`, `platform_my_operational_session`).
- Reuses `platform.support.read` (already seeded, unused, in B1) as the
  permission gating *opening* a session; reuses `platform.admins.manage`
  (already used by `set_platform_admin_status`) as the stricter permission
  required to *revoke* someone else's session.
- Does **not** touch any operational table's RLS (`guest_requests`,
  `stays`, `dining_*`, `shift_*`, or any other module-owned table). A
  session existing, by itself, grants no read access to anything yet — that
  wiring is PR C2's job, module by module, with its own isolation and
  negative (write-still-denied) tests.
- Does **not** create a `memberships` row, a `staff_profiles` row, or any
  tenant-RBAC role. Nothing here is visible to, or derived from, the
  client-facing permission model at all.

## What PR C2 must preserve

When C2 wires an operational session into a module's read policies, the new
read-authorization helper must check **both** facts fresh, every time — a
live `is_platform_admin()` + `platform_has_permission(...)` +
`platform_mfa_satisfied()` check **and** an active, unexpired session
scoped to the property being read — never only one of the two. Caching
either fact inside the session row (so a later permission revocation or
suspension wouldn't take effect until the session separately expired) would
silently reintroduce the "session as a stale credential" problem this
design exists to avoid.
