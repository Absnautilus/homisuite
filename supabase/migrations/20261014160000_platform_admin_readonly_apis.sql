-- Platform Admin read-only administrative APIs — Fase B, PR B2.
--
-- Every function here follows the same two-check pattern PR B1 established
-- in set_platform_admin_status: platform_has_permission(slug) AND
-- platform_mfa_satisfied(), checked inside the function body (never left to
-- the caller). Plain Postgres RPCs, not Edge Functions — none of this needs
-- service-role (no auth.admin.* call, no outbound email), so adding an Edge
-- Function here would only add a second, unnecessary authorization surface
-- to keep in sync with this one. Same reasoning the rest of this repo's
-- authorization layer already follows (has_permission, getEnabledModules,
-- etc. are all RPCs).
--
-- None of these functions touch guest-facing or operational data: they
-- return only `organizations`/`properties`/`modules`/`property_modules`
-- administrative metadata, explicitly never `guest_requests`,
-- `reservations`, `stays`, `shift_*`, or any other module-owned table.
--
-- No existing RLS policy on `organizations`/`properties`/`property_modules`
-- is touched. These functions are SECURITY DEFINER and read those tables as
-- their owner, the same sanctioned mechanism `profile_has_permission`
-- already uses to read other profiles' memberships (docs/rls.md) — not a
-- new bypass added to those tables' own policies.

begin;

