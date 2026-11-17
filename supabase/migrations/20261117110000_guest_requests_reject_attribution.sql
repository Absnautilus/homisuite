-- A rejected-but-unclaimed request must stay visible where it was, with the
-- name of whoever rejected it, instead of silently moving to "Completate"
-- indistinguishable from a real completion. Modeled as a marker on top of
-- status='requested' (not a new status) so the existing pending/done bucket
-- split needs no change at all -- the row simply keeps rendering in the
-- same "Nuove" column it was already in.
begin;

alter table guest_requests add column rejected_by uuid references staff_profiles(id);
alter table guest_requests add column rejected_at timestamptz;

-- Extend the operational-transition guard: a non-Reception staff member
-- must never be able to set rejected_by/rejected_at themselves (rejecting
-- stays Reception-only, same as before), and must never be able to claim a
-- row that Reception already rejected, even though it's still technically
-- status='requested'.
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
      and old.rejected_at is null
      and new.status = 'in_progress'
      and (old.accepted_by is null or old.accepted_by is not distinct from new.accepted_by)
      and (new.accepted_by is not null or old.accepted_by is null)
      and (new.accepted_at is not null or old.accepted_at is not distinct from new.accepted_at)
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
     or old.rejected_by is distinct from new.rejected_by
     or old.rejected_at is distinct from new.rejected_at
     or not v_operational_transition
  then
    raise exception 'reception queue control required' using errcode = '42501';
  end if;

  return new;
end;
$$;

commit;
