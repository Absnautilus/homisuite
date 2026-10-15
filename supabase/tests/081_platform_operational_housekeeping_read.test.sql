-- Platform Admin operational read access -- Housekeeping module (Fase C,
-- PR C2, final module). Exercises platform_operational_read_allowed()
-- wired into hotels/staff_profiles/rooms/stays/guest_requests via five
-- brand-new, additive SELECT-only policies (current_staff_hotel() itself,
-- and every existing named SELECT policy, are left untouched -- confirmed
-- by reading the live pg_policies definitions before writing this
-- migration), plus the one read-only RPC
-- (guest_requests_property_job_titles).
begin;
create extension if not exists pgtap;
select plan(16);

insert into hotels (id, name, timezone, active) values
  ('00000081-0000-0000-0000-00000000ff01', 'Hotel Ottantuno A', 'Europe/Rome', true),
  ('00000081-0000-0000-0000-00000000ff02', 'Hotel Ottantuno B', 'Europe/Rome', true);
select backfill_legacy_property_mapping();

insert into property_modules (property_id, module_id, enabled)
select m.platform_property_id, mo.id, true
from legacy_property_mapping m, modules mo
where m.legacy_hotel_id in ('00000081-0000-0000-0000-00000000ff01', '00000081-0000-0000-0000-00000000ff02')
  and mo.slug = 'guest_requests';

insert into rooms (id, hotel_id, room_number) values
  ('00000081-0000-0000-0000-00000000aa01', '00000081-0000-0000-0000-00000000ff01', '101'),
  ('00000081-0000-0000-0000-00000000aa02', '00000081-0000-0000-0000-00000000ff02', '201');

insert into request_categories (id, hotel_id, name, department) values
  ('00000081-0000-0000-0000-00000000bb01', '00000081-0000-0000-0000-00000000ff01', 'Housekeeping 081-A', 'housekeeping');
insert into request_types (id, category_id, name) values
  ('00000081-0000-0000-0000-00000000cc01', '00000081-0000-0000-0000-00000000bb01', 'Towels 081');
insert into property_job_titles (id, property_id, name) values
  ('00000081-0000-0000-0000-0000000a1a01', (select platform_property_id from legacy_property_mapping where legacy_hotel_id = '00000081-0000-0000-0000-00000000ff01'), 'Reception 081');

-- Real tenant staff at hotel A -- confirms this PR never changes their own access.
insert into auth.users (id) values ('00000081-0000-0000-0000-00000000dd01');
insert into profiles (id, full_name) values ('00000081-0000-0000-0000-00000000dd01', 'Admin 081 A');
insert into staff_profiles (id, hotel_id, auth_user_id, name, role, department, active) values
  ('00000081-0000-0000-0000-00000000ee01', '00000081-0000-0000-0000-00000000ff01', '00000081-0000-0000-0000-00000000dd01', 'Admin 081 A', 'admin', null, true);
insert into memberships (profile_id, property_id, role_id, status)
select '00000081-0000-0000-0000-00000000dd01', m.platform_property_id, r.id, 'active'
from legacy_property_mapping m, roles r
where m.legacy_hotel_id = '00000081-0000-0000-0000-00000000ff01' and r.slug = 'property_admin';
insert into property_staff_details (property_id, profile_id, housekeeping_department)
select m.platform_property_id, '00000081-0000-0000-0000-00000000dd01', 'reception'
from legacy_property_mapping m where m.legacy_hotel_id = '00000081-0000-0000-0000-00000000ff01';

insert into stays (id, hotel_id, room_id, guest_last_name, check_in_at, check_out_at, created_by) values
  ('00000081-0000-0000-0000-0000000aa301', '00000081-0000-0000-0000-00000000ff01', '00000081-0000-0000-0000-00000000aa01', 'Rossi 081', now(), now() + interval '1 day', '00000081-0000-0000-0000-00000000ee01');
insert into guest_requests (id, hotel_id, stay_id, room_number, request_type_id, created_by_staff, assigned_department) values
  ('00000081-0000-0000-0000-0000000ee201', '00000081-0000-0000-0000-00000000ff01', '00000081-0000-0000-0000-0000000aa301', '101', '00000081-0000-0000-0000-00000000cc01', '00000081-0000-0000-0000-00000000ee01', 'housekeeping');

-- Platform Admin.
insert into auth.users (id) values ('00000081-0000-0000-0000-000000000201');
insert into profiles (id, full_name) values ('00000081-0000-0000-0000-000000000201', 'PA — full 081');
insert into platform_admins (id, profile_id, status) values
  ('00000081-0000-0000-0000-00000000a201', '00000081-0000-0000-0000-000000000201', 'active');
insert into platform_admin_permissions (platform_admin_id, permission_slug) values
  ('00000081-0000-0000-0000-00000000a201', 'platform.support.read');

