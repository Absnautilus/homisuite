-- Replaces the fixed department enum (reception/housekeeping/maintenance/
-- porter) with the existing per-property "mansioni" (property_job_titles,
-- already used by Team) as the thing that routes/gates visibility of a
-- guest request -- a category can now name zero or more job titles, not
-- exactly one department. "Reparto" made no sense as a fixed, hotel-wide
-- taxonomy when Team already lets each property define its own job
-- titles freely; this makes the menu's own routing use that same
-- taxonomy instead of a second, parallel one.
--
-- Scope, deliberately narrow: this touches guest_requests' OWN visibility
-- (guest_requests_select_hotel/update_hotel/delete_hotel) only.
-- current_staff_department()/current_staff_manages_front_desk() and
-- everything they gate (stays, guest_login_attempts, reservations) are
-- untouched -- "front desk" duties are a separate, broader permission
-- concept than "which mansioni handle this request category", and
-- conflating the two here would silently change Stays access, which
-- nobody asked for.
--
-- Existing categories keep their (now informational-only) department
-- value but start with ZERO linked job titles -- deliberately not
-- auto-mapped (department and job titles are different, unrelated
-- namespaces with no reliable 1:1 correspondence), so every property
-- needs an explicit, one-time admin pass to assign mansioni to its
-- existing categories. Until that happens, only admin/master or a
-- job title explicitly marked sees_full_queue will see those requests --
-- fails closed, not open.

begin;

-- ---------------------------------------------------------------------------
-- property_job_titles: an admin can mark a job title as "sees every
-- request regardless of category" -- the generalized replacement for
-- today's "reception (or admin) sees the whole queue" behavior, since
-- there's no fixed "front desk mansione" to hardcode.
-- ---------------------------------------------------------------------------
alter table property_job_titles add column sees_full_queue boolean not null default false;
grant update (sees_full_queue) on property_job_titles to authenticated;

-- ---------------------------------------------------------------------------
-- request_categories.department / guest_requests.assigned_department: kept
-- for existing display code (archive/stats/badges) and historical rows,
-- but no longer required -- a new category no longer needs a department at
-- all, and the guest_requests_before_insert trigger below tolerates a null
-- category department by simply not setting assigned_department, rather
-- than failing the insert.
-- ---------------------------------------------------------------------------
alter table request_categories alter column department drop not null;
alter table guest_requests alter column assigned_department drop not null;

-- ---------------------------------------------------------------------------
-- request_category_job_titles: which mansioni handle a category's requests.
-- Bridged the same way every other guest-facing/property-scoped join here
-- is: request_categories is keyed by the legacy hotel_id, property_job_titles
-- by the Core property_id -- so this join table stores the (Core-side)
-- job_title_id directly against the category, and every RLS check below
-- reaches it via request_categories.hotel_id = current_staff_hotel(), the
-- same predicate request_categories_admin_write already uses, rather than
-- re-deriving property_id via legacy_property_mapping (which has no
-- policies for authenticated/anon at all -- only SECURITY DEFINER
-- functions may read it).
-- ---------------------------------------------------------------------------
create table request_category_job_titles (
  category_id uuid not null references request_categories(id) on delete cascade,
  job_title_id uuid not null references property_job_titles(id) on delete cascade,
  primary key (category_id, job_title_id)
);
create index request_category_job_titles_job_title_idx on request_category_job_titles(job_title_id);

alter table request_category_job_titles enable row level security;

create policy request_category_job_titles_select on request_category_job_titles for select to authenticated
  using (
    exists (select 1 from request_categories rc where rc.id = category_id and rc.hotel_id = current_staff_hotel())
  );

create policy request_category_job_titles_admin_write on request_category_job_titles for all to authenticated
  using (
    current_staff_role() in ('admin', 'master')
    and exists (select 1 from request_categories rc where rc.id = category_id and rc.hotel_id = current_staff_hotel())
  )
  with check (
    current_staff_role() in ('admin', 'master')
    and exists (select 1 from request_categories rc where rc.id = category_id and rc.hotel_id = current_staff_hotel())
  );

grant select, insert, delete on request_category_job_titles to authenticated;

-- ---------------------------------------------------------------------------
-- guest_requests.assigned_job_title_ids: denormalized onto the row at
-- creation time, same pattern assigned_department already used (read once
-- by the trigger, not re-derived on every RLS check) -- the mansioni that
-- were linked to the request's category at the moment it was created.
-- ---------------------------------------------------------------------------
alter table guest_requests add column assigned_job_title_ids uuid[] not null default '{}';

-- ---------------------------------------------------------------------------
-- helpers -- mirror current_staff_hotel()/current_staff_department()'s own
-- shape (SECURITY DEFINER, bridge through legacy_property_mapping to reach
-- the Core-side property_staff_details/property_job_titles rows).
-- ---------------------------------------------------------------------------
create function current_staff_job_title_id() returns uuid
language sql security definer stable set search_path = public as $$
  select psd.job_title_id
  from staff_profiles sp
  join legacy_property_mapping m on m.legacy_hotel_id = sp.hotel_id
  left join property_staff_details psd on psd.property_id = m.platform_property_id and psd.profile_id = sp.auth_user_id
  where sp.auth_user_id = auth.uid() and sp.active
  limit 1;
