-- Two new module-scoped permissions for Housekeeping (guest_requests), the
-- "Amministrazione Housekeeping" and "Visualizza tutte le richieste"
-- toggles the Team page's per-member permission UI needs -- neither
-- existed as a real `permissions` row before this (0009_bootstrap_reference_data
-- explicitly deferred guest_requests.manage; docs/module-integration.md
-- already names it as the planned slug). Both qualify for delegation via
-- grant_member_permission/revoke_member_permission automatically: they are
-- module-scoped (module_id not null) and not core.*, the only two
-- conditions that function checks.
--
-- guest_requests.manage closes a real gap, not just a UI nicety:
-- request_categories_admin_write / request_types_admin_write /
-- request_category_job_titles_admin_write all currently check
-- current_staff_role() = 'admin' (a legacy staff_profiles.role value) --
-- but grant-housekeeping-access (the edge function that bridges a Core
-- membership into staff_profiles) hardcodes role: 'admin' for EVERY
-- member it bridges in, regardless of their real Homisuite role. That
-- check has been a no-op in practice: anyone with Housekeeping access at
-- all can already write to these tables today, with nothing in Postgres
-- actually distinguishing "admin" from anyone else. These three policies
-- are switched to has_permission(..., 'guest_requests.manage') instead,
-- which is both a real, delegable Core permission and -- since
-- has_permission already honors membership_module_access -- correctly
-- blocked if this member's Housekeeping module access is individually
-- disabled, even if they somehow still held the permission.
--
-- guest_requests.view_all is intentionally narrower than the existing
-- housekeeping_department = 'reception' field it sits alongside: that
-- field today also drives queue-management/delete rights
-- (current_staff_can_manage_housekeeping_queue) and front-desk/stays
-- visibility (current_staff_department), not just queue visibility. This
-- permission is wired ONLY into the two visibility-only consumers
-- (current_staff_sees_full_queue, housekeeping_push_recipient_profiles),
-- left as a parallel OR-branch -- the existing field and its other three
-- consumers are completely untouched, so nothing for any existing member
-- changes. The Team page's "Visualizza tutte le richieste" toggle moves to
-- driving this permission instead of writing the field directly (Fase C);
-- a member who already has the field set to 'reception' keeps exactly the
-- visibility (and queue-management/stays) they already had, unaffected by
-- this migration.
begin;

insert into permissions (slug, module_id)
select 'guest_requests.manage', id from modules where slug = 'guest_requests';
insert into permissions (slug, module_id)
select 'guest_requests.view_all', id from modules where slug = 'guest_requests';

-- guest_requests.manage: same default-holder pattern as dining.manage /
-- guest_requests.pms.manage -- property_admin and organization_admin hold
-- it by role, by default. Zero behavior change for existing structural
-- admins managing Housekeeping, who already had equivalent capability via
-- the core.staff.manage-gated client-side check this migration's RLS
-- changes replace.
insert into role_permissions (role_id, permission_id)
select r.id, p.id
from roles r
join permissions p on p.slug = 'guest_requests.manage'
where r.slug in ('property_admin', 'organization_admin');

-- guest_requests.view_all deliberately gets NO default role holder, unlike
-- guest_requests.manage above. 20260922080000_housekeeping_push_recipients_visibility_realignment
-- explicitly removed "any Core property/org admin bypasses the mansione
-- filter" as a full-queue-visibility and push-eligibility rule -- giving
-- property_admin/organization_admin this permission by role would silently
-- reintroduce that exact bypass through a different mechanism. Full-queue
-- visibility stays what it already was: an explicit per-member action (the
-- legacy housekeeping_department field, or now this permission), never
-- automatic by rank.

