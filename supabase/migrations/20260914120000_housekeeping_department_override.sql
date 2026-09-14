-- Fixes a real, live gap surfaced by Francesco Breda's account (Team role
-- "Operatore"/receptionist-rank, bridged into Housekeeping): guest_requests'
-- front-desk visibility depends on current_staff_department(), which has
-- never read anything Core-derived -- it only ever read the raw,
-- module-local staff_profiles.department column. grant-housekeeping-access
-- (the Edge Function backing Team's "Moduli" toggle) was written under the
-- older assumption that current_staff_role() read staff_profiles.role
-- directly and that setting it to 'admin' alone was enough to make a
-- Team-bridged member front-desk. Once current_staff_role() was rewritten
-- (see guest_requests_authorization_wrapper) to derive from the caller's
-- Core rank at the mapped property instead, a Team-bridged member whose
-- Core role is below property_admin (rank 30) -- i.e. every ordinary
-- receptionist/operatore-rank member -- stopped being recognized as
-- front-desk, and fell through to the department-scoped branch with no
-- Core-aware department to check against. staff_profiles.department was
-- never populated for these accounts (the bridge had no reason to touch it
-- under the old assumption), so that branch silently evaluated to "no
-- department", hence an empty queue.
--
-- Fix: let a hotel admin set an explicit Housekeeping-relevant department
-- per Team member (independent of their free-text "Mansione" job title,
-- which property_job_titles already makes clear is descriptive only, not
-- an access control input). current_staff_department() now prefers this
-- Core-side override, falling back to the legacy column so any historical
-- native-account data (pre-dating Team bridging entirely) keeps working
-- unchanged.

begin;

alter table property_staff_details
  add column housekeeping_department department;

alter table property_staff_details
  add constraint property_staff_details_housekeeping_department_check
  check (housekeeping_department is null or housekeeping_department in ('reception', 'housekeeping', 'maintenance'));

grant update (housekeeping_department) on property_staff_details to authenticated;

-- current_staff_department() — now Core-aware, mirroring current_staff_role()'s
-- own shape: joins through legacy_property_mapping to find this staff
-- member's Core-side property_staff_details row (if any) and prefers its
-- housekeeping_department override; falls back to the legacy
-- staff_profiles.department column when no override has been set (native
-- accounts predating Team bridging, or a Team-bridged member nobody has
-- explicitly scoped yet -- see current_staff_manages_front_desk() for how
-- that fallback interacts with front-desk visibility).
create or replace function current_staff_department() returns department
language sql security definer stable set search_path = public as $$
  select coalesce(psd.housekeeping_department, sp.department)
  from staff_profiles sp
  join legacy_property_mapping m on m.legacy_hotel_id = sp.hotel_id
  left join property_staff_details psd
    on psd.property_id = m.platform_property_id and psd.profile_id = sp.auth_user_id
  where sp.auth_user_id = auth.uid()
    and sp.active
  limit 1;
$$;

commit;
