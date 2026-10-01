alter table public.shift_staff_profiles
  add column if not exists preferred_shift_codes text[] not null default '{}',
  add column if not exists weekday_shift_preferences jsonb not null default '{}'::jsonb;

comment on column public.shift_staff_profiles.preferred_shift_codes is 'Ordered general shift-code preferences used as a soft scheduling signal.';
comment on column public.shift_staff_profiles.weekday_shift_preferences is 'Ordered shift-code preferences by ISO weekday (1=Mon..7=Sun), overriding general preferences for that weekday.';

drop policy if exists shift_staff_profiles_update_own_preferences on public.shift_staff_profiles;
create policy shift_staff_profiles_update_own_preferences
on public.shift_staff_profiles for update to authenticated
using (owns_shift_staff_profile(property_id, id))
with check (owns_shift_staff_profile(property_id, id));
