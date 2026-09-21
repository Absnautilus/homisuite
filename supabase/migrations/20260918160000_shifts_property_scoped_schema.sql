-- Turni T1: property-scoped schema, capabilities and RLS foundation.
--
-- This migration is deliberately additive. It creates no entitlement rows,
-- copies no Planner data and never guesses identity mappings. Until a
-- property_modules row explicitly enables `shifts`, every module permission
-- below fails closed through has_permission().

begin;

-- ---------------------------------------------------------------------------
-- Capabilities
-- ---------------------------------------------------------------------------

-- `shifts.use` was an illustrative seed-only permission from before the
-- module contract existed. Remove it so local resets and any environment
-- that ever received that placeholder converge on the three canonical
-- capabilities below. role_permissions rows cascade with the permission.
delete from permissions where slug = 'shifts.use';

insert into permissions (slug, module_id)
select capability.slug, module.id
from modules module
cross join (values
  ('shifts.view'),
  ('shifts.manage'),
  ('shifts.requests.manage')
) as capability(slug)
where module.slug = 'shifts'
on conflict (slug) do update set module_id = excluded.module_id;

insert into role_permissions (role_id, permission_id)
select role.id, permission.id
from roles role
join permissions permission on true
where (role.slug, permission.slug) in (
  ('receptionist', 'shifts.view'),
  ('manager', 'shifts.view'),
  ('manager', 'shifts.manage'),
  ('manager', 'shifts.requests.manage'),
  ('property_admin', 'shifts.view'),
  ('property_admin', 'shifts.manage'),
  ('property_admin', 'shifts.requests.manage'),
  ('organization_admin', 'shifts.view'),
  ('organization_admin', 'shifts.manage'),
  ('organization_admin', 'shifts.requests.manage')
)
on conflict (role_id, permission_id) do nothing;

-- Composite foreign keys below use the tenant key as part of every
-- relationship. These supporting unique constraints make it impossible to
-- pair a Turni row with a Core row from another property.
alter table property_job_titles
  add constraint property_job_titles_property_id_id_key unique (property_id, id);

-- ---------------------------------------------------------------------------
-- Configuration
-- ---------------------------------------------------------------------------

