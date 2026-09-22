-- 20260922072000_housekeeping_reception_queue_control.sql and the
-- current_staff_sees_full_queue()/RLS model it builds on
-- (20260921181124_housekeeping_member_full_queue_override.sql) already
-- dropped "any Core property/org admin bypasses the mansione filter" as a
-- visibility rule: guest_requests_select_hotel now only grants full
-- visibility via current_staff_sees_full_queue() (the reception override or
-- a sees_full_queue mansione) or an assigned-mansione match. See
-- 026_guest_requests_cross_tenant_department.test.sql's own updated
-- expectation: "property_admin without an operational mansione does not
-- bypass the queue filter" (0 rows, not 3).
--
-- housekeeping_push_recipient_profiles() was never updated to match: its
-- core_admin_like branch (any active membership with rank >= 30, scoped to
-- the property or the org) still independently qualifies a Core admin for
-- new/urgent/priority push regardless of whether they have any operational
-- Housekeeping visibility at all. That is the exact bypass the queue-control
-- migration just closed for reads and writes -- realign the push resolver
-- to the same rule: a recipient needs actual operational visibility
-- (reception override, sees_full_queue mansione, or an assigned mansione
-- match), not Core administrative rank on its own.

begin;

create or replace function housekeeping_push_recipient_profiles(
  p_hotel_id uuid,
  p_assigned_job_title_ids uuid[] default '{}'::uuid[],
  p_exclude_staff_id uuid default null
)
returns table(profile_id uuid)
language sql
security definer
stable
set search_path = public
as $$
  with property_ctx as (
    select m.platform_property_id as property_id, p.organization_id
    from legacy_property_mapping m
    join properties p on p.id = m.platform_property_id
    where m.legacy_hotel_id = p_hotel_id
    limit 1
  ),
  candidates as (
    select
      sp.id as staff_id,
      sp.auth_user_id as profile_id,
      psd.job_title_id,
      psd.housekeeping_department,
      psd.employment_status,
      coalesce(jt.sees_full_queue, false) as job_title_sees_full_queue
    from staff_profiles sp
    join property_ctx pc on true
    left join property_staff_details psd
      on psd.property_id = pc.property_id
     and psd.profile_id = sp.auth_user_id
    left join property_job_titles jt
      on jt.id = psd.job_title_id
     and jt.property_id = pc.property_id
     and jt.active
    where sp.hotel_id = p_hotel_id
      and sp.active
      and sp.on_duty
      and (p_exclude_staff_id is null or sp.id <> p_exclude_staff_id)
  )
  select distinct c.profile_id
  from candidates c
  where (c.employment_status is null or c.employment_status = 'active')
    and (
      c.housekeeping_department = 'reception'::department
      or c.job_title_sees_full_queue
      or c.job_title_id = any(coalesce(p_assigned_job_title_ids, '{}'::uuid[]))
    );
$$;

revoke all on function housekeeping_push_recipient_profiles(uuid, uuid[], uuid) from public;
grant execute on function housekeeping_push_recipient_profiles(uuid, uuid[], uuid) to service_role;

comment on function housekeeping_push_recipient_profiles(uuid, uuid[], uuid) is
  'Returns active, on-duty Housekeeping recipient profile ids for a request: per-member full-queue override (reception), sees_full_queue job titles, or assigned mansioni. A Core admin/org-admin membership alone no longer qualifies -- see current_staff_sees_full_queue(), which the read/write RLS model already restricts the same way. Optionally excludes the staff row that created the request.';

commit;
