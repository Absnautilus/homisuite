-- Platform Admin "visualizza come" with real writes -- Fase C follow-up
-- (Part 2, first slice). Explicitly authorized, after careful, repeated
-- clarification: Admin Master must be able to view a module exactly as a
-- specific real staff member would, AND have writes performed in that view
-- actually execute -- never just show a faithful but inert mirror. The one
-- non-negotiable constraint, confirmed last: every such write is
-- attributed to ADMIN MASTER HERSELF in the audit trail, with the
-- functional authority of the viewed-as person's role, never indistin-
-- guishable from that person's own genuine action. This migration adds the
-- schema + the single narrowest write that proves the mechanism end to
-- end; more modules/transitions are deliberately follow-up PRs, the same
-- incremental discipline PR C2's module-by-module read rollout used.
--
-- Why Housekeeping's "complete an in-progress request" is the first write:
-- guest_requests' own write path (supabase/migrations/
-- 20260922072000_housekeeping_reception_queue_control.sql) is a raw RLS
-- UPDATE policy plus a BEFORE UPDATE trigger, not an RPC -- and every
-- helper it depends on (current_staff_hotel, current_staff_sees_full_queue,
-- current_staff_job_title_id, current_staff_can_manage_housekeeping_queue)
-- resolves through auth.uid(), which is and must stay Admin Master's own
-- identity. She can never satisfy that RLS path directly, no matter what
-- she's permitted to do -- so this is a brand-new SECURITY DEFINER RPC,
-- not an extension of the existing policy/trigger (neither is touched).
-- completed_at carries no actor reference at all (unlike accepted_by,
-- which a future "claim" increment would have to reason about separately,
-- since it's operationally visible to the real team as "who's on this
-- job") -- that makes this transition the cleanest place to prove
-- attribution never leaks into business-visible columns before extending
-- to any transition that writes an identity column.
--
-- acting_as_membership_id is nullable and sits on the SAME
-- platform_operational_sessions row every operational read already uses --
-- a plain session (opened via platform_open_operational_session) leaves it
-- null; "viewing as" a specific person opens one with it set, through a
-- SEPARATE, more sensitive permission (platform.impersonation.write) via a
-- new function, never by changing platform_open_operational_session's
-- existing signature or behavior.

begin;

insert into platform_permissions (slug) values ('platform.impersonation.write');

alter table platform_operational_sessions
  add column acting_as_membership_id uuid references memberships(id) on delete set null;

-- ---------------------------------------------------------------------------
-- platform_open_impersonation_session -- a new, separately-permissioned
-- sibling of platform_open_operational_session. Same table, same "at most
-- one active session per admin" invariant (opening one auto-closes any
-- other active session for this admin, plain or impersonated), same fixed
-- 60-minute duration. platform_open_operational_session itself is
-- untouched -- opening a plain operational view never requires or implies
-- platform.impersonation.write.
-- ---------------------------------------------------------------------------
create function platform_open_impersonation_session(
  p_property_id uuid, p_acting_as_membership_id uuid, p_reason text default null
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_admin_id uuid;
  v_session_id uuid;
begin
  if not is_platform_admin() then
    raise exception 'not_platform_admin' using errcode = '42501';
  end if;

  if not platform_has_permission('platform.impersonation.write') then
    raise exception 'insufficient_privilege' using errcode = '42501';
  end if;

  if not platform_mfa_satisfied() then
    raise exception 'mfa_required' using errcode = '42501';
  end if;

  if not exists (select 1 from properties where id = p_property_id) then
    raise exception 'property_not_found' using errcode = '22023';
  end if;

  if not exists (
    select 1 from memberships
    where id = p_acting_as_membership_id and property_id = p_property_id and status = 'active'
  ) then
    raise exception 'invalid_acting_as_membership' using errcode = '22023';
  end if;

  select id into v_admin_id from platform_admins where profile_id = auth.uid() and status = 'active';

  update platform_operational_sessions
     set status = 'closed', closed_at = now(), closed_by = auth.uid()
   where platform_admin_id = v_admin_id
     and status = 'active';

  insert into platform_operational_sessions (platform_admin_id, property_id, reason, expires_at, acting_as_membership_id)
  values (v_admin_id, p_property_id, p_reason, now() + interval '60 minutes', p_acting_as_membership_id)
  returning id into v_session_id;

  perform log_platform_action(
    'platform.impersonation_session_opened', 'property', p_property_id,
    jsonb_build_object('session_id', v_session_id, 'acting_as_membership_id', p_acting_as_membership_id, 'reason', p_reason)
  );

  return v_session_id;
end;
$$;

revoke all on function platform_open_impersonation_session(uuid, uuid, text) from public, anon;
grant execute on function platform_open_impersonation_session(uuid, uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- platform_impersonated_action_allowed -- the write-side analogue of
-- platform_operational_read_allowed/platform_operational_action_allowed:
-- same four-fact shape, with a fifth fact these never needed -- the active
-- session's acting_as_membership_id must match the one being invoked
-- against, so a session opened to view-as one person can never be reused
-- to act as another.
-- ---------------------------------------------------------------------------
create function platform_impersonated_action_allowed(p_property_id uuid, p_acting_as_membership_id uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select
    is_platform_admin()
    and platform_has_permission('platform.impersonation.write')
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
        and s.acting_as_membership_id = p_acting_as_membership_id
    );
$$;

revoke all on function platform_impersonated_action_allowed(uuid, uuid) from public, anon;
grant execute on function platform_impersonated_action_allowed(uuid, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- profile_job_title_id_for_hotel / profile_sees_full_housekeeping_queue /
-- profile_can_manage_housekeeping_queue -- profile-parameterized siblings
-- of current_staff_job_title_id/current_staff_sees_full_queue/
-- current_staff_can_manage_housekeeping_queue, mirroring their exact
-- current logic (as of 20261014090000's sees_full_queue redefinition) but
-- keyed on an explicit profile_id instead of auth.uid(), so the write RPC
-- below can re-derive the ACTING-AS person's own authority, never Admin
-- Master's. None of the three existing auth.uid()-based functions are
-- modified. Deliberately scoped to Core-bridged members only (the "legacy
-- role in ('admin','master')" fallback branch current_staff_can_manage_
-- housekeeping_queue() still has for pre-Core staff_profiles rows is not
-- replicated here -- every impersonation target is a Core membership by
-- construction, see platform_insert_team_membership).
-- ---------------------------------------------------------------------------
create function profile_job_title_id_for_hotel(p_profile_id uuid, p_hotel_id uuid) returns uuid
language sql stable security definer set search_path = public as $$
  select psd.job_title_id
  from legacy_property_mapping m
  left join property_staff_details psd on psd.property_id = m.platform_property_id and psd.profile_id = p_profile_id
  where m.legacy_hotel_id = p_hotel_id
  limit 1;
$$;

create function profile_sees_full_housekeeping_queue(p_profile_id uuid, p_hotel_id uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select
    coalesce((
      select psd.housekeeping_department = 'reception'::department
      from legacy_property_mapping m
      left join property_staff_details psd on psd.property_id = m.platform_property_id and psd.profile_id = p_profile_id
      where m.legacy_hotel_id = p_hotel_id
      limit 1
    ), false)
    or coalesce((
      select jt.sees_full_queue
      from property_job_titles jt
      where jt.id = profile_job_title_id_for_hotel(p_profile_id, p_hotel_id)
    ), false)
    or coalesce((
      select profile_has_permission(p_profile_id, m.platform_property_id, 'guest_requests.view_all')
      from legacy_property_mapping m
      where m.legacy_hotel_id = p_hotel_id
    ), false);
$$;

create function profile_can_manage_housekeeping_queue(p_profile_id uuid, p_hotel_id uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((
    select psd.housekeeping_department = 'reception'::department
    from legacy_property_mapping m
    left join property_staff_details psd on psd.property_id = m.platform_property_id and psd.profile_id = p_profile_id
    where m.legacy_hotel_id = p_hotel_id
    limit 1
  ), false);
$$;

revoke all on function profile_job_title_id_for_hotel(uuid, uuid) from public, anon;
revoke all on function profile_sees_full_housekeeping_queue(uuid, uuid) from public, anon;
revoke all on function profile_can_manage_housekeeping_queue(uuid, uuid) from public, anon;
grant execute on function profile_job_title_id_for_hotel(uuid, uuid) to authenticated;
grant execute on function profile_sees_full_housekeeping_queue(uuid, uuid) to authenticated;
grant execute on function profile_can_manage_housekeeping_queue(uuid, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- platform_impersonated_complete_guest_request -- the one write this PR
-- adds. Mirrors guard_housekeeping_queue_control()'s own
-- in_progress->completed branch exactly (status + completed_at only,
-- nothing else), re-derived for the acting-as person instead of auth.uid().
-- ---------------------------------------------------------------------------
create function platform_impersonated_complete_guest_request(
  p_guest_request_id uuid, p_acting_as_membership_id uuid
) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_hotel_id uuid;
  v_status request_status;
  v_assigned_job_title_ids uuid[];
  v_property_id uuid;
  v_target_profile_id uuid;
begin
  select gr.hotel_id, gr.status, gr.assigned_job_title_ids
    into v_hotel_id, v_status, v_assigned_job_title_ids
  from guest_requests gr where gr.id = p_guest_request_id;
  if v_hotel_id is null then
    raise exception 'guest_request_not_found' using errcode = '22023';
  end if;

  v_property_id := guest_requests_property_for_hotel(v_hotel_id);
  if v_property_id is null then
    raise exception 'property_not_mapped' using errcode = '22023';
  end if;

  if not platform_impersonated_action_allowed(v_property_id, p_acting_as_membership_id) then
    raise exception 'insufficient_privilege' using errcode = '42501';
  end if;

  select m.profile_id into v_target_profile_id
  from memberships m
  where m.id = p_acting_as_membership_id and m.property_id = v_property_id and m.status = 'active';
  if v_target_profile_id is null then
    raise exception 'invalid_acting_as_membership' using errcode = '22023';
  end if;

  if not exists (
    select 1 from staff_profiles sp
    where sp.auth_user_id = v_target_profile_id and sp.hotel_id = v_hotel_id and sp.active
  ) then
    raise exception 'acting_as_has_no_housekeeping_access' using errcode = '42501';
  end if;

  if v_status is distinct from 'in_progress' then
    raise exception 'invalid_transition' using errcode = '22023';
  end if;

  if not (
    profile_can_manage_housekeeping_queue(v_target_profile_id, v_hotel_id)
    or profile_sees_full_housekeeping_queue(v_target_profile_id, v_hotel_id)
    or profile_job_title_id_for_hotel(v_target_profile_id, v_hotel_id) = any(v_assigned_job_title_ids)
  ) then
    raise exception 'acting_as_cannot_view_this_request' using errcode = '42501';
  end if;

  update guest_requests set status = 'completed', completed_at = now()
  where id = p_guest_request_id and status = 'in_progress';
  if not found then
    raise exception 'invalid_transition' using errcode = '22023';
  end if;

  perform log_platform_action(
    'platform.impersonated_guest_request_completed', 'guest_request', p_guest_request_id,
    jsonb_build_object(
      'property_id', v_property_id,
      'acting_as_membership_id', p_acting_as_membership_id,
      'acting_as_profile_id', v_target_profile_id
    )
  );
end;
$$;

revoke all on function platform_impersonated_complete_guest_request(uuid, uuid) from public, anon;
grant execute on function platform_impersonated_complete_guest_request(uuid, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- platform_my_operational_session -- widened to surface acting_as_*, so the
-- console can render "stai visualizzando come <nome>" and route writes to
-- the impersonated RPCs. Adding a column to a `returns table(...)` function
-- is a return-type change, which CREATE OR REPLACE cannot do in place --
-- dropped and recreated instead. Nothing else references this function by
-- a hard dependency (PostgREST calls it by name only), so this is safe;
-- every existing column keeps its name, order, and meaning unchanged.
-- ---------------------------------------------------------------------------
drop function platform_my_operational_session();

create function platform_my_operational_session() returns table(
  id uuid,
  property_id uuid,
  status text,
  reason text,
  opened_at timestamptz,
  expires_at timestamptz,
  acting_as_membership_id uuid,
  acting_as_full_name text
)
language plpgsql security definer set search_path = public as $$
declare
  v_admin_id uuid;
begin
  select pa.id into v_admin_id from platform_admins pa where pa.profile_id = auth.uid() and pa.status = 'active';

  if v_admin_id is null then
    return;
  end if;

  update platform_operational_sessions s
     set status = 'expired'
   where s.platform_admin_id = v_admin_id
     and s.status = 'active'
     and s.expires_at <= now();

  return query
    select s.id, s.property_id, s.status, s.reason, s.opened_at, s.expires_at,
           s.acting_as_membership_id, p.full_name
    from platform_operational_sessions s
    left join memberships m on m.id = s.acting_as_membership_id
    left join profiles p on p.id = m.profile_id
    where s.platform_admin_id = v_admin_id
      and s.status = 'active'
    order by s.opened_at desc
    limit 1;
end;
$$;

revoke all on function platform_my_operational_session() from public, anon;
grant execute on function platform_my_operational_session() to authenticated;

commit;
