-- Per-member MODULE ACCESS (distinct from per-member PERMISSION overrides,
-- which 20261008090000_member_permission_overrides already built). This is
-- the other half of:
--
--   Accesso al modulo = modulo abilitato per la struttura AND accesso
--                        individuale consentito
--   Permesso effettivo = accesso al modulo AND (permesso del ruolo OR
--                         override individuale)
--
-- property_modules already answers "is this module even switched on for
-- this property" (structure-wide). This migration adds "can THIS SPECIFIC
-- member enter it at all", independent of whatever their role would
-- otherwise allow -- today nothing answers that question for any module:
-- Turni has no per-member gate whatsoever, and Housekeeping/Dining's only
-- per-member gate is the legacy staff_profiles.active row bridged by
-- grant-housekeeping-access, which is intentionally left untouched (see
-- the architecture note below).
--
-- Design: a new, independent table rather than extending
-- membership_permission_grants or staff_profiles. Reasons:
--   - It answers a different question (CAN I ENTER at all) from
--     membership_permission_grants (WHICH EXTRA CAPABILITIES do I have
--     once in) -- conflating the two would mean "no access" and "no extra
--     permissions" become indistinguishable rows in the same table.
--   - staff_profiles is Housekeeping/Dining-legacy-specific (hotel_id, not
--     property_id; also carries unrelated Housekeeping-only columns like
--     department/login_username) and has no row at all for a member who
--     only works Turni -- piggybacking on it would mean creating legacy
--     rows for members who have nothing to do with the legacy system.
--
-- Default-safe by construction: ABSENCE of a row means access is allowed.
-- A migration that ships this table backfills nothing and revokes nothing
-- -- every existing membership keeps full access to every module exactly
-- as before, until an admin explicitly disables one for one member.
begin;

create table membership_module_access (
  membership_id uuid not null references memberships(id) on delete cascade,
  module_id uuid not null references modules(id) on delete cascade,
  enabled boolean not null default true,
  updated_by uuid references profiles(id) on delete set null,
  updated_at timestamptz not null default now(),
  primary key (membership_id, module_id)
);

alter table membership_module_access enable row level security;

-- Same shape as membership_permission_grants: no direct table access for
-- anyone, every read/write goes through the RPCs below, which apply the
-- real authorization check (core.staff.manage on the target membership's
-- own scope).
revoke all on membership_module_access from public, authenticated, anon;

-- ---------------------------------------------------------------------------
-- has_module_access -- the module-entitlement counterpart of has_permission:
-- "is this module on for the property, AND has this specific caller not
-- been individually blocked from it". Deliberately NOT a replacement for
-- has_module()/hotel_has_module() themselves: those stay pure
-- property-level entitlement checks and are still used as-is wherever a
-- GUEST-facing or anonymous caller needs to know "is this module sold
-- here" (e.g. dining's public menu/availability policies, granted to
-- anon) -- a staff member's own individual access block must never affect
-- what a guest can see. This function is only ever substituted in for
-- has_module() in STAFF-facing resolution paths below.
-- ---------------------------------------------------------------------------
create function has_module_access(p_property_id uuid, p_module_slug text) returns boolean
language sql stable security definer set search_path = public as $$
  select has_module(p_property_id, p_module_slug)
    and not exists (
      select 1
      from memberships m
      join modules mod on mod.slug = p_module_slug
      join membership_module_access mma on mma.membership_id = m.id and mma.module_id = mod.id
      where m.profile_id = auth.uid()
        and m.status = 'active'
        and (
          m.property_id = p_property_id
          or m.organization_id = (select organization_id from properties where id = p_property_id)
        )
        and mma.enabled = false
    );
$$;

revoke all on function has_module_access(uuid, text) from public;
grant execute on function has_module_access(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- profile_has_permission -- has_permission()'s own logic, generalized to an
-- arbitrary profile instead of always auth.uid(). has_permission() below is
-- now a thin wrapper around this for the common "check my own session"
-- case; this parameterized form exists for the uncommon case of a
-- SECURITY DEFINER function evaluating OTHER users' permissions in bulk
-- (e.g. deciding which of several staff members should receive a
-- notification) -- auth.uid() can't answer that, since it only ever
-- resolves the calling session's own identity.
--
-- Extended in place from has_permission()'s pre-existing body (same
-- pattern 20261008090000 used for membership_permission_grants) to also
-- require module access for any module-scoped permission. A permission
-- with module_id null (every core.* slug) is entirely unaffected --
-- structural/organization-wide admin capability is never gated by a
-- per-module access toggle, by explicit design: disabling someone's Turni
-- access blocks Turni, nothing else, and they (or another admin) can
-- always reach the Team page and flip it back regardless.
-- ---------------------------------------------------------------------------
create function profile_has_permission(p_profile_id uuid, p_property_id uuid, p_permission_slug text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1
    from memberships m
    join permissions perm on perm.slug = p_permission_slug
    where m.profile_id = p_profile_id
      and m.status = 'active'
      and (
        m.property_id = p_property_id
        or m.organization_id = (select organization_id from properties where id = p_property_id)
      )
      and (
        perm.module_id is null
        or (
          exists (
            select 1 from property_modules pm
            where pm.property_id = p_property_id
              and pm.module_id = perm.module_id
              and pm.enabled
          )
          and not exists (
            select 1 from membership_module_access mma
            where mma.membership_id = m.id
              and mma.module_id = perm.module_id
              and mma.enabled = false
          )
        )
      )
      and (
        exists (select 1 from role_permissions rp where rp.role_id = m.role_id and rp.permission_id = perm.id)
        or exists (select 1 from membership_permission_grants g where g.membership_id = m.id and g.permission_id = perm.id)
      )
  );
