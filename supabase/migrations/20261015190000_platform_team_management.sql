-- Platform Admin team management (create + list) -- Fase C follow-up (PR
-- C5), the first write capability past the "read-only for now" boundary
-- Fase C started under. Explicitly authorized: Admin Master must be able to
-- create and view a property's team from the admin console without ever
-- holding an ordinary membership there -- docs/platform-admin-operational-
-- context.md's standing-authorization design (never session-as-credential)
-- still holds; a session only scopes/audits which property, exactly as for
-- every operational read in this series.
--
-- platform_operational_action_allowed(property_id, permission_slug) --
-- generalizes platform_operational_read_allowed's four-fact check
-- (is_platform_admin + the NAMED permission + MFA + an active, unexpired,
-- property-scoped session) to an arbitrary platform permission slug instead
-- of hardcoding platform.support.read. platform_operational_read_allowed
-- itself is left completely untouched (still reused by dozens of read
-- policies across Shifts/Dining/Housekeeping) -- this is a new, additive
-- sibling, never a replacement, so every one of those policies keeps
-- working exactly as before.
--
-- Both new RPCs are SECURITY DEFINER and deliberately do NOT rely on any
-- RLS policy on memberships/profiles/property_staff_details -- they join
-- those tables directly inside the function body, scoped to the one
-- property_id the caller asked about and gated by
-- platform_operational_action_allowed. This is the safer alternative to
-- widening memberships_select/profiles_select with another OR-branch:
-- profiles especially has no property_id to scope by at the RLS layer (left
-- as a known, accepted gap by the Shifts PR's own header comment) -- a
-- widened policy there would leak every profile's name to any admin holding
-- a session on any single property. No RLS policy on any table, and no
-- existing function, is modified by this migration.

begin;

insert into platform_permissions (slug) values ('platform.team.manage');

-- ---------------------------------------------------------------------------
-- platform_operational_action_allowed -- new, parameterized sibling of
-- platform_operational_read_allowed.
-- ---------------------------------------------------------------------------
create function platform_operational_action_allowed(p_property_id uuid, p_permission_slug text) returns boolean
language sql stable security definer set search_path = public as $$
  select
    is_platform_admin()
    and platform_has_permission(p_permission_slug)
    and platform_mfa_satisfied()
    and exists (
      select 1
      from platform_operational_sessions s
      join platform_admins pa on pa.id = s.platform_admin_id
      where pa.profile_id = auth.uid()
        and pa.status = 'active'
        and s.property_id = p_property_id
        and s.status = 'active'
        and s.expires_at > now()
    );
$$;

revoke all on function platform_operational_action_allowed(uuid, text) from public, anon;
grant execute on function platform_operational_action_allowed(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- platform_list_property_team -- "vedi utenti". Joins profiles/roles/
-- property_staff_details/property_job_titles directly as the function
-- owner, never through the caller's own RLS visibility.
-- ---------------------------------------------------------------------------
create function platform_list_property_team(p_property_id uuid)
returns table (
  membership_id uuid,
  profile_id uuid,
  full_name text,
  role_id uuid,
  role_slug text,
  role_display_name text,
  status text,
  username text,
  job_title_id uuid,
  job_title_name text,
  employment_status text,
  created_at timestamptz
)
language plpgsql stable security definer set search_path = public as $$
begin
  if not platform_operational_action_allowed(p_property_id, 'platform.team.manage') then
    raise exception 'insufficient_privilege' using errcode = '42501';
  end if;

  return query
    select
      m.id, m.profile_id, p.full_name, r.id, r.slug, r.display_name, m.status, m.username,
      d.job_title_id, jt.name, coalesce(d.employment_status, 'active'), m.created_at
    from memberships m
    join profiles p on p.id = m.profile_id
    join roles r on r.id = m.role_id
    left join property_staff_details d on d.property_id = m.property_id and d.profile_id = m.profile_id
    left join property_job_titles jt on jt.id = d.job_title_id
    where m.property_id = p_property_id
    order by p.full_name;
end;
$$;

revoke all on function platform_list_property_team(uuid) from public, anon;
grant execute on function platform_list_property_team(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- platform_insert_team_membership -- the membership/staff-details half of
-- "crea nuovo utente"; auth.users/profiles creation stays in the Edge
-- Function (service role -- SQL cannot create auth users). Mirrors
-- memberships_insert's shape (new role must be property-scoped) but
-- deliberately never calls role_assignment_allowed(): that function's rank
-- comparison exists to cap one staff member promoting another within the
-- ordinary hierarchy, which Admin Master was never part of -- the same
-- reasoning platform_operational_read_allowed already applies to reads,
-- applied here to the one write path this PR adds.
-- ---------------------------------------------------------------------------
create function platform_insert_team_membership(
  p_property_id uuid, p_profile_id uuid, p_role_id uuid, p_username text, p_job_title_id uuid default null
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_membership_id uuid;
  v_role_scope text;
begin
  if not platform_operational_action_allowed(p_property_id, 'platform.team.manage') then
    raise exception 'insufficient_privilege' using errcode = '42501';
  end if;

  select scope into v_role_scope from roles where id = p_role_id;
  if v_role_scope is distinct from 'property' then
    raise exception 'invalid_role' using errcode = '22023';
  end if;

  if p_job_title_id is not null and not exists (
    select 1 from property_job_titles where id = p_job_title_id and property_id = p_property_id and active
  ) then
    raise exception 'invalid_job_title' using errcode = '22023';
  end if;

  insert into memberships (profile_id, property_id, role_id, status, invited_by, username)
  values (p_profile_id, p_property_id, p_role_id, 'active', auth.uid(), p_username)
  returning id into v_membership_id;

  insert into property_staff_details (property_id, profile_id, job_title_id, created_by)
  values (p_property_id, p_profile_id, p_job_title_id, auth.uid());

  perform log_platform_action(
    'platform.team_member_created', 'membership', v_membership_id,
    jsonb_build_object('property_id', p_property_id, 'profile_id', p_profile_id, 'role_id', p_role_id)
  );

  return v_membership_id;
end;
$$;

revoke all on function platform_insert_team_membership(uuid, uuid, uuid, text, uuid) from public, anon;
grant execute on function platform_insert_team_membership(uuid, uuid, uuid, text, uuid) to authenticated;

commit;
