-- Housekeeping queue control is a Reception capability, not a consequence of
-- the legacy staff_profiles.role. Bridged Core members intentionally carry
-- role='admin' for compatibility, so that legacy role must never authorize
-- front-desk actions.
begin;

-- Existing Reception job-title members inherit the compatibility sentinel
-- already used by Team > Moduli for Reception/full-queue access.
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

-- Non-Reception staff may perform the operational lifecycle only:
-- claim a requested job, complete an in-progress job and mark a delivered
-- trackable item returned. Routing, editing, cancellation/reopen,
-- priority/urgency and assignment remain Reception-only.
create or replace function guard_housekeeping_queue_control()
returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_operational_transition boolean;
begin
  if auth.role() <> 'authenticated' or current_staff_can_manage_housekeeping_queue() then
    return new;
  end if;

  v_operational_transition :=
    (
      old.status = 'requested'
      and new.status = 'in_progress'
      and old.accepted_by is null
      and new.accepted_by is not null
      and new.accepted_at is not null
      and old.completed_at is not distinct from new.completed_at
      and old.returned_at is not distinct from new.returned_at
    )
    or (
      old.status = 'in_progress'
      and new.status = 'completed'
      and old.accepted_by is not distinct from new.accepted_by
      and old.accepted_at is not distinct from new.accepted_at
      and new.completed_at is not null
      and old.returned_at is not distinct from new.returned_at
    )
    or (
      old.status = 'completed'
      and new.status = 'completed'
      and old.returned_at is null
      and new.returned_at is not null
      and old.accepted_by is not distinct from new.accepted_by
      and old.accepted_at is not distinct from new.accepted_at
      and old.completed_at is not distinct from new.completed_at
    );

  if old.priority is distinct from new.priority
     or old.urgent is distinct from new.urgent
     or old.assigned_job_title_ids is distinct from new.assigned_job_title_ids
     or old.assigned_department is distinct from new.assigned_department
     or old.room_number is distinct from new.room_number
     or old.quantity is distinct from new.quantity
     or old.note is distinct from new.note
     or old.request_type_id is distinct from new.request_type_id
     or old.archived_at is distinct from new.archived_at
     or not v_operational_transition
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

-- Deleting a request is never an operational action.
drop policy if exists guest_requests_delete_hotel on guest_requests;
create policy guest_requests_delete_hotel on guest_requests for delete to authenticated
  using (
    hotel_id = current_staff_hotel()
    and current_staff_can_manage_housekeeping_queue()
  );

commit;
