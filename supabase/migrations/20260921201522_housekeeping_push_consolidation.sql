-- Consolidate Housekeeping Web Push onto the Core device subscription
-- registry and make recipient selection match the post-Shell mansione model.
--
-- Legacy Housekeeping kept a second push_subscriptions table keyed to
-- staff_profiles.id. Team-bridged users are intentionally represented as
-- legacy staff_profiles.role='admin', so the old "only operatore can go on
-- duty" UI stopped ever populating that table. Core's
-- device_push_subscriptions is now the single browser/device registry.
--
-- This migration:
--   1. migrates any surviving legacy subscriptions to the Core registry;
--   2. adds one testable recipient resolver for new/urgent/priority push;
--   3. removes the duplicate dashboard-created INSERT webhook trigger,
--      leaving the versioned pg_net trigger as the single source of events.

begin;

insert into device_push_subscriptions (profile_id, endpoint, p256dh, auth, created_at)
select sp.auth_user_id, ps.endpoint, ps.p256dh, ps.auth, ps.created_at
from push_subscriptions ps
join staff_profiles sp on sp.id = ps.staff_id
on conflict (endpoint) do update
set profile_id = excluded.profile_id,
    p256dh = excluded.p256dh,
    auth = excluded.auth;

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
      coalesce(jt.sees_full_queue, false) as job_title_sees_full_queue,
      exists (
        select 1
        from memberships mem
        join roles r on r.id = mem.role_id
        join property_ctx pc2 on true
        where mem.profile_id = sp.auth_user_id
          and mem.status = 'active'
          and r.rank >= 30
          and (
            mem.property_id = pc2.property_id
            or mem.organization_id = pc2.organization_id
          )
      ) as core_admin_like
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
      c.core_admin_like
      or c.housekeeping_department = 'reception'::department
      or c.job_title_sees_full_queue
      or c.job_title_id = any(coalesce(p_assigned_job_title_ids, '{}'::uuid[]))
    );
$$;

revoke all on function housekeeping_push_recipient_profiles(uuid, uuid[], uuid) from public;
grant execute on function housekeeping_push_recipient_profiles(uuid, uuid[], uuid) to service_role;

-- Supabase Studio created this second trigger before the versioned pg_net
-- trigger was introduced. Both currently POST the same INSERT to the same
-- Edge Function, producing duplicate deliveries once a sender has recipients.
drop trigger if exists "notify-new-request" on guest_requests;

comment on function housekeeping_push_recipient_profiles(uuid, uuid[], uuid) is
  'Returns active, on-duty Housekeeping recipient profile ids for a request: Core property admins/org admins, per-member full-queue override, sees_full_queue job titles, or assigned mansioni. Optionally excludes the staff row that created the request.';

commit;
