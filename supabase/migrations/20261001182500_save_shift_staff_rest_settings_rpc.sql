create or replace function public.save_shift_staff_rest_settings(
  p_property_id uuid,
  p_staff_profile_id uuid,
  p_rest_mode text,
  p_fixed_rest_days integer[] default '{}'::integer[]
) returns public.shift_staff_profiles
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.shift_staff_profiles;
begin
  if not public.has_permission(p_property_id, 'shifts.manage') then
    raise exception 'insufficient_permission' using errcode = '42501';
  end if;
  if p_rest_mode not in ('fixed','rotating') then
    raise exception 'invalid_rest_mode' using errcode = '22023';
  end if;
  if p_rest_mode = 'fixed' and (cardinality(p_fixed_rest_days) = 0 or exists (select 1 from unnest(p_fixed_rest_days) d where d < 0 or d > 6)) then
    raise exception 'invalid_fixed_rest_days' using errcode = '22023';
  end if;
  update public.shift_staff_profiles
     set rest_mode = p_rest_mode,
         fixed_rest_days = case when p_rest_mode = 'fixed' then p_fixed_rest_days else '{}'::integer[] end,
         updated_at = now()
   where property_id = p_property_id and id = p_staff_profile_id
   returning * into v_row;
  if v_row.id is null then
    raise exception 'shift_staff_profile_not_found' using errcode = 'P0002';
  end if;
  return v_row;
end;
$$;
revoke all on function public.save_shift_staff_rest_settings(uuid,uuid,text,integer[]) from public;
grant execute on function public.save_shift_staff_rest_settings(uuid,uuid,text,integer[]) to authenticated;