$$;

revoke all on function profile_has_permission(uuid, uuid, text) from public, anon;
grant execute on function profile_has_permission(uuid, uuid, text) to authenticated, service_role;

create or replace function has_permission(p_property_id uuid, p_permission_slug text) returns boolean
language sql stable security definer set search_path = public as $$
  select profile_has_permission(auth.uid(), p_property_id, p_permission_slug);
$$;

-- ---------------------------------------------------------------------------
-- Housekeeping/Dining's own staff-presence resolvers -- has_module(...) ->
-- has_module_access(...). Both are security definer + authenticated-only
-- (never anon), so this only ever affects a staff member's own view of
-- their operational hotel context, never anything guest-facing.
-- ---------------------------------------------------------------------------
create or replace function current_staff_hotel() returns uuid
language sql security definer stable set search_path = public as $$
  select sp.hotel_id
  from staff_profiles sp
  join legacy_property_mapping m on m.legacy_hotel_id = sp.hotel_id
  where sp.auth_user_id = auth.uid()
    and sp.active
    and has_property_access(m.platform_property_id)
    and has_module_access(m.platform_property_id, 'guest_requests')
  limit 1;
$$;

create or replace function current_staff_hotel_for_module(p_module_slug text) returns uuid
language sql security definer stable set search_path = public as $$
  select sp.hotel_id
  from staff_profiles sp
  join legacy_property_mapping m on m.legacy_hotel_id = sp.hotel_id
  where sp.auth_user_id = auth.uid()
    and sp.active
    and has_property_access(m.platform_property_id)
    and has_module_access(m.platform_property_id, p_module_slug)
  limit 1;
$$;

create or replace function legacy_hotel_for_property(p_property_id uuid, p_module_slug text) returns uuid
language sql stable security definer set search_path = public as $$
  select m.legacy_hotel_id
  from legacy_property_mapping m
  where m.platform_property_id = p_property_id
    and has_property_access(p_property_id)
    and has_module_access(p_property_id, p_module_slug)
  limit 1;
$$;

-- ---------------------------------------------------------------------------
-- member_module_access_status / set_member_module_access -- same
-- authorization shape as member_permission_status / grant_member_permission
-- / revoke_member_permission: security definer (to read/write the locked-
-- down table above), explicit core.staff.manage check on the TARGET
-- membership's own scope (property or organization), since security
-- definer bypasses RLS on every table the body touches, memberships
-- included -- this explicit check is the only real gate, not RLS
-- visibility.
-- ---------------------------------------------------------------------------
create function member_module_access_status(p_membership_id uuid, p_module_slug text) returns boolean
language plpgsql stable security definer set search_path = public as $$
declare
  v_membership memberships%rowtype;
  v_authorized boolean;
  v_enabled boolean;
begin
  select * into v_membership from memberships where id = p_membership_id;
  if v_membership.id is null then
    raise exception 'membership_not_found' using errcode = '22023';
  end if;

  v_authorized := case
    when v_membership.property_id is not null then has_permission(v_membership.property_id, 'core.staff.manage')
    else has_organization_permission(v_membership.organization_id, 'core.staff.manage')
  end;
  if not v_authorized then
    raise exception 'insufficient_privilege' using errcode = '42501';
  end if;

  select mma.enabled into v_enabled
  from membership_module_access mma
  join modules mod on mod.id = mma.module_id
  where mma.membership_id = p_membership_id and mod.slug = p_module_slug;

  return coalesce(v_enabled, true);
end;
$$;

create function set_member_module_access(p_membership_id uuid, p_module_slug text, p_enabled boolean) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_membership memberships%rowtype;
  v_module_id uuid;
  v_authorized boolean;
begin
  select * into v_membership from memberships where id = p_membership_id;
  if v_membership.id is null then
    raise exception 'membership_not_found' using errcode = '22023';
  end if;

  v_authorized := case
    when v_membership.property_id is not null then has_permission(v_membership.property_id, 'core.staff.manage')
    else has_organization_permission(v_membership.organization_id, 'core.staff.manage')
  end;
  if not v_authorized then
    raise exception 'insufficient_privilege' using errcode = '42501';
  end if;

  select id into v_module_id from modules where slug = p_module_slug;
  if v_module_id is null then
    raise exception 'unknown_module' using errcode = '22023';
  end if;

  insert into membership_module_access (membership_id, module_id, enabled, updated_by, updated_at)
  values (p_membership_id, v_module_id, p_enabled, auth.uid(), now())
  on conflict (membership_id, module_id)
  do update set enabled = excluded.enabled, updated_by = excluded.updated_by, updated_at = excluded.updated_at;
end;
$$;

revoke all on function has_module_access(uuid, text) from public, anon;
revoke all on function member_module_access_status(uuid, text) from public;
grant execute on function member_module_access_status(uuid, text) to authenticated;
revoke all on function set_member_module_access(uuid, text, boolean) from public;
grant execute on function set_member_module_access(uuid, text, boolean) to authenticated;

commit;
