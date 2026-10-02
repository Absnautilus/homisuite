-- "Piano Ferie": per-employee vacation periods, visible to the whole
-- property (not manager-only, unlike most of Turni's settings) so staff can
-- see what's already taken before requesting their own, plus a manager
-- approval workflow and per-property settings for how many periods a year
-- and how long each may run.

create table public.shift_vacation_settings (
  property_id uuid primary key references public.properties(id) on delete cascade,
  periods_per_year smallint not null default 3 check (periods_per_year between 1 and 6),
  min_days smallint not null default 1 check (min_days >= 1),
  max_days smallint not null default 30 check (max_days >= min_days),
  updated_at timestamptz not null default now()
);

create table public.shift_vacation_periods (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references public.properties(id) on delete cascade,
  staff_profile_id uuid not null references public.shift_staff_profiles(id) on delete cascade,
  period_index smallint not null check (period_index >= 0),
  start_date date not null,
  end_date date not null check (end_date >= start_date),
  status text not null default 'pending' check (status in ('pending', 'confirmed')),
  requested_by uuid references public.profiles(id),
  decided_by uuid references public.profiles(id),
  decided_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (property_id, staff_profile_id, period_index)
);
create index shift_vacation_periods_property_idx on public.shift_vacation_periods (property_id);

alter table public.shift_vacation_settings enable row level security;
alter table public.shift_vacation_periods enable row level security;

-- Settings: everyone who can see Turni reads them (they drive the request
-- form's day-count hint); only a manager can create or change them.
create policy shift_vacation_settings_select on public.shift_vacation_settings
  for select using (public.has_permission(property_id, 'shifts.view'));
create policy shift_vacation_settings_insert on public.shift_vacation_settings
  for insert with check (public.has_permission(property_id, 'shifts.manage'));
create policy shift_vacation_settings_update on public.shift_vacation_settings
  for update using (public.has_permission(property_id, 'shifts.manage'))
  with check (public.has_permission(property_id, 'shifts.manage'));

-- Periods: readable by anyone who can see Turni (the whole point is that
-- the team sees each other's periods before requesting their own). No
-- insert/update/delete policy -- every write goes through the two RPCs
-- below, which validate the request before touching the table.
create policy shift_vacation_periods_select on public.shift_vacation_periods
  for select using (public.has_permission(property_id, 'shifts.view'));

-- Self-service (or manager-on-behalf-of) request: validates the period
-- index against the property's configured count, the duration against its
-- min/max days, and that the range doesn't overlap anyone else's pending or
-- confirmed period at the property -- then upserts as 'pending', clearing
-- any previous decision so a re-request always needs fresh approval.
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

-- Manager decision: approve confirms it in place; reject deletes the row
-- outright (the slot simply goes back to "da pianificare" for a fresh
-- request), rather than keeping a separate rejected status to track.
create or replace function public.decide_vacation_period(
  p_period_id uuid,
  p_approve boolean
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_property_id uuid;
begin
  select property_id into v_property_id from public.shift_vacation_periods where id = p_period_id;
  if v_property_id is null then
    raise exception 'period_not_found' using errcode = 'P0002';
  end if;
  if not public.has_permission(v_property_id, 'shifts.manage') then
    raise exception 'insufficient_permission' using errcode = '42501';
  end if;

  if p_approve then
    update public.shift_vacation_periods
    set status = 'confirmed', decided_by = auth.uid(), decided_at = now(), updated_at = now()
    where id = p_period_id;
  else
    delete from public.shift_vacation_periods where id = p_period_id;
  end if;
end;
$$;
revoke all on function public.decide_vacation_period(uuid, boolean) from public;
grant execute on function public.decide_vacation_period(uuid, boolean) to authenticated;
