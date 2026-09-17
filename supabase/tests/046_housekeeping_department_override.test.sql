-- Reproduces and fixes the real gap found via Francesco Breda's account:
-- a Team-bridged Housekeeping profile (staff_profiles.role forced to
-- 'admin' by grant-housekeeping-access, department left unset) whose real
-- Core-side access is receptionist-rank (rank 10, not property_admin's 30)
-- silently loses front-desk visibility once current_staff_role() derives
-- from Core rank instead of the legacy role column -- current_staff_department()
-- had no Core-aware fallback of its own, so the department-scoped branch
-- had nothing to check against. property_staff_details.housekeeping_department
-- gives an admin an explicit, Core-side way to scope (or widen) that,
-- independent of the free-text "Mansione" job title.
--
-- "Front desk" here is proven against `stays`, not `guest_requests` --
-- as of 20260917120000_request_categories_job_titles, guest_requests
-- visibility is mansione-based and no longer reads current_staff_department()/
-- current_staff_manages_front_desk() at all (see
-- 026_guest_requests_cross_tenant_department.test.sql for that).
begin;
create extension if not exists pgtap;
select plan(9);

insert into hotels (id, name, timezone, active) values
  ('00000046-0000-0000-0000-00000000ff01', 'Hotel Quarantasei', 'Europe/Rome', true);
select backfill_legacy_property_mapping();
select backfill_guest_requests_entitlement();

insert into request_categories (id, hotel_id, name, department) values
  ('00000046-0000-0000-0000-000000000c01', '00000046-0000-0000-0000-00000000ff01', 'Housekeeping', 'housekeeping'),
  ('00000046-0000-0000-0000-000000000c02', '00000046-0000-0000-0000-00000000ff01', 'Maintenance', 'maintenance');
insert into request_types (id, category_id, name) values
  ('00000046-0000-0000-0000-0000000fee01', '00000046-0000-0000-0000-000000000c01', 'Asciugamani'),
  ('00000046-0000-0000-0000-0000000fee02', '00000046-0000-0000-0000-000000000c02', 'Riparazione');
insert into rooms (id, hotel_id, room_number) values
  ('00000046-0000-0000-0000-0000000fa001', '00000046-0000-0000-0000-00000000ff01', '101'),
  ('00000046-0000-0000-0000-0000000fa002', '00000046-0000-0000-0000-00000000ff01', '102');
insert into guest_requests (id, hotel_id, room_number, request_type_id, quantity, assigned_department, status) values
  ('00000046-0000-0000-0000-00000000ba01', '00000046-0000-0000-0000-00000000ff01', '101', '00000046-0000-0000-0000-0000000fee01', 1, 'housekeeping', 'requested'),
  ('00000046-0000-0000-0000-00000000ba02', '00000046-0000-0000-0000-00000000ff01', '102', '00000046-0000-0000-0000-0000000fee02', 1, 'maintenance', 'requested');
-- A stay, not a guest_request, is what actually still exercises
-- current_staff_manages_front_desk() as of 20260917120000_request_categories_job_titles
-- (guest_requests visibility is mansione-based now, unrelated to this
-- override -- see 026_guest_requests_cross_tenant_department.test.sql).
insert into stays (id, hotel_id, room_id, guest_last_name, check_in_at, check_out_at) values
  ('00000046-0000-0000-0000-00000000ba03', '00000046-0000-0000-0000-00000000ff01', '00000046-0000-0000-0000-0000000fa001', 'Rossi', now() - interval '1 day', now() + interval '1 day');

-- the Team-bridged member: role forced to 'admin' (as
-- grant-housekeeping-access always does), department left unset -- exactly
-- Francesco's real shape.
insert into auth.users (id) values ('00000046-0000-0000-0000-000000000a01');
insert into profiles (id, full_name) values ('00000046-0000-0000-0000-000000000a01', 'Bridged Member');
insert into staff_profiles (id, hotel_id, auth_user_id, name, role, department, active, login_username) values
  ('00000046-0000-0000-0000-000000000101', '00000046-0000-0000-0000-00000000ff01', '00000046-0000-0000-0000-000000000a01', 'Bridged Member', 'admin', null, true, null);

-- their REAL Core-side access is receptionist-rank (10), not
-- property_admin (30) -- deliberately NOT using backfill_staff_identity()
-- here, since a Team-bridged member's Core membership already exists
-- independently of that legacy one-time backfill.
insert into memberships (profile_id, property_id, role_id, status)
select '00000046-0000-0000-0000-000000000a01', m.platform_property_id, r.id, 'active'
from legacy_property_mapping m, roles r
where m.legacy_hotel_id = '00000046-0000-0000-0000-00000000ff01' and r.slug = 'receptionist';

-- the admin who will grant the department override: property_admin-rank
insert into auth.users (id) values ('00000046-0000-0000-0000-000000000a02');
insert into profiles (id, full_name) values ('00000046-0000-0000-0000-000000000a02', 'Property Admin');
insert into memberships (profile_id, property_id, role_id, status)
select '00000046-0000-0000-0000-000000000a02', m.platform_property_id, r.id, 'active'
from legacy_property_mapping m, roles r
where m.legacy_hotel_id = '00000046-0000-0000-0000-00000000ff01' and r.slug = 'property_admin';

-- ### before any override: reproduces the bug ###
set local role authenticated;
set local request.jwt.claim.sub = '00000046-0000-0000-0000-000000000a01';
select is(current_staff_role(), 'operatore'::staff_role, 'the bridged member''s Core-derived role is operatore (receptionist rank), not admin -- the legacy role column is not consulted');
select is(current_staff_department(), null, 'with no override and no legacy department, current_staff_department() is null');
select is((select count(*)::int from stays), 0, 'reproduces the bug: sees zero stays with no department resolvable (front-desk gate)');
reset role;

-- The row itself is created here as the connecting (superuser) role, not
-- attributed to a02's session -- legacy_property_mapping is backend
-- bookkeeping revoked from authenticated/anon entirely (see
-- 20260827122500), so resolving platform_property_id has to happen before
-- switching into an authenticated session below. What's actually under
-- test (the outsider's UPDATE being denied, the admin's own UPDATE
-- succeeding) never needs to touch legacy_property_mapping itself -- both
-- match this row by profile_id alone, unique within this fixture.
insert into property_staff_details (property_id, profile_id)
select m.platform_property_id, '00000046-0000-0000-0000-000000000a01'
from legacy_property_mapping m where m.legacy_hotel_id = '00000046-0000-0000-0000-00000000ff01';

-- ### an outsider (no core.staff.manage on this property) cannot set the override ###
insert into auth.users (id) values ('00000046-0000-0000-0000-000000000a03');
insert into profiles (id, full_name) values ('00000046-0000-0000-0000-000000000a03', 'Outsider');
set local role authenticated;
set local request.jwt.claim.sub = '00000046-0000-0000-0000-000000000a03';
with upd as (
  update property_staff_details set housekeeping_department = 'reception'
  where profile_id = '00000046-0000-0000-0000-000000000a01'
  returning 1
)
select is(
  (select count(*)::int from upd),
  0,
  'an outsider without core.staff.manage cannot set the override on the real, already-existing row'
);
reset role;

-- ### the property_admin sets the override to reception -- widens to front desk ###
set local role authenticated;
set local request.jwt.claim.sub = '00000046-0000-0000-0000-000000000a02';
update property_staff_details set housekeeping_department = 'reception'
where profile_id = '00000046-0000-0000-0000-000000000a01';
reset role;

set local role authenticated;
set local request.jwt.claim.sub = '00000046-0000-0000-0000-000000000a01';
select is(current_staff_department(), 'reception'::department, 'the override now resolves through current_staff_department()');
select ok(current_staff_manages_front_desk(), 'reception override makes the bridged member front-desk');
select is((select count(*)::int from stays), 1, 'now sees the stay as front desk');
reset role;

-- ### narrowing instead: property_admin scopes them to housekeeping only ###
set local role authenticated;
set local request.jwt.claim.sub = '00000046-0000-0000-0000-000000000a02';
update property_staff_details set housekeeping_department = 'housekeeping'
where profile_id = '00000046-0000-0000-0000-000000000a01';
reset role;

set local role authenticated;
set local request.jwt.claim.sub = '00000046-0000-0000-0000-000000000a01';
select ok(not current_staff_manages_front_desk(), 'narrowed to housekeeping: no longer front-desk (department is not reception)');
select is((select count(*)::int from stays), 0, 'narrowed to housekeeping: no longer sees the stay');
reset role;

select * from finish();
rollback;
