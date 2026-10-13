-- 20261011122857_restrict_member_permission_delegation introduced a
-- regression: it required the TARGET membership to be property-scoped
-- (`property_id is not null`) before a module permission could be
-- delegated to it, rejecting org-wide memberships with
-- 'property_membership_required'. That's wrong -- an org-wide membership is
-- a perfectly valid delegation target, and has_permission() already
-- resolves an org-wide override across every property of the organization
-- (see its `m.organization_id = (select organization_id from properties
-- where id = p_property_id)` branch). The pgTAP suite
-- (072_member_permission_overrides, tests 14-15) caught this immediately:
-- an organization_admin could no longer grant shifts.manage to an org-wide
-- member, which the original 20261008090000 migration explicitly supported
-- and tested.
--
-- This migration removes only that one check. Every other protection the
-- hardening added stays intact: the permission must be module-scoped and
-- not a core.* slug (module_id is not null and slug not like 'core.%'),
-- the caller's own core.staff.manage is still required on the target
-- membership's own scope, and anon/public still have no EXECUTE at all on
-- any of the three RPCs.
create or replace function grant_member_permission(p_membership_id uuid, p_permission_slug text) returns void
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

  select id into v_permission_id from permissions
  where slug = p_permission_slug and module_id is not null and slug not like 'core.%';
  if v_permission_id is null then
    raise exception 'permission_not_delegable' using errcode = '22023';
  end if;

  insert into membership_permission_grants (membership_id, permission_id, granted_by)
  values (p_membership_id, v_permission_id, auth.uid())
  on conflict (membership_id, permission_id) do nothing;
end;
$$;