-- ---------------------------------------------------------------------------
-- platform_audit_log — deliberately NOT a reuse of the existing
-- `audit_logs` table (see Fase A report / this PR's description for why):
-- `audit_logs`' SELECT policy is keyed to `core.staff.manage` over the
-- row's own organization_id/property_id, which would either make Platform
-- Admin activity about a client's organization visible to that client's own
-- organization_admin (an unwanted leak the other direction), or, for a
-- genuinely global action (both ids null), be invisible to EVERYONE,
-- platform admins included, since no existing grant matches a fully-null
-- scope. A dedicated table, visible only through platform_has_permission(
-- 'platform.audit.read'), avoids both problems and keeps `audit_logs`
-- completely untouched — no column, constraint, or policy on it changes.
-- ---------------------------------------------------------------------------
create table platform_audit_log (
  id uuid primary key default gen_random_uuid(),
  actor_profile_id uuid references profiles(id) on delete set null,
  action text not null,
  target_type text,
  target_id uuid,
  metadata jsonb,
  created_at timestamptz not null default now()
);

alter table platform_audit_log enable row level security;

-- Same full lockdown as PR B1's tables: zero grants to authenticated/anon.
-- The only writer is log_platform_action() below (SECURITY DEFINER, never
-- itself granted to any client role — called only from inside the other
-- functions in this file, which needs no grant of its own; see docs/rls.md,
-- "Calling one SECURITY DEFINER function from inside another's body"). The
-- only reader is platform_list_audit_log(), gated on platform.audit.read.
-- This is what makes the log genuinely unfalsifiable from the client: there
-- is no INSERT grant for any role to forge an entry, and no way to reach
-- log_platform_action directly without going through a function that has
-- already independently verified the action it's logging actually happened.
revoke all on platform_audit_log from public, authenticated, anon;

create index platform_audit_log_created_at_idx on platform_audit_log (created_at desc);

create function log_platform_action(
  p_action text,
  p_target_type text default null,
  p_target_id uuid default null,
  p_metadata jsonb default null
) returns void
language sql security definer set search_path = public as $$
  insert into platform_audit_log (actor_profile_id, action, target_type, target_id, metadata)
  values (auth.uid(), p_action, p_target_type, p_target_id, p_metadata);
$$;

-- No grant to authenticated/anon/public at all -- intentionally
-- uncallable except from inside another SECURITY DEFINER function owned by
-- the same role.
revoke all on function log_platform_action(text, text, uuid, jsonb) from public, authenticated, anon;

-- ---------------------------------------------------------------------------
-- platform_log_console_access() — logs "this admin opened the console".
-- Gated on is_platform_admin() only, not the full permission+MFA pattern:
-- this has to be callable the moment someone with an active platform_admins
-- row reaches /admin, including before they've ever verified MFA -- the
-- same reasoning platform_admin_self_status() (PR B1) already follows.
-- ---------------------------------------------------------------------------
create function platform_log_console_access() returns void
language plpgsql security definer set search_path = public as $$
begin
  if not is_platform_admin() then
    raise exception 'insufficient_privilege' using errcode = '42501';
  end if;
  perform log_platform_action('platform.console_accessed');
end;
$$;

revoke all on function platform_log_console_access() from public, anon;
grant execute on function platform_log_console_access() to authenticated;

-- ---------------------------------------------------------------------------
-- platform_list_organizations() — the console's top-level organization
-- list. No per-row audit entry: browsing the overview list is already
-- implied by the console_accessed event, and logging every row of every
-- list call would make the audit log noise, not signal.
-- ---------------------------------------------------------------------------
create function platform_list_organizations() returns table(
  id uuid,
  name text,
  slug text,
  created_at timestamptz
)
language plpgsql security definer set search_path = public as $$
begin
  if not platform_has_permission('platform.organizations.read') then
    raise exception 'insufficient_privilege' using errcode = '42501';
  end if;
  if not platform_mfa_satisfied() then
    raise exception 'mfa_required' using errcode = '42501';
  end if;

  return query
    select o.id, o.name, o.slug, o.created_at
    from organizations o
    order by o.name;
end;
$$;

revoke all on function platform_list_organizations() from public, anon;
grant execute on function platform_list_organizations() to authenticated;

-- ---------------------------------------------------------------------------
-- platform_list_properties(organization_id) — drilling into one
-- organization's properties. Logs 'platform.organization_viewed' -- this
-- is the "consultazione di un'organizzazione" event.
--
-- Deliberately excludes `properties.settings` (free-form jsonb, can carry
-- operational config no platform admin review needs) -- only
-- administrative metadata is returned, per the "no unnecessary sensitive
-- data" requirement.
-- ---------------------------------------------------------------------------
create function platform_list_properties(p_organization_id uuid) returns table(
  id uuid,
  organization_id uuid,
  name text,
  slug text,
  status text,
  timezone text,
  created_at timestamptz
)
language plpgsql security definer set search_path = public as $$
begin
  if not platform_has_permission('platform.properties.read') then
    raise exception 'insufficient_privilege' using errcode = '42501';
  end if;
  if not platform_mfa_satisfied() then
    raise exception 'mfa_required' using errcode = '42501';
  end if;

  perform log_platform_action('platform.organization_viewed', 'organization', p_organization_id, null);

  return query
    select p.id, p.organization_id, p.name, p.slug, p.status, p.timezone, p.created_at
    from properties p
    where p.organization_id = p_organization_id
    order by p.name;
end;
$$;

revoke all on function platform_list_properties(uuid) from public, anon;
grant execute on function platform_list_properties(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- platform_list_property_modules(property_id) — "which modules does this
-- property have enabled", the admin-essential view of `property_modules`
-- (entitlement only -- never the module's own operational data). Logs
-- 'platform.property_viewed' -- the "consultazione di una proprietà" event.
-- ---------------------------------------------------------------------------
create function platform_list_property_modules(p_property_id uuid) returns table(
  module_id uuid,
  slug text,
  display_name text,
  enabled boolean
)
language plpgsql security definer set search_path = public as $$
declare
  v_organization_id uuid;
begin
  if not platform_has_permission('platform.properties.read') then
    raise exception 'insufficient_privilege' using errcode = '42501';
  end if;
  if not platform_mfa_satisfied() then
    raise exception 'mfa_required' using errcode = '42501';
  end if;

  select p.organization_id into v_organization_id from properties p where p.id = p_property_id;
  if v_organization_id is null then
    raise exception 'property_not_found' using errcode = '22023';
  end if;

  perform log_platform_action(
    'platform.property_viewed', 'property', p_property_id,
    jsonb_build_object('organization_id', v_organization_id)
  );

  return query
    select m.id, m.slug, m.display_name, coalesce(pm.enabled, false)
    from modules m
    left join property_modules pm on pm.module_id = m.id and pm.property_id = p_property_id
    order by m.slug;
end;
$$;

revoke all on function platform_list_property_modules(uuid) from public, anon;
grant execute on function platform_list_property_modules(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- platform_list_audit_log(limit, offset) — paginated, newest first.
-- Gated on platform.audit.read, same two-check pattern. Returns actor
-- full_name alongside actor_profile_id for a readable console view, nothing
-- else from `profiles`.
-- ---------------------------------------------------------------------------
create function platform_list_audit_log(p_limit int default 50, p_offset int default 0) returns table(
  id uuid,
  actor_profile_id uuid,
  actor_full_name text,
  action text,
  target_type text,
  target_id uuid,
  metadata jsonb,
  created_at timestamptz
)
language plpgsql security definer set search_path = public as $$
begin
  if not platform_has_permission('platform.audit.read') then
    raise exception 'insufficient_privilege' using errcode = '42501';
  end if;
  if not platform_mfa_satisfied() then
    raise exception 'mfa_required' using errcode = '42501';
  end if;
  if p_limit < 1 or p_limit > 200 then
    raise exception 'invalid_limit' using errcode = '22023';
  end if;

  return query
    select l.id, l.actor_profile_id, pr.full_name, l.action, l.target_type, l.target_id, l.metadata, l.created_at
    from platform_audit_log l
    left join profiles pr on pr.id = l.actor_profile_id
    order by l.created_at desc
    limit p_limit offset p_offset;
end;
$$;

revoke all on function platform_list_audit_log(int, int) from public, anon;
grant execute on function platform_list_audit_log(int, int) to authenticated;

commit;
