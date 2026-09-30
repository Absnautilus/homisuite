alter table public.shift_preassignments
  add column status text not null default 'pending'
    check (status in ('pending','approved','rejected','cancelled')),
  add column decided_by uuid references public.profiles(id) on delete set null,
  add column decided_at timestamptz;

drop policy if exists shift_preassignments_insert on public.shift_preassignments;
create policy shift_preassignments_insert
on public.shift_preassignments for insert to authenticated
with check (
  (owns_active_shift_unit_membership(property_id, planning_unit_id, staff_profile_id) and status = 'pending')
  or has_permission(property_id, 'shifts.manage')
);

drop policy if exists shift_preassignments_select on public.shift_preassignments;
create policy shift_preassignments_select
on public.shift_preassignments for select to authenticated
using (
  owns_shift_staff_profile(property_id, staff_profile_id)
  or has_permission(property_id, 'shifts.manage')
  or has_permission(property_id, 'shifts.requests.manage')
);

drop policy if exists shift_preassignments_update on public.shift_preassignments;
create policy shift_preassignments_update
on public.shift_preassignments for update to authenticated
using (
  has_permission(property_id, 'shifts.manage')
  or has_permission(property_id, 'shifts.requests.manage')
)
with check (
  has_permission(property_id, 'shifts.manage')
  or has_permission(property_id, 'shifts.requests.manage')
);
