drop policy if exists shift_staff_profiles_update_own_preferences on public.shift_staff_profiles;

create or replace function public.save_my_shift_preferences(
  p_staff_profile_id uuid,
  p_preferred_shift_codes text[],
  p_weekday_shift_preferences jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_property_id uuid;
begin
  select property_id into v_property_id
  from public.shift_staff_profiles
  where id = p_staff_profile_id;

  if v_property_id is null or not public.owns_shift_staff_profile(v_property_id, p_staff_profile_id) then
    raise exception 'not allowed';
  end if;

  if coalesce(jsonb_typeof(p_weekday_shift_preferences), 'object') <> 'object' then
    raise exception 'invalid weekday preferences';
  end if;

  update public.shift_staff_profiles
  set preferred_shift_codes = coalesce(p_preferred_shift_codes, '{}'::text[]),
      weekday_shift_preferences = coalesce(p_weekday_shift_preferences, '{}'::jsonb),
      updated_at = now()
  where id = p_staff_profile_id;
end
$$;

revoke all on function public.save_my_shift_preferences(uuid, text[], jsonb) from public, anon;
grant execute on function public.save_my_shift_preferences(uuid, text[], jsonb) to authenticated;
