# Platform Admin — bootstrap procedure

There is no RPC, Edge Function, or UI path that creates a `platform_admins`
row. This is deliberate: any such path would be a self-promotion surface (a
client-reachable "become a platform admin" operation), which is exactly what
Fase A ruled out. The only way a platform admin is ever created is this
manual procedure, run against the Supabase project directly (SQL editor,
`psql`, or an MCP `execute_sql`-style tool with production access) by
someone who already has that access independently of this system — the same
trust boundary the project's own `profiles` bootstrap already relies on
(`docs/auth.md`: *"the first profile on a fresh project is necessarily
created by a service-role script or through Studio"*).

## Preconditions

- The target person already has a Supabase Auth account (`auth.users` row)
  and a `profiles` row — ordinary sign-up/invite, nothing platform-specific.
  Look up their `profiles.id` (= `auth.users.id`) by email in Studio/SQL
  first; never hardcode an email into a script committed to the repo.
- Decide the initial permission set. For the very first platform admin,
  granting all five seeded slugs is reasonable (there is no one else yet to
  separate duties from); for a second admin added later, grant only what
  their role actually needs.

## Procedure

Run as a single transaction, substituting the real `profile_id` (never
commit the substituted value anywhere):

```sql
begin;

-- 1. Create the platform admin identity, active from the start.
insert into platform_admins (profile_id, status)
values ('<profile-id-here>', 'active')
returning id as platform_admin_id \gset

-- 2. Grant permissions explicitly, one row per slug. Omit any slug this
--    admin shouldn't hold yet -- adding more later is just another INSERT
--    here, run the same way.
insert into platform_admin_permissions (platform_admin_id, permission_slug)
values
  (:'platform_admin_id', 'platform.organizations.read'),
  (:'platform_admin_id', 'platform.properties.read'),
  (:'platform_admin_id', 'platform.admins.manage'),
  (:'platform_admin_id', 'platform.support.read'),
  (:'platform_admin_id', 'platform.audit.read');

commit;
```

(`\gset` is a `psql` meta-command; running this through a tool without
`psql`'s meta-commands, substitute the generated `platform_admin_id` by hand
between the two statements instead.)

## Verification

```sql
select pa.id, pa.profile_id, pa.status, array_agg(pap.permission_slug order by pap.permission_slug) as permissions
from platform_admins pa
left join platform_admin_permissions pap on pap.platform_admin_id = pa.id
where pa.profile_id = '<profile-id-here>'
group by pa.id;
```

Confirms exactly one row, `status = 'active'`, and the expected permission
slugs — nothing more.

## MFA — not part of this procedure

Bootstrapping does not touch MFA at all: the first time this person signs in
and visits `/admin`, `platform_admin_self_status()` reports
`is_admin = true, mfa_satisfied = false`, and the console sends them to the
enrollment screen (PR B3) before any privileged RPC becomes callable (PR
B1's `platform_mfa_satisfied()` gate). There is no separate "enable MFA for
this admin" SQL step — it's the same Supabase Auth TOTP enrollment any user
goes through, just gating what this identity can additionally do once
verified.

## Suspending or removing access

Suspending an existing platform admin is `set_platform_admin_status(id,
'suspended')`, callable by any OTHER active platform admin holding
`platform.admins.manage` (see PR B1) — no manual SQL needed for this case.
A platform admin cannot suspend themselves is not specially prevented at the
database layer in this PR (the function doesn't check
`target != auth.uid()`); if that's unwanted, it is a one-line addition to
`set_platform_admin_status`, left out of the MVP because no admin exists yet
who would need the restriction. Flag this in review if you want it closed
before a second admin is ever bootstrapped.

Full removal (not just suspension) is only ever manual SQL:
`delete from platform_admins where id = '<id>'` — cascades to
`platform_admin_permissions` automatically (`on delete cascade`). There is
no RPC for this, matching the "no self-service path at all" principle this
whole table follows.