create table shift_planning_units (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references properties(id) on delete cascade,
  name text not null check (char_length(trim(name)) between 1 and 80),
  slug text not null check (slug = lower(slug) and slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  status text not null default 'active' check (status in ('active', 'inactive')),
  member_visibility_scope text not null default 'own_unit'
    check (member_visibility_scope in ('own_unit', 'all_units')),
  created_by uuid references profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (property_id, id),
  unique (property_id, slug)
);

create table shift_staff_profiles (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references properties(id) on delete cascade,
  profile_id uuid not null references profiles(id) on delete cascade,
  shift_type text not null default 'day'
    check (shift_type in ('day', 'night', 'rotating', 'director', 'fom', 'custom')),
  rest_mode text not null default 'rotating' check (rest_mode in ('fixed', 'rotating')),
  fixed_rest_days smallint[] not null default '{}'::smallint[],
  active boolean not null default true,
  settings jsonb not null default '{}'::jsonb check (jsonb_typeof(settings) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint shift_staff_profiles_fixed_rest_days_check check (
    fixed_rest_days <@ array[0,1,2,3,4,5,6]::smallint[]
    and cardinality(fixed_rest_days) <= 2
    and (rest_mode <> 'fixed' or cardinality(fixed_rest_days) between 1 and 2)
  ),
  constraint shift_staff_profiles_core_staff_fk
    foreign key (property_id, profile_id)
    references property_staff_details(property_id, profile_id) on delete cascade,
  unique (property_id, id),
  unique (property_id, profile_id)
);

create table shift_unit_job_titles (
  property_id uuid not null references properties(id) on delete cascade,
  planning_unit_id uuid not null,
  job_title_id uuid not null,
  created_at timestamptz not null default now(),
  primary key (planning_unit_id, job_title_id),
  foreign key (property_id, planning_unit_id)
    references shift_planning_units(property_id, id) on delete cascade,
  foreign key (property_id, job_title_id)
    references property_job_titles(property_id, id) on delete cascade
);

create table shift_unit_members (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references properties(id) on delete cascade,
  planning_unit_id uuid not null,
  staff_profile_id uuid not null,
  assignment_profile_key text not null default 'day'
    check (char_length(trim(assignment_profile_key)) between 1 and 80),
  inclusion_source text not null default 'job_title'
    check (inclusion_source in ('job_title', 'explicit_include', 'explicit_exclude')),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (property_id, planning_unit_id)
    references shift_planning_units(property_id, id) on delete cascade,
  foreign key (property_id, staff_profile_id)
    references shift_staff_profiles(property_id, id) on delete cascade,
  unique (property_id, planning_unit_id, staff_profile_id),
  unique (planning_unit_id, staff_profile_id)
);

create table shift_rule_sets (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references properties(id) on delete cascade,
  planning_unit_id uuid not null,
  version integer not null check (version > 0),
  status text not null default 'draft' check (status in ('draft', 'active', 'archived')),
  preset_key text,
  engine_version text not null,
  rules jsonb not null check (jsonb_typeof(rules) = 'object'),
  created_by uuid references profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  foreign key (property_id, planning_unit_id)
    references shift_planning_units(property_id, id) on delete cascade,
  unique (property_id, planning_unit_id, id),
  unique (planning_unit_id, version)
);

alter table shift_planning_units add column current_rule_set_id uuid;
alter table shift_planning_units add constraint shift_planning_units_current_rule_set_fk
  foreign key (property_id, id, current_rule_set_id)
  references shift_rule_sets(property_id, planning_unit_id, id)
  deferrable initially deferred;

create table shift_codes (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references properties(id) on delete cascade,
  planning_unit_id uuid not null,
  code text not null check (char_length(trim(code)) between 1 and 12),
  label text not null check (char_length(trim(label)) between 1 and 80),
  kind text not null check (kind in ('work', 'rest', 'leave', 'permission', 'absence')),
  starts_at time,
  ends_at time,
  color text not null check (color ~ '^#[0-9A-Fa-f]{6}$'),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint shift_codes_work_times_check check (
    kind <> 'work' or (starts_at is not null and ends_at is not null)
  ),
  foreign key (property_id, planning_unit_id)
    references shift_planning_units(property_id, id) on delete cascade,
  unique (property_id, planning_unit_id, id),
  unique (planning_unit_id, code)
);

-- ---------------------------------------------------------------------------
-- Schedules and employee input
-- ---------------------------------------------------------------------------

create table shift_month_states (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references properties(id) on delete cascade,
  planning_unit_id uuid not null,
  month date not null check (month = date_trunc('month', month)::date),
  status text not null default 'draft' check (status in ('draft', 'final')),
  finalized_at timestamptz,
  finalized_by uuid references profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (property_id, planning_unit_id)
    references shift_planning_units(property_id, id) on delete cascade,
  unique (planning_unit_id, month)
);

create table shifts (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references properties(id) on delete cascade,
  planning_unit_id uuid not null,
  staff_profile_id uuid not null,
  shift_code_id uuid not null,
  shift_date date not null,
  locked boolean not null default false,
  source text not null default 'manual' check (source in ('manual', 'automatic', 'preassignment')),
  note text check (note is null or char_length(note) <= 500),
  created_by uuid references profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (property_id, planning_unit_id)
    references shift_planning_units(property_id, id) on delete cascade,
  foreign key (property_id, staff_profile_id)
    references shift_staff_profiles(property_id, id) on delete restrict,
  foreign key (property_id, planning_unit_id, shift_code_id)
    references shift_codes(property_id, planning_unit_id, id) on delete restrict,
  foreign key (property_id, planning_unit_id, staff_profile_id)
    references shift_unit_members(property_id, planning_unit_id, staff_profile_id) on delete restrict,
  unique (property_id, planning_unit_id, staff_profile_id, id),
  unique (planning_unit_id, staff_profile_id, shift_date)
);

create table shift_preferences (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references properties(id) on delete cascade,
  planning_unit_id uuid not null,
  staff_profile_id uuid not null,
  preference_date date not null,
  preference text not null check (preference in ('prefer_morning', 'prefer_evening', 'prefer_night', 'avoid_work')),
  note text check (note is null or char_length(note) <= 500),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (property_id, planning_unit_id)
    references shift_planning_units(property_id, id) on delete cascade,
  foreign key (property_id, staff_profile_id)
    references shift_staff_profiles(property_id, id) on delete cascade,
  foreign key (property_id, planning_unit_id, staff_profile_id)
    references shift_unit_members(property_id, planning_unit_id, staff_profile_id) on delete cascade,
  unique (planning_unit_id, staff_profile_id, preference_date)
);

create table shift_absence_requests (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references properties(id) on delete cascade,
  planning_unit_id uuid not null,
  staff_profile_id uuid not null,
  starts_on date not null,
  ends_on date not null,
  absence_kind text not null check (absence_kind in ('leave', 'permission', 'illness', 'other')),
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected', 'cancelled')),
  note text check (note is null or char_length(note) <= 1000),
  decided_by uuid references profiles(id) on delete set null,
  decided_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (ends_on >= starts_on),
  foreign key (property_id, planning_unit_id)
    references shift_planning_units(property_id, id) on delete cascade,
  foreign key (property_id, staff_profile_id)
    references shift_staff_profiles(property_id, id) on delete cascade,
  foreign key (property_id, planning_unit_id, staff_profile_id)
    references shift_unit_members(property_id, planning_unit_id, staff_profile_id) on delete cascade
);

create table shift_swap_requests (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references properties(id) on delete cascade,
  planning_unit_id uuid not null,
  requester_staff_profile_id uuid not null,
  requested_shift_id uuid not null,
  target_staff_profile_id uuid,
  offered_shift_id uuid,
  status text not null default 'pending' check (status in ('pending', 'accepted', 'approved', 'rejected', 'cancelled')),
  note text check (note is null or char_length(note) <= 1000),
  decided_by uuid references profiles(id) on delete set null,
  decided_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint shift_swap_requests_offered_shift_requires_target_check
    check (offered_shift_id is null or target_staff_profile_id is not null),
  foreign key (property_id, planning_unit_id)
    references shift_planning_units(property_id, id) on delete cascade,
  foreign key (property_id, requester_staff_profile_id)
    references shift_staff_profiles(property_id, id) on delete cascade,
  foreign key (property_id, target_staff_profile_id)
    references shift_staff_profiles(property_id, id) on delete restrict,
  foreign key (property_id, planning_unit_id, requester_staff_profile_id)
    references shift_unit_members(property_id, planning_unit_id, staff_profile_id) on delete cascade,
  foreign key (property_id, planning_unit_id, target_staff_profile_id)
    references shift_unit_members(property_id, planning_unit_id, staff_profile_id) on delete restrict,
  foreign key (property_id, planning_unit_id, requester_staff_profile_id, requested_shift_id)
    references shifts(property_id, planning_unit_id, staff_profile_id, id) on delete cascade,
  foreign key (property_id, planning_unit_id, target_staff_profile_id, offered_shift_id)
    references shifts(property_id, planning_unit_id, staff_profile_id, id)
    on delete set null (target_staff_profile_id, offered_shift_id)
);

create table shift_preassignments (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references properties(id) on delete cascade,
  planning_unit_id uuid not null,
  staff_profile_id uuid not null,
  shift_code_id uuid not null,
  shift_date date not null,
  locked boolean not null default true,
  note text check (note is null or char_length(note) <= 500),
  created_by uuid references profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (property_id, planning_unit_id)
    references shift_planning_units(property_id, id) on delete cascade,
  foreign key (property_id, staff_profile_id)
    references shift_staff_profiles(property_id, id) on delete cascade,
  foreign key (property_id, planning_unit_id, shift_code_id)
    references shift_codes(property_id, planning_unit_id, id) on delete restrict,
  foreign key (property_id, planning_unit_id, staff_profile_id)
    references shift_unit_members(property_id, planning_unit_id, staff_profile_id) on delete cascade,
  unique (planning_unit_id, staff_profile_id, shift_date)
);

create table shift_notifications (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references properties(id) on delete cascade,
  planning_unit_id uuid,
  profile_id uuid not null references profiles(id) on delete cascade,
  kind text not null,
  payload jsonb not null default '{}'::jsonb check (jsonb_typeof(payload) = 'object'),
  read_at timestamptz,
  created_at timestamptz not null default now(),
  foreign key (property_id, planning_unit_id)
    references shift_planning_units(property_id, id) on delete cascade
);

create table shift_push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references properties(id) on delete cascade,
  profile_id uuid not null references profiles(id) on delete cascade,
  endpoint text not null,
  p256dh text not null,
  auth_secret text not null,
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (property_id, profile_id, endpoint)
);

-- Frequently-used lookup paths.
create index shift_staff_profiles_profile_idx on shift_staff_profiles(profile_id);
create index shift_unit_members_staff_idx on shift_unit_members(property_id, staff_profile_id);
create index shifts_unit_date_idx on shifts(property_id, planning_unit_id, shift_date);
create index shifts_staff_date_idx on shifts(property_id, staff_profile_id, shift_date);
create index shift_absence_requests_unit_status_idx on shift_absence_requests(property_id, planning_unit_id, status);
create index shift_swap_requests_unit_status_idx on shift_swap_requests(property_id, planning_unit_id, status);
create index shift_notifications_unread_idx on shift_notifications(property_id, profile_id, created_at desc) where read_at is null;

-- Shared updated_at trigger.
create trigger shift_planning_units_set_updated_at before update on shift_planning_units
  for each row execute function set_updated_at();
create trigger shift_staff_profiles_set_updated_at before update on shift_staff_profiles
  for each row execute function set_updated_at();
create trigger shift_unit_members_set_updated_at before update on shift_unit_members
  for each row execute function set_updated_at();
create trigger shift_codes_set_updated_at before update on shift_codes
  for each row execute function set_updated_at();
create trigger shift_month_states_set_updated_at before update on shift_month_states
  for each row execute function set_updated_at();
create trigger shifts_set_updated_at before update on shifts
  for each row execute function set_updated_at();
create trigger shift_preferences_set_updated_at before update on shift_preferences
  for each row execute function set_updated_at();
create trigger shift_absence_requests_set_updated_at before update on shift_absence_requests
  for each row execute function set_updated_at();
create trigger shift_swap_requests_set_updated_at before update on shift_swap_requests
  for each row execute function set_updated_at();
create trigger shift_preassignments_set_updated_at before update on shift_preassignments
  for each row execute function set_updated_at();
create trigger shift_push_subscriptions_set_updated_at before update on shift_push_subscriptions
  for each row execute function set_updated_at();

-- ---------------------------------------------------------------------------
-- Ownership helper for employee-owned input
-- ---------------------------------------------------------------------------

create function owns_shift_staff_profile(p_property_id uuid, p_staff_profile_id uuid)
returns boolean
language sql stable security definer set search_path = '' as $$
  select public.has_permission(p_property_id, 'shifts.view') and exists (
    select 1
    from public.shift_staff_profiles staff
    where staff.property_id = p_property_id
      and staff.id = p_staff_profile_id
      and staff.profile_id = (select auth.uid())
      and staff.active
  );
$$;

revoke all on function owns_shift_staff_profile(uuid, uuid) from public, anon;
grant execute on function owns_shift_staff_profile(uuid, uuid) to authenticated;

-- Personal scheduling input is writable only while the actor is an active
-- member of the unit. The broader ownership helper above intentionally stays
-- unit-agnostic so former members can still read their own historical data.
create function owns_active_shift_unit_membership(
  p_property_id uuid,
  p_planning_unit_id uuid,
  p_staff_profile_id uuid
)
returns boolean
language sql stable security definer set search_path = '' as $$
  select public.has_permission(p_property_id, 'shifts.view') and exists (
    select 1
    from public.shift_unit_members member
    join public.shift_staff_profiles staff
      on staff.property_id = member.property_id
     and staff.id = member.staff_profile_id
    where member.property_id = p_property_id
      and member.planning_unit_id = p_planning_unit_id
      and member.staff_profile_id = p_staff_profile_id
      and member.active
      and staff.active
      and staff.profile_id = (select auth.uid())
  );
$$;

revoke all on function owns_active_shift_unit_membership(uuid, uuid, uuid) from public, anon;
grant execute on function owns_active_shift_unit_membership(uuid, uuid, uuid) to authenticated;

-- A capability opens the module; this helper narrows ordinary staff to their
-- own units. Managers see every unit in the property. A unit administrator
-- may let the members of one source unit see all other units in the property.
create function can_view_shift_planning_unit(p_property_id uuid, p_planning_unit_id uuid)
returns boolean
language sql stable security definer set search_path = '' as $$
  select public.has_permission(p_property_id, 'shifts.view') and (
    public.has_permission(p_property_id, 'shifts.manage')
    or exists (
      select 1
      from public.shift_unit_members member
      join public.shift_staff_profiles staff
        on staff.property_id = member.property_id
       and staff.id = member.staff_profile_id
      join public.shift_planning_units source_unit
        on source_unit.property_id = member.property_id
       and source_unit.id = member.planning_unit_id
      where member.property_id = p_property_id
        and member.active
        and staff.active
        and staff.profile_id = (select auth.uid())
        and (
          member.planning_unit_id = p_planning_unit_id
          or source_unit.member_visibility_scope = 'all_units'
        )
    )
  );
$$;

create function can_view_shift_staff_profile(p_property_id uuid, p_staff_profile_id uuid)
returns boolean
language sql stable security definer set search_path = '' as $$
  select public.has_permission(p_property_id, 'shifts.view') and (
    public.has_permission(p_property_id, 'shifts.manage')
    or exists (
      select 1
      from public.shift_unit_members member
      where member.property_id = p_property_id
        and member.staff_profile_id = p_staff_profile_id
        and member.active
        and public.can_view_shift_planning_unit(member.property_id, member.planning_unit_id)
    )
  );
$$;

revoke all on function can_view_shift_planning_unit(uuid, uuid) from public, anon;
revoke all on function can_view_shift_staff_profile(uuid, uuid) from public, anon;
grant execute on function can_view_shift_planning_unit(uuid, uuid) to authenticated;
grant execute on function can_view_shift_staff_profile(uuid, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- RLS and explicit Data API grants
-- ---------------------------------------------------------------------------

alter table shift_planning_units enable row level security;
alter table shift_staff_profiles enable row level security;
alter table shift_unit_job_titles enable row level security;
alter table shift_unit_members enable row level security;
alter table shift_rule_sets enable row level security;
alter table shift_codes enable row level security;
alter table shift_month_states enable row level security;
alter table shifts enable row level security;
alter table shift_preferences enable row level security;
alter table shift_absence_requests enable row level security;
alter table shift_swap_requests enable row level security;
alter table shift_preassignments enable row level security;
alter table shift_notifications enable row level security;
alter table shift_push_subscriptions enable row level security;

revoke all on table
  shift_planning_units, shift_staff_profiles, shift_unit_job_titles,
  shift_unit_members, shift_rule_sets, shift_codes, shift_month_states, shifts,
  shift_preferences, shift_absence_requests, shift_swap_requests,
  shift_preassignments, shift_notifications, shift_push_subscriptions
from anon, authenticated;

grant select, insert, update, delete on table
  shift_planning_units, shift_staff_profiles, shift_unit_job_titles,
  shift_unit_members, shift_rule_sets, shift_codes, shift_month_states, shifts,
  shift_preferences, shift_absence_requests, shift_swap_requests,
  shift_preassignments, shift_notifications, shift_push_subscriptions
to authenticated;

-- A recipient may acknowledge a notification but must never rewrite its
-- type, payload or ownership through the Data API.
revoke update on table shift_notifications from authenticated;
grant update (read_at) on table shift_notifications to authenticated;

-- Make the operation surface match the policies instead of relying on
-- policy absence alone as the denial mechanism.
revoke update, delete on table shift_rule_sets from authenticated;
revoke delete on table shift_month_states from authenticated;
revoke delete on table shift_absence_requests, shift_swap_requests, shift_notifications from authenticated;

-- All Turni data is visible only when the property is entitled and the actor
-- has shifts.view. has_permission() enforces both halves.
create policy shift_planning_units_select on shift_planning_units for select to authenticated using (can_view_shift_planning_unit(property_id, id));
create policy shift_staff_profiles_select on shift_staff_profiles for select to authenticated using (can_view_shift_staff_profile(property_id, id));
create policy shift_unit_job_titles_select on shift_unit_job_titles for select to authenticated using (can_view_shift_planning_unit(property_id, planning_unit_id));
create policy shift_unit_members_select on shift_unit_members for select to authenticated using (can_view_shift_planning_unit(property_id, planning_unit_id));
create policy shift_rule_sets_select on shift_rule_sets for select to authenticated using (can_view_shift_planning_unit(property_id, planning_unit_id));
create policy shift_codes_select on shift_codes for select to authenticated using (can_view_shift_planning_unit(property_id, planning_unit_id));
create policy shift_month_states_select on shift_month_states for select to authenticated using (can_view_shift_planning_unit(property_id, planning_unit_id));
create policy shifts_select on shifts for select to authenticated using (can_view_shift_planning_unit(property_id, planning_unit_id));
create policy shift_preferences_select on shift_preferences for select to authenticated
  using (owns_shift_staff_profile(property_id, staff_profile_id) or has_permission(property_id, 'shifts.manage'));
create policy shift_absence_requests_select on shift_absence_requests for select to authenticated
  using (owns_shift_staff_profile(property_id, staff_profile_id) or has_permission(property_id, 'shifts.requests.manage'));
create policy shift_swap_requests_select on shift_swap_requests for select to authenticated
  using (
    owns_shift_staff_profile(property_id, requester_staff_profile_id)
    or (target_staff_profile_id is not null and owns_shift_staff_profile(property_id, target_staff_profile_id))
    or has_permission(property_id, 'shifts.requests.manage')
  );
create policy shift_preassignments_select on shift_preassignments for select to authenticated using (can_view_shift_planning_unit(property_id, planning_unit_id));
create policy shift_notifications_select on shift_notifications for select to authenticated using (profile_id = (select auth.uid()) and has_permission(property_id, 'shifts.view'));
create policy shift_push_subscriptions_select on shift_push_subscriptions for select to authenticated using (profile_id = (select auth.uid()) and has_permission(property_id, 'shifts.view'));

-- Administrative configuration and published schedule writes.
create policy shift_planning_units_insert on shift_planning_units for insert to authenticated with check (has_permission(property_id, 'shifts.manage'));
create policy shift_planning_units_update on shift_planning_units for update to authenticated using (has_permission(property_id, 'shifts.manage')) with check (has_permission(property_id, 'shifts.manage'));
create policy shift_planning_units_delete on shift_planning_units for delete to authenticated using (has_permission(property_id, 'shifts.manage'));
create policy shift_staff_profiles_insert on shift_staff_profiles for insert to authenticated with check (has_permission(property_id, 'shifts.manage'));
create policy shift_staff_profiles_update on shift_staff_profiles for update to authenticated using (has_permission(property_id, 'shifts.manage')) with check (has_permission(property_id, 'shifts.manage'));
create policy shift_staff_profiles_delete on shift_staff_profiles for delete to authenticated using (has_permission(property_id, 'shifts.manage'));
create policy shift_unit_job_titles_insert on shift_unit_job_titles for insert to authenticated with check (has_permission(property_id, 'shifts.manage'));
create policy shift_unit_job_titles_delete on shift_unit_job_titles for delete to authenticated using (has_permission(property_id, 'shifts.manage'));
create policy shift_unit_members_insert on shift_unit_members for insert to authenticated with check (has_permission(property_id, 'shifts.manage'));
create policy shift_unit_members_update on shift_unit_members for update to authenticated using (has_permission(property_id, 'shifts.manage')) with check (has_permission(property_id, 'shifts.manage'));
create policy shift_unit_members_delete on shift_unit_members for delete to authenticated using (has_permission(property_id, 'shifts.manage'));
create policy shift_rule_sets_insert on shift_rule_sets for insert to authenticated with check (has_permission(property_id, 'shifts.manage'));
create policy shift_codes_insert on shift_codes for insert to authenticated with check (has_permission(property_id, 'shifts.manage'));
create policy shift_codes_update on shift_codes for update to authenticated using (has_permission(property_id, 'shifts.manage')) with check (has_permission(property_id, 'shifts.manage'));
create policy shift_codes_delete on shift_codes for delete to authenticated using (has_permission(property_id, 'shifts.manage'));
create policy shift_month_states_insert on shift_month_states for insert to authenticated with check (has_permission(property_id, 'shifts.manage'));
create policy shift_month_states_update on shift_month_states for update to authenticated using (has_permission(property_id, 'shifts.manage')) with check (has_permission(property_id, 'shifts.manage'));
create policy shifts_insert on shifts for insert to authenticated with check (has_permission(property_id, 'shifts.manage'));
create policy shifts_update on shifts for update to authenticated using (has_permission(property_id, 'shifts.manage')) with check (has_permission(property_id, 'shifts.manage'));
create policy shifts_delete on shifts for delete to authenticated using (has_permission(property_id, 'shifts.manage'));
create policy shift_preassignments_insert on shift_preassignments for insert to authenticated with check (has_permission(property_id, 'shifts.manage'));
create policy shift_preassignments_update on shift_preassignments for update to authenticated using (has_permission(property_id, 'shifts.manage')) with check (has_permission(property_id, 'shifts.manage'));
create policy shift_preassignments_delete on shift_preassignments for delete to authenticated using (has_permission(property_id, 'shifts.manage'));

-- Employees own their preferences and may open their own requests. Request
-- state transitions are manager-only in T1; employee cancellation will use a
-- dedicated RPC in the runtime phase so unrelated audit fields cannot be
-- rewritten alongside the status.
create policy shift_preferences_insert on shift_preferences for insert to authenticated
  with check (owns_active_shift_unit_membership(property_id, planning_unit_id, staff_profile_id) or has_permission(property_id, 'shifts.manage'));
create policy shift_preferences_update on shift_preferences for update to authenticated
  using (owns_active_shift_unit_membership(property_id, planning_unit_id, staff_profile_id) or has_permission(property_id, 'shifts.manage'))
  with check (owns_active_shift_unit_membership(property_id, planning_unit_id, staff_profile_id) or has_permission(property_id, 'shifts.manage'));
create policy shift_preferences_delete on shift_preferences for delete to authenticated
  using (owns_active_shift_unit_membership(property_id, planning_unit_id, staff_profile_id) or has_permission(property_id, 'shifts.manage'));

create policy shift_absence_requests_insert on shift_absence_requests for insert to authenticated
  with check ((owns_active_shift_unit_membership(property_id, planning_unit_id, staff_profile_id) and status = 'pending') or has_permission(property_id, 'shifts.requests.manage'));
create policy shift_absence_requests_update on shift_absence_requests for update to authenticated
  using (has_permission(property_id, 'shifts.requests.manage'))
  with check (has_permission(property_id, 'shifts.requests.manage'));

create policy shift_swap_requests_insert on shift_swap_requests for insert to authenticated
  with check ((owns_active_shift_unit_membership(property_id, planning_unit_id, requester_staff_profile_id) and status = 'pending') or has_permission(property_id, 'shifts.requests.manage'));
create policy shift_swap_requests_update on shift_swap_requests for update to authenticated
  using (has_permission(property_id, 'shifts.requests.manage'))
  with check (has_permission(property_id, 'shifts.requests.manage'));

create policy shift_notifications_update on shift_notifications for update to authenticated
  using (profile_id = (select auth.uid()) and has_permission(property_id, 'shifts.view'))
  with check (profile_id = (select auth.uid()) and has_permission(property_id, 'shifts.view'));
create policy shift_notifications_insert on shift_notifications for insert to authenticated
  with check (has_permission(property_id, 'shifts.requests.manage'));

create policy shift_push_subscriptions_insert on shift_push_subscriptions for insert to authenticated
  with check (profile_id = (select auth.uid()) and has_permission(property_id, 'shifts.view'));
create policy shift_push_subscriptions_update on shift_push_subscriptions for update to authenticated
  using (profile_id = (select auth.uid()) and has_permission(property_id, 'shifts.view'))
  with check (profile_id = (select auth.uid()) and has_permission(property_id, 'shifts.view'));
create policy shift_push_subscriptions_delete on shift_push_subscriptions for delete to authenticated
  using (profile_id = (select auth.uid()) and has_permission(property_id, 'shifts.view'));

comment on table shift_planning_units is 'Independent Turni schedules inside one property; never a separate tenant.';
comment on column shift_planning_units.member_visibility_scope is 'own_unit limits this unit members to their own operational roster/calendar; all_units lets them read every unit in the same property when they also hold shifts.view.';
comment on table shift_staff_profiles is 'Turni operational settings linked to Core staff identity; owns no credentials or software role.';
comment on table shift_rule_sets is 'Immutable-by-convention versioned scheduling-engine input; activation is held by the planning unit pointer.';
comment on table shifts is 'Property- and unit-scoped schedule assignments. Legacy Planner rows are not copied by this migration.';

commit;