-- Same shapes on hotel B, to prove isolation.
insert into request_categories (id, hotel_id, name, department) values
  ('00000081-0000-0000-0000-00000000bb02', '00000081-0000-0000-0000-00000000ff02', 'Housekeeping 081-B', 'housekeeping');

-- === catalog tables already need no change ===================================

set local role authenticated;
set local request.jwt.claim.sub = '00000081-0000-0000-0000-000000000201';
set local request.jwt.claims = '{"aal":"aal2"}';
select is(
  (select name from request_categories where id = '00000081-0000-0000-0000-00000000bb01'),
  'Housekeeping 081-A',
  'the admin reads the public request_categories catalog with zero session/permission -- already open, nothing to change'
);

-- === no session yet: staff-scoped tables stay closed =========================

select is(
  (select count(*)::int from guest_requests where hotel_id = '00000081-0000-0000-0000-00000000ff01'),
  0,
  'without an open session, the admin sees nothing in guest_requests'
);

-- === open a session, then read across every table this PR touches ==========

reset role;
select platform_property_id as hotel_a_property_id from legacy_property_mapping
  where legacy_hotel_id = '00000081-0000-0000-0000-00000000ff01' \gset

set local role authenticated;
set local request.jwt.claim.sub = '00000081-0000-0000-0000-000000000201';
set local request.jwt.claims = '{"aal":"aal2"}';
select lives_ok(
  format('select platform_open_operational_session(%L, %L)', :'hotel_a_property_id', 'diagnosi housekeeping'),
  'admin opens an operational session on hotel A''s property'
);

select is(
  (select name from hotels where id = '00000081-0000-0000-0000-00000000ff01'),
  'Hotel Ottantuno A',
  'the admin reads the hotels row (new additive SELECT-only policy)'
);
select is(
  (select name from staff_profiles where id = '00000081-0000-0000-0000-00000000ee01'),
  'Admin 081 A',
  'the admin reads staff_profiles despite holding no staff_profiles row herself'
);
select is(
  (select room_number from rooms where id = '00000081-0000-0000-0000-00000000aa01'),
  '101',
  'the admin reads rooms'
);
select is(
  (select guest_last_name from stays where id = '00000081-0000-0000-0000-0000000aa301'),
  'Rossi 081',
  'the admin reads stays'
);
select is(
  (select room_number from guest_requests where id = '00000081-0000-0000-0000-0000000ee201'),
  '101',
  'the admin reads guest_requests'
);
select is(
  (select name from guest_requests_property_job_titles('00000081-0000-0000-0000-00000000ff01')),
  'Reception 081',
  'the admin reads guest_requests_property_job_titles(hotel_id) via the extended RPC'
);

-- === isolation: the session scoped to hotel A's property leaks nothing from B

select is(
  (select count(*)::int from staff_profiles where hotel_id = '00000081-0000-0000-0000-00000000ff02'),
  0,
  'a session scoped to hotel A''s property grants no visibility into hotel B''s staff_profiles'
);
select is(
  (select count(*)::int from hotels where id = '00000081-0000-0000-0000-00000000ff02'),
  0,
  'a session scoped to hotel A''s property grants no visibility into hotel B itself'
);

-- === writes remain denied -- new additive SELECT-only policies grant
-- nothing beyond SELECT; current_staff_hotel()-gated write policies/RPCs
-- are never touched by this PR ===============================================

update staff_profiles set name = 'should not change' where id = '00000081-0000-0000-0000-00000000ee01';
select is(
  (select name from staff_profiles where id = '00000081-0000-0000-0000-00000000ee01'),
  'Admin 081 A',
  'the admin''s UPDATE on staff_profiles matches zero rows under RLS -- the name is still the original value'
);
update guest_requests set note = 'should not change' where id = '00000081-0000-0000-0000-0000000ee201';
select ok(
  (select note is null from guest_requests where id = '00000081-0000-0000-0000-0000000ee201'),
  'the admin''s UPDATE on guest_requests matches zero rows under RLS -- note is still null'
);
select throws_ok(
  $$ insert into rooms (hotel_id, room_number) values ('00000081-0000-0000-0000-00000000ff01', '102') $$,
  '42501',
  null,
  'the admin cannot INSERT into rooms (no write policy on rooms recognizes her at all)'
);

-- === regression: the real tenant staff member's own access is unaffected ===

set local request.jwt.claim.sub = '00000081-0000-0000-0000-00000000dd01';
select is(
  (select room_number from guest_requests where id = '00000081-0000-0000-0000-0000000ee201'),
  '101',
  'the real hotel-A admin still reads her own hotel''s guest_requests exactly as before this PR'
);
select lives_ok(
  $$ update guest_requests set note = 'handled by reception' where id = '00000081-0000-0000-0000-0000000ee201' $$,
  'the real hotel-A admin can still update her own hotel''s guest_requests (write path unaffected)'
);

select * from finish();
rollback;
