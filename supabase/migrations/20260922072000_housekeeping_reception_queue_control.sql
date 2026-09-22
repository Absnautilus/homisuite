-- Housekeeping queue control is a Reception capability, not a consequence of
-- the legacy staff_profiles.role. Bridged Core members intentionally carry
-- role='admin' for compatibility, so using that role made porters look like
-- front-desk staff and exposed priority/urgency controls to them.
begin;

-- Existing Reception job-title members should have the same compatibility
-- sentinel already used by Team > Moduli for full-queue Reception access.
update property_staff_details psd
set housekeeping_department = 'reception'::department
from property_job_titles jt
where jt.id = psd.job_title_id
  and jt.property_id = psd.property_id
  and lower(trim(jt.name)) = 'reception'
  and psd.housekeeping_department is null;

create or replace function current_staff_can_manage_housekeeping_queue()
returns boolean
language sql security definer stable set search_path = public as $$
  select coalesce((
    select psd.housekeeping_department = 'reception'::department
    from staff_profiles sp
    join legacy_property_mapping m on m.legacy_hotel_id = sp.hotel_id
    join property_staff_details psd
      on psd.property_id = m.platform_property_id
     and psd.profile_id = sp.auth_user_id
    where sp.auth_user_id = auth.uid()
      and sp.active
    limit 1
  ), false);
$$;

revoke all on function current_staff_can_manage_housekeeping_queue() from public;
grant execute on function current_staff_can_manage_housekeeping_queue() to authenticated;

create or replace function guard_housekeeping_queue_control()
returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if auth.role() = 'authenticated'
     and (
       old.priority is distinct from new.priority
       or old.urgent is distinct from new.urgent
     )
     and not current_staff_can_manage_housekeeping_queue()
  then
    raise exception 'reception queue control required' using errcode = '42501';
  end if;
  return new;
end;
$$;

revoke all on function guard_housekeeping_queue_control() from public;

drop trigger if exists guest_requests_guard_queue_control on guest_requests;
create trigger guest_requests_guard_queue_control
  before update on guest_requests
  for each row execute function guard_housekeeping_queue_control();

commit;
