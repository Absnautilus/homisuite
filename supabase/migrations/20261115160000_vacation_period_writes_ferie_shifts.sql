-- "Piano Ferie" <-> Turni: an approved vacation period now writes ferie (F)
-- shifts into the employee's planning unit(s) for the period's date range,
-- instead of only existing as a separate record nobody reads from the
-- grid. A day in the range that's already a rest day (R) is left alone --
-- vacation is conventionally planned rest-to-rest, so the R at either end
-- of the period is expected, not a conflict. A day that already holds
-- something else (a real/manual shift, another leave code, a locked
-- cell...) is never overwritten: it's reported back as a conflict for the
-- manager to resolve by hand, matching how "Assegna automaticamente"
-- itself never touches anything it didn't generate.
--
-- Shifts written this way are tagged with vacation_period_id so they can
-- be retracted precisely if the period's dates change or it gets
-- rejected after being confirmed -- never by source/kind alone, which
-- would risk sweeping up an unrelated real F entered the same way.

alter table public.shifts
  add column vacation_period_id uuid references public.shift_vacation_periods(id) on delete set null;
create index shifts_vacation_period_idx on public.shifts (vacation_period_id) where vacation_period_id is not null;

-- Re-requesting a period (new dates, or after being rejected) retracts
-- whatever ferie shifts the previous confirmation wrote for it -- they
-- described the old range, and the period goes back to 'pending' either
-- way, awaiting a fresh decision against the new one. Only the engine's
-- own writes for this period are removed (source = 'automatic'); a cell
-- someone has since edited by hand no longer carries that source and is
-- left alone.
create or replace function public.request_vacation_period(
  p_property_id uuid,
  p_staff_profile_id uuid,
  p_period_index smallint,
  p_start date,
  p_end date
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_is_self boolean;
  v_settings public.shift_vacation_settings;
  v_days int;
  v_conflict_name text;
  v_id uuid;
  v_existing_id uuid;
begin
  if not public.has_permission(p_property_id, 'shifts.view') then
    raise exception 'insufficient_permission' using errcode = '42501';
  end if;

  select exists(
    select 1 from public.shift_staff_profiles
    where id = p_staff_profile_id and property_id = p_property_id and profile_id = auth.uid()
  ) into v_is_self;

  if not v_is_self and not public.has_permission(p_property_id, 'shifts.manage') then
    raise exception 'insufficient_permission' using errcode = '42501';
  end if;

  if p_end < p_start then
    raise exception 'invalid_date_range' using errcode = '22023';
  end if;

  select * into v_settings from public.shift_vacation_settings where property_id = p_property_id;
  if v_settings is null then
    insert into public.shift_vacation_settings (property_id) values (p_property_id)
    returning * into v_settings;
  end if;

  if p_period_index < 0 or p_period_index >= v_settings.periods_per_year then
    raise exception 'invalid_period_index' using errcode = '22023';
  end if;

  v_days := (p_end - p_start) + 1;
  if v_days < v_settings.min_days or v_days > v_settings.max_days then
    raise exception 'duration_out_of_range' using errcode = '22023';
  end if;

  select p.full_name into v_conflict_name
  from public.shift_vacation_periods vp
  join public.shift_staff_profiles sp on sp.id = vp.staff_profile_id
  join public.profiles p on p.id = sp.profile_id
  where vp.property_id = p_property_id
    and vp.staff_profile_id <> p_staff_profile_id
    and vp.status in ('pending', 'confirmed')
    and vp.start_date <= p_end and p_start <= vp.end_date
  limit 1;

  if v_conflict_name is not null then
    raise exception 'overlaps_existing_period: %', v_conflict_name using errcode = '23P01';
  end if;

  select id into v_existing_id from public.shift_vacation_periods
    where property_id = p_property_id and staff_profile_id = p_staff_profile_id and period_index = p_period_index;
  if v_existing_id is not null then
    delete from public.shifts where vacation_period_id = v_existing_id and source = 'automatic';
  end if;

  insert into public.shift_vacation_periods
    (property_id, staff_profile_id, period_index, start_date, end_date, status, requested_by)
  values
    (p_property_id, p_staff_profile_id, p_period_index, p_start, p_end, 'pending', auth.uid())
  on conflict (property_id, staff_profile_id, period_index)
  do update set
    start_date = excluded.start_date,
    end_date = excluded.end_date,
    status = 'pending',
    requested_by = excluded.requested_by,
    decided_by = null,
    decided_at = null,
    updated_at = now()
  returning id into v_id;

  return v_id;
end;
$$;
revoke all on function public.request_vacation_period(uuid, uuid, smallint, date, date) from public;
grant execute on function public.request_vacation_period(uuid, uuid, smallint, date, date) to authenticated;

-- Manager decision: approve writes F across every active planning unit the
-- employee belongs to, for every day in range that isn't already a rest
-- day or occupied by something else; conflicting days are returned (never
-- written) for the caller to surface. Reject retracts this period's own
-- past writes, then deletes the row, same as before.
-- Return type changes from void to a table, so the old function must be
-- dropped first (CREATE OR REPLACE can't change a function's signature).
drop function if exists public.decide_vacation_period(uuid, boolean);
create function public.decide_vacation_period(
  p_period_id uuid,
  p_approve boolean
) returns table(planning_unit_id uuid, shift_date date, existing_code text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_property_id uuid;
  v_staff_profile_id uuid;
  v_start date;
  v_end date;
  actor uuid := auth.uid();
  v_unit record;
  v_code_id uuid;
  d date;
  v_existing_id uuid;
  v_existing_code text;
  v_conflict_units uuid[] := '{}';
  v_conflict_dates date[] := '{}';
  v_conflict_codes text[] := '{}';
begin
  select property_id, staff_profile_id, start_date, end_date
    into v_property_id, v_staff_profile_id, v_start, v_end
    from public.shift_vacation_periods where id = p_period_id for update;
  if v_property_id is null then
    raise exception 'period_not_found' using errcode = 'P0002';
  end if;
  if not public.has_permission(v_property_id, 'shifts.manage') then
    raise exception 'insufficient_permission' using errcode = '42501';
  end if;

  if not p_approve then
    delete from public.shifts where vacation_period_id = p_period_id and source = 'automatic';
    delete from public.shift_vacation_periods where id = p_period_id;
    return;
  end if;

  for v_unit in
    select sum.planning_unit_id as unit_id
    from public.shift_unit_members sum
    where sum.property_id = v_property_id and sum.staff_profile_id = v_staff_profile_id and sum.active
  loop
    select id into v_code_id from public.shift_codes
      where property_id = v_property_id and planning_unit_id = v_unit.unit_id and kind = 'leave' and active = true
      order by case code when 'F' then 0 else 1 end, code
      limit 1;
    if v_code_id is null then continue; end if;

    for d in select generate_series(v_start, v_end, interval '1 day')::date loop
      v_existing_id := null;
      v_existing_code := null;
      select s.id, c.code into v_existing_id, v_existing_code
        from public.shifts s join public.shift_codes c on c.id = s.shift_code_id
        where s.property_id = v_property_id and s.planning_unit_id = v_unit.unit_id
          and s.staff_profile_id = v_staff_profile_id and s.shift_date = d;

      if v_existing_id is null then
        insert into public.shifts (property_id, planning_unit_id, staff_profile_id, shift_code_id, shift_date, source, created_by, vacation_period_id)
        values (v_property_id, v_unit.unit_id, v_staff_profile_id, v_code_id, d, 'automatic', actor, p_period_id);
      elsif v_existing_code <> 'R' then
        v_conflict_units := array_append(v_conflict_units, v_unit.unit_id);
        v_conflict_dates := array_append(v_conflict_dates, d);
        v_conflict_codes := array_append(v_conflict_codes, v_existing_code);
      end if;
    end loop;
  end loop;

  update public.shift_vacation_periods
    set status = 'confirmed', decided_by = actor, decided_at = now(), updated_at = now()
    where id = p_period_id;

  return query select u, dt, cd from unnest(v_conflict_units, v_conflict_dates, v_conflict_codes) as t(u, dt, cd);
end;
$$;
revoke all on function public.decide_vacation_period(uuid, boolean) from public;
grant execute on function public.decide_vacation_period(uuid, boolean) to authenticated;