-- ---------------------------------------------------------------------------
-- request_categories / request_types / request_category_job_titles --
-- admin-write policies switched from the no-op legacy role check to the
-- real, delegable permission.
-- ---------------------------------------------------------------------------
drop policy request_categories_admin_write on request_categories;
create policy request_categories_admin_write on request_categories for all to authenticated
  using (hotel_id = current_staff_hotel() and has_permission(guest_requests_property_for_hotel(hotel_id), 'guest_requests.manage'))
  with check (hotel_id = current_staff_hotel() and has_permission(guest_requests_property_for_hotel(hotel_id), 'guest_requests.manage'));

drop policy request_types_admin_write on request_types;
create policy request_types_admin_write on request_types for all to authenticated
  using (
    exists (
      select 1 from request_categories rc
      where rc.id = category_id
        and rc.hotel_id = current_staff_hotel()
        and has_permission(guest_requests_property_for_hotel(rc.hotel_id), 'guest_requests.manage')
    )
  )
  with check (
    exists (
      select 1 from request_categories rc
      where rc.id = category_id
        and rc.hotel_id = current_staff_hotel()
        and has_permission(guest_requests_property_for_hotel(rc.hotel_id), 'guest_requests.manage')
    )
  );

drop policy request_category_job_titles_admin_write on request_category_job_titles;
create policy request_category_job_titles_admin_write on request_category_job_titles for all to authenticated
  using (
    exists (
      select 1 from request_categories rc
      where rc.id = category_id
        and rc.hotel_id = current_staff_hotel()
        and has_permission(guest_requests_property_for_hotel(rc.hotel_id), 'guest_requests.manage')
    )
  )
  with check (
    exists (
      select 1 from request_categories rc
      where rc.id = category_id
        and rc.hotel_id = current_staff_hotel()
        and has_permission(guest_requests_property_for_hotel(rc.hotel_id), 'guest_requests.manage')
    )
  );

-- ---------------------------------------------------------------------------
-- current_staff_sees_full_queue -- OR in guest_requests.view_all alongside
-- the existing reception-department/sees_full_queue checks, purely
-- additive.
-- ---------------------------------------------------------------------------
create or replace function current_staff_sees_full_queue() returns boolean
language sql security definer stable set search_path = public as $$
  select
    coalesce((
      select psd.housekeeping_department = 'reception'::department
      from staff_profiles sp
      join legacy_property_mapping m
        on m.legacy_hotel_id = sp.hotel_id
      left join property_staff_details psd
        on psd.property_id = m.platform_property_id
       and psd.profile_id = sp.auth_user_id
      where sp.auth_user_id = auth.uid()
        and sp.active
      limit 1
    ), false)
    or coalesce(
      (select jt.sees_full_queue
       from property_job_titles jt
       where jt.id = current_staff_job_title_id()),
      false
    )
    or coalesce((
      select has_permission(m.platform_property_id, 'guest_requests.view_all')
      from staff_profiles sp
      join legacy_property_mapping m
        on m.legacy_hotel_id = sp.hotel_id
      where sp.auth_user_id = auth.uid()
        and sp.active
      limit 1
    ), false);
$$;

-- ---------------------------------------------------------------------------
-- housekeeping_push_recipient_profiles -- same OR-branch, using
-- profile_has_permission since this evaluates OTHER users' permissions
-- (candidate recipients), not the calling session's own.
-- ---------------------------------------------------------------------------
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
      (select property_id from property_ctx) as property_id
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
      or coalesce(profile_has_permission(c.profile_id, c.property_id, 'guest_requests.view_all'), false)
    );
$$;

revoke all on function housekeeping_push_recipient_profiles(uuid, uuid[], uuid) from public;
grant execute on function housekeeping_push_recipient_profiles(uuid, uuid[], uuid) to service_role;

comment on function housekeeping_push_recipient_profiles(uuid, uuid[], uuid) is
  'Returns active, on-duty Housekeeping recipient profile ids for a request: per-member full-queue override (reception field), sees_full_queue job titles, assigned mansioni, or the guest_requests.view_all permission (role or individual override). A Core admin/org-admin membership alone does not qualify on its own. Optionally excludes the staff row that created the request.';

commit;
