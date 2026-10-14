-- Platform Admin identity — Fase B, PR B1.
--
-- A Platform Admin is Homisuite's own staff, not a tenant concept. It is
-- deliberately NOT a row in `memberships`, NOT a role in the ordinary
-- `roles` table, and NOT derived from any membership scope. See
-- docs/platform-admin-architecture.md (Fase A audit) for the full
-- rationale: mixing a "global" concept into the tenant-scoped RBAC model
-- is exactly the pattern that produced the pre-existing, documented
-- current_staff_is_master() cross-tenant gap (migration
-- 20260905134500_guest_requests_hotels_org_isolation.sql's own comment) —
-- this is built as a structurally separate system specifically so the same
-- mistake can't recur here.
--
-- Nothing in this migration touches `memberships`, `roles`,
-- `role_permissions`, or any existing RLS policy. No existing migration is
-- modified or duplicated.

begin;

-- ---------------------------------------------------------------------------
-- platform_admins — one row per Platform Admin identity, 1:1 with profiles.
-- UNIQUE(profile_id) is a full (non-partial) constraint, not a partial index
-- scoped to status='active': suspending and reactivating updates the SAME
-- row (status flips, updated_at bumps) rather than archiving one row and
-- inserting a new one. A profile can never hold two platform_admins rows,
-- active or not — there is exactly one lifecycle per profile.
-- ---------------------------------------------------------------------------
create table platform_admins (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references profiles(id) on delete cascade,
  status text not null default 'active' check (status in ('active', 'suspended')),
  granted_by uuid references profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint platform_admins_profile_id_unique unique (profile_id)
);

alter table platform_admins enable row level security;

-- No policy at all, for any role. Zero rows are selectable or writable by
-- `authenticated` or `anon` through any path — the only way in is the
-- SECURITY DEFINER functions below (which run as the function owner and
-- bypass RLS) or a service-role bootstrap script. Same pattern this repo
-- already uses for `guest_sessions` (see docs/rls.md, "Two layers, both
-- required") and for `property_modules` (migration 0013).
revoke all on platform_admins from public, authenticated, anon;

-- ---------------------------------------------------------------------------
-- platform_permissions — the fixed catalog of platform-scoped permission
-- slugs. Same shape as the client-facing `permissions` table (a plain slug
-- registry), but in its own namespace: never joined against `role_permissions`
-- or `memberships`, so a client-facing permission slug and a platform one can
-- never collide or be confused by a query that forgets which table it meant.
--
-- MVP seeds only the slugs this PR's own RPCs actually check
-- (platform.admins.manage, used by set_platform_admin_status below).
-- platform.organizations.read / platform.properties.read / platform.support.read /
-- platform.audit.read are seeded now (so PR B2 and later don't need a second
-- permissions migration) but nothing in this PR grants or checks them yet.
-- ---------------------------------------------------------------------------
create table platform_permissions (
  slug text primary key
);

alter table platform_permissions enable row level security;
revoke all on platform_permissions from public, authenticated, anon;

insert into platform_permissions (slug) values
  ('platform.organizations.read'),
  ('platform.properties.read'),
  ('platform.admins.manage'),
  ('platform.support.read'),
  ('platform.audit.read');

-- ---------------------------------------------------------------------------
-- platform_admin_permissions — which permissions a given platform admin
-- holds. Deliberately no self-service grant path exists anywhere in this
-- PR: the only way a row is ever inserted here is the manual bootstrap
-- procedure (docs/platform-admin-bootstrap.md), run as service-role outside
-- any RPC. There is no "grant permission" RPC in this MVP — adding one is
-- out of scope until a second platform admin actually needs one (see Fase A
-- report, §7 MVP vs. later).
-- ---------------------------------------------------------------------------
create table platform_admin_permissions (
  platform_admin_id uuid not null references platform_admins(id) on delete cascade,
  permission_slug text not null references platform_permissions(slug) on delete restrict,
  granted_at timestamptz not null default now(),
  granted_by uuid references profiles(id) on delete set null,
  primary key (platform_admin_id, permission_slug)
);

alter table platform_admin_permissions enable row level security;
revoke all on platform_admin_permissions from public, authenticated, anon;

-- ---------------------------------------------------------------------------
-- is_platform_admin() — the one question every other function here reduces
-- to. SECURITY DEFINER (platform_admins has zero grants to authenticated,
-- so this must bypass RLS to read it), STABLE, search_path pinned. Reads
-- only auth.uid() — never accepts a profile id from the caller.
-- ---------------------------------------------------------------------------
create function is_platform_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from platform_admins pa
    where pa.profile_id = auth.uid()
      and pa.status = 'active'
  );
$$;

revoke all on function is_platform_admin() from public, anon;
grant execute on function is_platform_admin() to authenticated;

-- ---------------------------------------------------------------------------
-- platform_mfa_satisfied() — true only if the CURRENT session's access
-- token carries aal2 (Authentication Assurance Level 2 — Supabase issues
-- this claim once an MFA factor has actually been verified in this login
-- session, not merely enrolled). Reads only the caller's own JWT via
-- auth.jwt() — no table access, so no SECURITY DEFINER needed, and nothing
-- here can be spoofed client-side: the claim is inside the signed access
-- token PostgREST forwards as `request.jwt.claims`, not a value the client
-- can set directly. This is Supabase's own documented mechanism for
-- gating privileged operations behind MFA (see Fase A report §5) — not a
-- bespoke scheme.
-- ---------------------------------------------------------------------------
create function platform_mfa_satisfied() returns boolean
language sql stable as $$
  select coalesce(auth.jwt() ->> 'aal', 'aal1') = 'aal2';
$$;

revoke all on function platform_mfa_satisfied() from public, anon;
grant execute on function platform_mfa_satisfied() to authenticated;

-- ---------------------------------------------------------------------------
-- platform_has_permission(slug) — the platform-scoped analogue of
-- has_permission(). Deliberately does NOT check platform_mfa_satisfied()
-- itself: permission and assurance level are two separate facts (same
-- reasoning permissions.md gives for keeping entitlement and authorization
-- separate), and some callers (the self-status check below) need to know
-- "what could this admin do, once verified" without that answer flipping
-- based on today's session. Every privileged RPC must check BOTH
-- platform_has_permission(...) AND platform_mfa_satisfied() itself — see
-- set_platform_admin_status below for the pattern PR B2's RPCs reuse.
-- ---------------------------------------------------------------------------
create function platform_has_permission(p_permission_slug text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1
    from platform_admins pa
    join platform_admin_permissions pap on pap.platform_admin_id = pa.id
    where pa.profile_id = auth.uid()
      and pa.status = 'active'
      and pap.permission_slug = p_permission_slug
  );
$$;

revoke all on function platform_has_permission(text) from public, anon;
grant execute on function platform_has_permission(text) to authenticated;

-- ---------------------------------------------------------------------------
-- platform_admin_self_status() — the one platform function an UNVERIFIED
-- admin can still call: the frontend's /admin route guard needs to know
-- "am I a platform admin, suspended or active, MFA-verified or not, and
-- what could I do once verified" BEFORE it can decide whether to show the
-- MFA enrollment screen at all. Gating this behind platform_mfa_satisfied()
-- would be a lockout (an unverified admin could never even reach the
-- enrollment prompt). It is still safe unconditionally: everything it
-- returns is the caller's own state, scoped to their own auth.uid(), never
-- another profile's — there is no parameter to spoof.
-- ---------------------------------------------------------------------------
create function platform_admin_self_status() returns table(
  is_admin boolean,
  status text,
  mfa_satisfied boolean,
  permissions text[]
)
language sql stable security definer set search_path = public as $$
  select
    exists(select 1 from platform_admins pa where pa.profile_id = auth.uid()) as is_admin,
    (select pa.status from platform_admins pa where pa.profile_id = auth.uid()) as status,
    platform_mfa_satisfied() as mfa_satisfied,
    coalesce((
      select array_agg(pap.permission_slug order by pap.permission_slug)
      from platform_admins pa
      join platform_admin_permissions pap on pap.platform_admin_id = pa.id
      where pa.profile_id = auth.uid() and pa.status = 'active'
    ), '{}'::text[]) as permissions;
$$;

revoke all on function platform_admin_self_status() from public, anon;
grant execute on function platform_admin_self_status() to authenticated;

-- ---------------------------------------------------------------------------
-- set_platform_admin_status() — the ONLY mutating entry point in this PR.
-- Suspends or reactivates an EXISTING platform admin by updating that same
-- row (never inserts a new one — satisfies the "same record" correction
-- from Fase A). Requires both platform.admins.manage AND a verified MFA
-- session: this is as privileged an operation as this system has (it can
-- strip another admin's access, or restore it), so it is the first — and
-- for this PR, only — consumer of the "permission AND mfa" pattern every
-- later privileged RPC must repeat.
--
-- Deliberately cannot create a NEW platform_admins row: there is no insert
-- path here or anywhere else client-reachable. The first admin, and any
-- admin added later, is exclusively a manual bootstrap operation (see
-- docs/platform-admin-bootstrap.md) — never an RPC, so there is no
-- self-promotion surface to secure in the first place.
-- ---------------------------------------------------------------------------
create function set_platform_admin_status(p_platform_admin_id uuid, p_status text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if p_status not in ('active', 'suspended') then
    raise exception 'invalid_status' using errcode = '22023';
  end if;

  if not platform_has_permission('platform.admins.manage') then
    raise exception 'insufficient_privilege' using errcode = '42501';
  end if;

  if not platform_mfa_satisfied() then
    raise exception 'mfa_required' using errcode = '42501';
  end if;

  update platform_admins
  set status = p_status, updated_at = now()
  where id = p_platform_admin_id;

  if not found then
    raise exception 'platform_admin_not_found' using errcode = '22023';
  end if;
end;
$$;

revoke all on function set_platform_admin_status(uuid, text) from public, anon;
grant execute on function set_platform_admin_status(uuid, text) to authenticated;

commit;