$$;

create function current_staff_sees_full_queue() returns boolean
language sql security definer stable set search_path = public as $$
  select coalesce(
    (select jt.sees_full_queue from property_job_titles jt where jt.id = current_staff_job_title_id()),
    false
  );
$$;

revoke all on function current_staff_job_title_id() from public;
revoke all on function current_staff_sees_full_queue() from public;
grant execute on function current_staff_job_title_id() to authenticated;
grant execute on function current_staff_sees_full_queue() to authenticated;

-- ---------------------------------------------------------------------------
-- guest_requests_before_insert: also populate assigned_job_title_ids from
-- the category's linked mansioni; tolerates a category with no department
-- (assigned_department stays null) and/or no linked job titles
-- (assigned_job_title_ids stays '{}', meaning only admin/master or a
-- sees_full_queue mansione will see the request until an admin links one).
-- ---------------------------------------------------------------------------
create or replace function guest_requests_before_insert() returns trigger
language plpgsql as $$
begin
  if new.assigned_department is null then
    select rc.department into new.assigned_department
    from request_types rt
    join request_categories rc on rc.id = rt.category_id
    where rt.id = new.request_type_id;
  end if;

  if new.assigned_job_title_ids = '{}'::uuid[] then
    select coalesce(array_agg(rcjt.job_title_id), '{}') into new.assigned_job_title_ids
    from request_types rt
    join request_category_job_titles rcjt on rcjt.category_id = rt.category_id
    where rt.id = new.request_type_id;
  end if;

  if new.stay_id is not null then
    select r.room_number into new.room_number
    from stays s
    join rooms r on r.id = s.room_id
    where s.id = new.stay_id;
  end if;

  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- guest_requests visibility: replaces the department-scoped predicate
-- (current_staff_manages_front_desk() OR assigned_department =
-- current_staff_department(), from 20260827121400) with the mansione-based
-- one -- admin/master always see everything, a sees_full_queue mansione
-- sees everything, otherwise a staff member sees a request only if their
-- own job_title_id is one of the request's assigned_job_title_ids.
-- current_staff_job_title_id() = any(...) is null (not true) for staff
-- with no job title assigned, which correctly excludes them rather than
-- erroring -- same fail-closed shape the old department branch had.
-- ---------------------------------------------------------------------------
drop policy guest_requests_select_hotel on guest_requests;
drop policy guest_requests_update_hotel on guest_requests;
drop policy guest_requests_delete_hotel on guest_requests;

create policy guest_requests_select_hotel on guest_requests for select to authenticated
  using (
    hotel_id = current_staff_hotel()
    and (
      current_staff_role() in ('admin', 'master')
      or current_staff_sees_full_queue()
      or current_staff_job_title_id() = any(assigned_job_title_ids)
    )
  );

create policy guest_requests_update_hotel on guest_requests for update to authenticated
  using (
    hotel_id = current_staff_hotel()
    and (
      current_staff_role() in ('admin', 'master')
      or current_staff_sees_full_queue()
      or current_staff_job_title_id() = any(assigned_job_title_ids)
    )
  )
  with check (hotel_id = current_staff_hotel());

create policy guest_requests_delete_hotel on guest_requests for delete to authenticated
  using (
    hotel_id = current_staff_hotel()
    and (
      current_staff_role() in ('admin', 'master')
      or current_staff_sees_full_queue()
      or current_staff_job_title_id() = any(assigned_job_title_ids)
    )
  );

-- ---------------------------------------------------------------------------
-- guest_requests_property_job_titles: the Housekeeping module only ever
-- knows the legacy hotel_id (never the Core property_id, and
-- legacy_property_mapping itself has no policies for authenticated/anon at
-- all), so the Menu admin UI needs a bridge RPC to list a property's active
-- mansioni for the multi-select -- same shape as the other
-- guest_requests_*_for_property/hotel bridge functions. Any active staff at
-- the hotel may read this (job title names aren't sensitive, same as
-- request_categories/request_types); only the request_category_job_titles
-- write itself is admin-gated (see the RLS above).
-- ---------------------------------------------------------------------------
create function guest_requests_property_job_titles(p_hotel_id uuid)
returns table(id uuid, name text)
language sql security definer stable set search_path = public as $$
  select jt.id, jt.name
  from legacy_property_mapping m
  join property_job_titles jt on jt.property_id = m.platform_property_id
  where m.legacy_hotel_id = p_hotel_id
    and jt.active
    and p_hotel_id = current_staff_hotel()
  order by jt.name;
$$;

revoke all on function guest_requests_property_job_titles(uuid) from public;
grant execute on function guest_requests_property_job_titles(uuid) to authenticated;

commit;
