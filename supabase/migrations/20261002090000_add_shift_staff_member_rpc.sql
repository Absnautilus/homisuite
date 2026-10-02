create or replace function public.add_shift_staff_member(
  p_property_id uuid,
  p_profile_id uuid,
  p_planning_unit_id uuid,
  p_shift_type text default 'day'
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_staff_id uuid;
begin
  if not public.has_permission(p_property_id, 'shifts.manage') then
    raise exception 'insufficient_permission' using errcode = '42501';
  end if;
  if p_shift_type not in ('day', 'night', 'rotating', 'director', 'fom', 'custom') then
    raise exception 'invalid_shift_type' using errcode = '22023';
  end if;
  if not exists (
    select 1 from public.property_staff_details
    where property_id = p_property_id and profile_id = p_profile_id and employment_status = 'active'
  ) then
    raise exception 'not_an_active_team_member' using errcode = '22023';
  end if;
  if not exists (
    select 1 from public.shift_planning_units
    where property_id = p_property_id and id = p_planning_unit_id and status = 'active'
  ) then
    raise exception 'planning_unit_not_found' using errcode = 'P0002';
  end if;

  insert into public.shift_staff_profiles (property_id, profile_id, shift_type)
  values (p_property_id, p_profile_id, p_shift_type)
  on conflict (property_id, profile_id)
  do update set active = true, shift_type = excluded.shift_type, updated_at = now()
  returning id into v_staff_id;

  insert into public.shift_unit_members (property_id, planning_unit_id, staff_profile_id, inclusion_source)
  values (p_property_id, p_planning_unit_id, v_staff_id, 'explicit_include')
  on conflict (property_id, planning_unit_id, staff_profile_id)
  do update set active = true, inclusion_source = 'explicit_include', updated_at = now();

  return v_staff_id;
end;
$$;
revoke all on function public.add_shift_staff_member(uuid, uuid, uuid, text) from public;
grant execute on function public.add_shift_staff_member(uuid, uuid, uuid, text) to authenticated;
