-- Housekeeping request routing is mansione-based since
-- 20260917120000_request_categories_job_titles.sql. The Team > Moduli UI
-- still had a legacy department picker, though, and its "reception" value
-- no longer affected guest_requests visibility at all.
--
-- Keep the existing Core-side housekeeping_department column only as a
-- compatibility sentinel for the one per-member override the UI still
-- needs: reception means "this member may see the whole Housekeeping
-- request queue". null means normal mansione-scoped visibility. The old
-- department choices are no longer exposed.
--
-- Job-title-level sees_full_queue remains supported and combines with the
-- per-member override, so existing configuration keeps working.

begin;

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
    );
$$;

revoke all on function current_staff_sees_full_queue() from public;
grant execute on function current_staff_sees_full_queue() to authenticated;

commit;
