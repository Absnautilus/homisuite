-- Per-member permission overrides -- generalizes the "give this specific
-- staff member admin capability in a module, independent of their role"
-- need that Housekeeping already solved for itself (grant-housekeeping-access,
-- a bridge into its own legacy staff_profiles table), but for modules that
-- are already governed by Core's own role/permission system (dining.manage,
-- shifts.manage, ...) instead of a legacy table. Housekeeping's mechanism is
-- deliberately left untouched: it answers a different question ("does this
-- Core member have any presence in the legacy Housekeeping system at all"),
-- not "does this member additionally hold permission X".
--
-- The whole point is to be a single, generic addition that every existing
-- has_permission() caller benefits from automatically -- Dining and Turni's
-- own RLS policies and RPCs need no changes at all.
begin;

create table membership_permission_grants (
  membership_id uuid not null references memberships(id) on delete cascade,
  permission_id uuid not null references permissions(id) on delete cascade,
  granted_by uuid references profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (membership_id, permission_id)
);

alter table membership_permission_grants enable row level security;

-- No direct table access for anyone -- every read/write goes through the
-- RPCs below, which apply the real authorization check (core.staff.manage
-- on the target membership's own scope) and keep the grant/revoke idempotent.
revoke all on membership_permission_grants from public, authenticated, anon;

-- ---------------------------------------------------------------------------
-- has_permission -- extended in place (same name/signature) to also honor a
-- per-membership override, on top of the existing role-derived grant. A
-- membership with no override row behaves exactly as before.
-- ---------------------------------------------------------------------------
create or replace function has_permission(p_property_id uuid, p_permission_slug text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1
    from memberships m
    join permissions perm on perm.slug = p_permission_slug
    where m.profile_id = auth.uid()
      and m.status = 'active'
      and (
        m.property_id = p_property_id
        or m.organization_id = (select organization_id from properties where id = p_property_id)
      )
      and (
        perm.module_id is null
        or exists (
          select 1 from property_modules pm
          where pm.property_id = p_property_id
            and pm.module_id = perm.module_id
            and pm.enabled
        )
      )
      and (
        exists (select 1 from role_permissions rp where rp.role_id = m.role_id and rp.permission_id = perm.id)
        or exists (select 1 from membership_permission_grants g where g.membership_id = m.id and g.permission_id = perm.id)
      )
  );
$$;

-- ---------------------------------------------------------------------------
-- member_permission_status -- read-only, for a Team-page toggle to render
-- correctly: granted_by_role true means the toggle should show on but
-- disabled (nothing to revoke -- the role itself already grants it);
-- granted_by_override is the actual override row this module's grant/revoke
-- RPCs manage.
-- ---------------------------------------------------------------------------
-- security definer, same as grant/revoke below, so it can read
-- membership_permission_grants (locked down from everyone else) -- which
-- means, same as them, it must do its OWN authorization check rather than
-- leaning on memberships' RLS, or any authenticated caller who knows a
-- membership_id could probe another property's permission state.
create function member_permission_status(p_membership_id uuid, p_permission_slug text)
returns table (granted_by_role boolean, granted_by_override boolean)
language plpgsql stable security definer set search_path = public as $$
declare
  v_membership memberships%rowtype;
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

  return query
    select
      exists (
        select 1 from role_permissions rp
        join permissions perm on perm.id = rp.permission_id
        where rp.role_id = v_membership.role_id and perm.slug = p_permission_slug
      ) as granted_by_role,
      exists (
        select 1 from membership_permission_grants g
        join permissions perm on perm.id = g.permission_id
        where g.membership_id = p_membership_id and perm.slug = p_permission_slug
      ) as granted_by_override;
end;
$$;

-- ---------------------------------------------------------------------------
-- grant_member_permission / revoke_member_permission -- generic across any
-- module-scoped permission. security definer, so they can write to
-- membership_permission_grants (locked down from everyone else, see above);
-- the has_permission/has_organization_permission check below -- not RLS
-- visibility -- is the real gate here, since security definer bypasses RLS
-- on every table the body touches, memberships included.
-- ---------------------------------------------------------------------------
create function grant_member_permission(p_membership_id uuid, p_permission_slug text) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_membership memberships%rowtype;
  v_permission_id uuid;
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

  select id into v_permission_id from permissions where slug = p_permission_slug;
  if v_permission_id is null then
    raise exception 'unknown_permission' using errcode = '22023';
  end if;

  insert into membership_permission_grants (membership_id, permission_id, granted_by)
  values (p_membership_id, v_permission_id, auth.uid())
  on conflict (membership_id, permission_id) do nothing;
end;
$$;

create function revoke_member_permission(p_membership_id uuid, p_permission_slug text) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_membership memberships%rowtype;
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

  delete from membership_permission_grants g
  using permissions perm
  where g.membership_id = p_membership_id
    and g.permission_id = perm.id
    and perm.slug = p_permission_slug;
end;
$$;

revoke all on function member_permission_status(uuid, text) from public;
grant execute on function member_permission_status(uuid, text) to authenticated;
revoke all on function grant_member_permission(uuid, text) from public;
grant execute on function grant_member_permission(uuid, text) to authenticated;
revoke all on function revoke_member_permission(uuid, text) from public;
grant execute on function revoke_member_permission(uuid, text) to authenticated;

commit;
