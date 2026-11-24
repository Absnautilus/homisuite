# Security proposal: `current_staff_is_master()` org-scoping

Status: **proposal only — no code in this document has been applied anywhere.**
Written as a standalone follow-up per the Fase B instructions ("non tentare di
risolverlo incidentalmente nelle migration Platform Admin"), separate from
PR B1/B2/B3.

## Correction relative to the Fase A audit

The Fase A report flagged this as an **open, Media-severity** cross-tenant
risk ("R1"). Re-verifying directly against the live production database
(`flyedzqqdrxxtxchoeer`) for this write-up, rather than migration-history
archaeology alone, shows that **assessment was wrong — the issue is already
remediated**. This document corrects that record and proposes a preventative
hardening, not a fix for an active vulnerability.

## Verified current state (2026-10-15, live production)

```sql
-- every policy anywhere in the project whose expression mentions the function
select schemaname, tablename, policyname, pg_get_expr(polqual, polrelid) as using_expr
from pg_policies pp
join pg_policy pol on pol.polname = pp.policyname and pol.polrelid = (pp.schemaname||'.'||pp.tablename)::regclass
where pg_get_expr(polqual, polrelid) ilike '%current_staff_is_master%';
```
→ **exactly one row**: `hotels.hotels_select_master`, with
`using_expr = (current_staff_is_master() AND (current_actor_role_rank(guest_requests_property_for_hotel(id)) = 40))`.

```sql
-- every OTHER function whose body calls it
select proname from pg_proc
where pronamespace = 'public'::regnamespace
  and prosrc like '%current_staff_is_master%'
  and proname <> 'current_staff_is_master';
```
→ **zero rows**.

So, today:
- The only policy that ever used `current_staff_is_master()` as an **unscoped**
  OR-branch bypass (`hotels_select_master`, originally
  `supabase/migrations/20260827120500_guest_requests_master_and_items.sql:33-34`)
  was fixed in `supabase/migrations/20260905134500_guest_requests_hotels_org_isolation.sql`,
  which added the `current_actor_role_rank(...) = 40` condition — correctly
  scoping it to the hotel's own mapped organization.
- The two `staff_profiles` policies that also used it unscoped
  (`staff_profiles_select_scoped`, `staff_profiles_write_scoped`, originally
  `20260827120500_guest_requests_master_and_items.sql:40-46`) were **replaced
  entirely** in `supabase/migrations/20260827122100_guest_requests_authorization_wrapper.sql:180-187`,
  switching to `guest_requests_staff_roster_visible(hotel_id)` /
  `guest_requests_staff_manage_allowed(hotel_id)` — both correctly scoped via
  `has_property_access(p.id) or has_organization_access(p.organization_id)`,
  with no call to `current_staff_is_master()` at all.
- No other function body references `current_staff_is_master()`.

**There is no live cross-tenant bypass through this function today.**

## Why this is still worth a hardening PR

`current_staff_is_master()` itself (defined in
`20260827122100_guest_requests_authorization_wrapper.sql:134-146`) still has
a **global, no-argument contract**: *"this active staff user has at least one
active organization_admin membership, anywhere, regardless of which
organization the caller's own `staff_profiles` row belongs to."* The only
reason this is safe today is that **every current call site happens to
remember** to AND it with a separately-computed, correctly-scoped condition.

That's a foot-gun, not a design: the exact mistake it protects against
(treating `current_staff_is_master()` alone as sufficient) is precisely what
`hotels_select_master` **did** get wrong once, in production, for real
(per `20260905134500`'s own commit message: *"an organization_admin of Org A
could see hotel rows mapped to Org B as soon as multiple organizations
existed"*). Nothing in the function's own signature or name prevents a
future migration from reintroducing that exact mistake at a new call site —
the function still invites being read as "is this person a master,
period," which is not what it actually, safely means once more than one
organization exists.

## Proposed hardening (not yet implemented)

Parameterize the function so the scoping is enforced **inside it**, not
left to every caller to remember:

```sql
-- Proposed signature — NOT applied anywhere yet.
create or replace function current_staff_is_master(p_property_id uuid) returns boolean
language sql security definer stable set search_path = public as $$
  select exists (
    select 1
    from staff_profiles sp
    where sp.auth_user_id = auth.uid()
      and sp.active
  )
  and current_actor_role_rank(p_property_id) = 40;
$$;
```

This folds `hotels_select_master`'s own AND-condition directly into the
function, so a future call site that writes `current_staff_is_master(id)`
gets the correct, scoped behavior automatically — there is no longer an
unscoped variant to misuse.

### Call sites to update (both already correctly scoped today — this is a signature change, not a behavior fix)

| File | Current | Proposed |
|---|---|---|
| `20260905134500_guest_requests_hotels_org_isolation.sql` (policy `hotels_select_master`, to be superseded by a new migration — never edit this file retroactively) | `current_staff_is_master() AND current_actor_role_rank(guest_requests_property_for_hotel(id)) = 40` | `current_staff_is_master(guest_requests_property_for_hotel(id))` |

No other call site exists to update (confirmed above — zero other policies
or functions reference it).

### Migration plan

A single new, additive migration:
1. `create or replace function current_staff_is_master(uuid) returns boolean ...` (new overload, parameterized).
2. `drop policy hotels_select_master on hotels; create policy ... using (current_staff_is_master(guest_requests_property_for_hotel(id)));`
3. Leave the existing **no-argument** `current_staff_is_master()` in place,
   unchanged, for one deprecation window — confirm nothing else calls it
   (already verified above), then drop it in a follow-up migration once
   that's been re-verified against production one more time at the point of
   actually dropping it.

### Isolation tests needed (pgTAP, new file)

1. An `organization_admin` of Org A, with a `staff_profiles` row at a hotel
   mapped to Org B (the exact scenario `20260905134500` was written to
   close) → `current_staff_is_master(property_for_org_b_hotel)` returns
   `false`.
2. An `organization_admin` of Org A, with a `staff_profiles` row at a hotel
   mapped to **Org A** itself → `current_staff_is_master(property_for_org_a_hotel)`
   returns `true`.
3. `hotels_select_master`, re-tested end to end with the new signature:
   Org A's organization_admin selecting from `hotels` sees only Org A's
   mapped hotel rows, never Org B's — regression test for the exact bug
   `20260905134500` already fixed, now pinned against the new signature so
   it can't silently regress if the function is ever touched again.
4. A `property_admin` (rank 30, not 40) with a `staff_profiles` row
   anywhere → `current_staff_is_master(...)` returns `false` regardless of
   which property is passed (rank check alone must reject it).
5. `anon` cannot execute `current_staff_is_master(uuid)` (same
   `42501` grant-check pattern as every other staff helper).

### Risk / effort

- **Risk if not done**: none active today; the risk is purely about future
  maintainers reaching for the unscoped function out of habit. Low
  likelihood, but the exact failure mode already happened once.
- **Risk of doing it**: very low — this is a signature addition plus one
  policy re-point, both already proven correct by the existing
  `hotels_select_master` expression; the new tests pin the behavior before
  the old overload is ever removed.
- **Not bundled into PR B1/B2/B3**: per the Fase B instruction, and because
  it touches Housekeeping's own legacy authorization surface, which is
  explicitly out of scope for the Platform Admin work. Platform Admin's
  own functions (`is_platform_admin()`, `platform_has_permission()`) do not
  call `current_staff_is_master()` at all and are unaffected either way.
