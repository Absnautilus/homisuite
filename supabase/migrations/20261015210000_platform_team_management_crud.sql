-- Platform Admin team management -- edit, archive, reset password (Fase C
-- follow-up). PR C5 shipped create + list only; this adds the rest of
-- "gestione utenti" the product owner asked for after reviewing the
-- console mockup: per-member edit (role/job title/employment status),
-- archive, and an admin-triggered password reset for credentials-based
-- accounts -- parity with the ordinary Team page's own
-- updateTeamMember/archiveTeamMember/resetTeamMemberPassword, reached
-- through the same platform_operational_action_allowed gate as every other
-- Platform Admin write since PR C5. Mirrors assign_membership_role() and
-- archive_team_member()'s own rules (role must stay property-scoped,
-- archived memberships move to status 'suspended') without calling either
-- function directly -- both are gated on has_permission(...,
-- 'core.staff.manage')/role_assignment_allowed(), which Admin Master never
-- holds and must never be given. No existing function or RLS policy is
-- modified by this migration.

begin;

-- ---------------------------------------------------------------------------
-- platform_update_team_membership -- role, job title, employment status and
-- membership status (active/suspended), each independently optional so the
-- console can send only what actually changed.
-- ---------------------------------------------------------------------------
create function platform_update_team_membership(
  p_membership_id uuid,
  p_role_id uuid default null,
  p_job_title_id uuid default null,
  p_employment_status text default null,
  p_membership_status text default null
) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_property_id uuid;
  v_profile_id uuid;
  v_role_scope text;
begin
  select property_id, profile_id into v_property_id, v_profile_id
  from memberships where id = p_membership_id;
  if v_property_id is null then
    raise exception 'membership_not_found' using errcode = '02000';
  end if;

  if not platform_operational_action_allowed(v_property_id, 'platform.team.manage') then
    raise exception 'insufficient_privilege' using errcode = '42501';
  end if;

  if p_role_id is not null then
    select scope into v_role_scope from roles where id = p_role_id;
    if v_role_scope is distinct from 'property' then
      raise exception 'invalid_role' using errcode = '22023';
    end if;
    update memberships set role_id = p_role_id where id = p_membership_id;
  end if;

  if p_membership_status is not null then
    if p_membership_status not in ('active', 'suspended') then
      raise exception 'invalid_status' using errcode = '22023';
    end if;
    update memberships set status = p_membership_status where id = p_membership_id;
  end if;

  if p_job_title_id is not null and not exists (
    select 1 from property_job_titles where id = p_job_title_id and property_id = v_property_id and active
  ) then
    raise exception 'invalid_job_title' using errcode = '22023';
  end if;

  if p_job_title_id is not null or p_employment_status is not null then
    insert into property_staff_details (property_id, profile_id, job_title_id, employment_status, created_by)
    values (v_property_id, v_profile_id, p_job_title_id, coalesce(p_employment_status, 'active'), auth.uid())
    on conflict (property_id, profile_id) do update
      set job_title_id = coalesce(p_job_title_id, property_staff_details.job_title_id),
          employment_status = coalesce(p_employment_status, property_staff_details.employment_status);
  end if;

  perform log_platform_action(
    'platform.team_member_updated', 'membership', p_membership_id,
    jsonb_build_object(
      'property_id', v_property_id, 'role_id', p_role_id, 'job_title_id', p_job_title_id,
      'employment_status', p_employment_status, 'membership_status', p_membership_status
    )
  );
end;
$$;

revoke all on function platform_update_team_membership(uuid, uuid, uuid, text, text) from public, anon;
grant execute on function platform_update_team_membership(uuid, uuid, uuid, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- platform_archive_team_member -- mirrors archive_team_member()'s own
-- effect (archived_at stamped, status moves to 'suspended', row and every
-- reference to it survive) through the platform gate instead of
-- has_permission(..., 'core.staff.manage').
-- ---------------------------------------------------------------------------
create function platform_archive_team_member(p_membership_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_property_id uuid;
begin
  select property_id into v_property_id from memberships where id = p_membership_id;
  if v_property_id is null then
    raise exception 'membership_not_found' using errcode = '02000';
  end if;

  if not platform_operational_action_allowed(v_property_id, 'platform.team.manage') then
    raise exception 'insufficient_privilege' using errcode = '42501';
  end if;

  update memberships set archived_at = now(), status = 'suspended' where id = p_membership_id;

  perform log_platform_action(
    'platform.team_member_archived', 'membership', p_membership_id,
    jsonb_build_object('property_id', v_property_id)
  );
end;
$$;

revoke all on function platform_archive_team_member(uuid) from public, anon;
grant execute on function platform_archive_team_member(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- platform_reset_team_member_password -- the authorize-and-audit half of
-- the password reset; the Edge Function (platform-reset-team-member-
-- password) calls this first as the caller, then sets the new password
-- itself via the Admin API using the profile_id this returns -- the same
-- caller-RPC-then-service-role-step split platform-create-team-member
-- already uses. Scoped to credentials-based accounts only (username not
-- null), same as the tenant version.
-- ---------------------------------------------------------------------------
create function platform_reset_team_member_password(p_membership_id uuid) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_property_id uuid;
  v_profile_id uuid;
  v_username text;
begin
  select property_id, profile_id, username into v_property_id, v_profile_id, v_username
  from memberships where id = p_membership_id;
  if v_property_id is null then
    raise exception 'membership_not_found' using errcode = '02000';
  end if;
  if v_username is null then
    raise exception 'not_a_credentials_account' using errcode = '22023';
  end if;

  if not platform_operational_action_allowed(v_property_id, 'platform.team.manage') then
    raise exception 'insufficient_privilege' using errcode = '42501';
  end if;

  perform log_platform_action(
    'platform.team_member_password_reset', 'membership', p_membership_id,
    jsonb_build_object('property_id', v_property_id)
  );

  return v_profile_id;
end;
$$;

revoke all on function platform_reset_team_member_password(uuid) from public, anon;
grant execute on function platform_reset_team_member_password(uuid) to authenticated;

commit;
