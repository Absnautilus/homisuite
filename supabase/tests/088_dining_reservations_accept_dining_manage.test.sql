-- 20261107100000_dining_reservations_accept_dining_manage: found live --
-- a Receptionist (role slug 'receptionist') individually granted
-- dining.manage through Team's own per-member permission grants (exactly
-- the permission the Aggiungi-prenotazione UI gates its button on) was
-- denied by restaurant_reservation_requests' only policy, which only ever
-- recognized the separate, legacy front-desk check (staff_profiles role
-- admin/master, or role 'operatore' with department = 'reception' -- a
-- field nothing in Team's UI sets). The policy covers select too, so she
-- didn't even get an error on the list -- it was silently empty.
begin;
create extension if not exists pgtap;
select plan(7);

insert into hotels (id, name, timezone, active) values
  ('00000088-0000-0000-0000-00000000ff01', 'Hotel Ottantotto', 'Europe/Rome', true);
select backfill_legacy_property_mapping();

insert into property_modules (property_id, module_id, enabled)
select m.platform_property_id, mo.id, true
from legacy_property_mapping m, modules mo
where m.legacy_hotel_id = '00000088-0000-0000-0000-00000000ff01' and mo.slug = 'dining';

reset role;
select m.platform_property_id as fixture_property_id
  from legacy_property_mapping m
 where m.legacy_hotel_id = '00000088-0000-0000-0000-00000000ff01' \gset

insert into dining_categories (id, hotel_id, name) values
  ('00000088-0000-0000-0000-000000000c01', '00000088-0000-0000-0000-00000000ff01', 'Fine dining');
insert into restaurants (id, hotel_id, category_id, name) values
  ('00000088-0000-0000-0000-0000000da001', '00000088-0000-0000-0000-00000000ff01', '00000088-0000-0000-0000-000000000c01', 'Osteria 88');

-- Receptionist A: the legacy front-desk path, unaffected by this fix --
-- staff_profiles role 'operatore' + department 'reception', NO dining.manage.
insert into auth.users (id) values ('00000088-0000-0000-0000-000000000a01');
insert into profiles (id, full_name) values ('00000088-0000-0000-0000-000000000a01', 'Reception 87 A');
insert into staff_profiles (id, hotel_id, auth_user_id, name, role, department, active, login_username) values
  ('00000088-0000-0000-0000-000000000101', '00000088-0000-0000-0000-00000000ff01', '00000088-0000-0000-0000-000000000a01', 'Reception 87 A', 'operatore', 'reception', true, 'test088.rec');
insert into memberships (profile_id, property_id, role_id, status)
select '00000088-0000-0000-0000-000000000a01', :'fixture_property_id'::uuid, r.id, 'active'
from roles r where r.slug = 'receptionist';

-- Receptionist B: the exact bug -- role 'receptionist' membership, department
-- left null (nothing in Team's UI sets it), but individually granted
-- dining.manage the same way Team's per-member grants work in production.
insert into auth.users (id) values ('00000088-0000-0000-0000-000000000a02');
insert into profiles (id, full_name) values ('00000088-0000-0000-0000-000000000a02', 'Reception 87 B');
insert into memberships (id, profile_id, property_id, role_id, status)
select '00000088-0000-0000-0000-000000000102', '00000088-0000-0000-0000-000000000a02', :'fixture_property_id'::uuid, r.id, 'active'
from roles r where r.slug = 'receptionist';
insert into membership_permission_grants (membership_id, permission_id)
select '00000088-0000-0000-0000-000000000102', p.id from permissions p where p.slug = 'dining.manage';

-- Receptionist C: role 'receptionist', department null, NO dining.manage
-- grant either -- proves this fix is not a blanket bypass for the role.
insert into auth.users (id) values ('00000088-0000-0000-0000-000000000a03');
insert into profiles (id, full_name) values ('00000088-0000-0000-0000-000000000a03', 'Reception 87 C');
insert into memberships (profile_id, property_id, role_id, status)
select '00000088-0000-0000-0000-000000000a03', :'fixture_property_id'::uuid, r.id, 'active'
from roles r where r.slug = 'receptionist';

set local role authenticated;

-- ### A: legacy front-desk path still works, completely unaffected ###
set local request.jwt.claim.sub = '00000088-0000-0000-0000-000000000a01';
select lives_ok(
  $$ insert into restaurant_reservation_requests (hotel_id, restaurant_id, guest_name, party_size, reservation_date, reservation_time)
     values ('00000088-0000-0000-0000-00000000ff01', '00000088-0000-0000-0000-0000000da001', 'Ospite A', 2, current_date, '20:00') $$,
  'receptionist A (legacy front-desk department) can still insert a reservation, unaffected by this fix'
);

-- ### B: the actual fix -- dining.manage grant alone is now enough ###
set local request.jwt.claim.sub = '00000088-0000-0000-0000-000000000a02';
select lives_ok(
  $$ insert into restaurant_reservation_requests (id, hotel_id, restaurant_id, guest_name, party_size, reservation_date, reservation_time)
     values ('00000088-0000-0000-0000-0000000db001', '00000088-0000-0000-0000-00000000ff01', '00000088-0000-0000-0000-0000000da001', 'Ospite B', 2, current_date, '20:30') $$,
  'receptionist B (dining.manage grant, no front-desk department) can now insert -- the bug this migration fixes'
);
select isnt_empty(
  $$ select 1 from restaurant_reservation_requests where id = '00000088-0000-0000-0000-0000000db001' $$,
  'receptionist B can also select the reservation she just created (same policy used to silently empty her whole list)'
);
select lives_ok(
  $$ update restaurant_reservation_requests set confirmation_status = 'confirmed' where id = '00000088-0000-0000-0000-0000000db001' $$,
  'receptionist B can update it too (status changes use the same policy)'
);

-- ### C: neither path -- still denied, proving this is not a blanket bypass ###
set local request.jwt.claim.sub = '00000088-0000-0000-0000-000000000a03';
select throws_ok(
  $$ insert into restaurant_reservation_requests (hotel_id, restaurant_id, guest_name, party_size, reservation_date, reservation_time)
     values ('00000088-0000-0000-0000-00000000ff01', '00000088-0000-0000-0000-0000000da001', 'Ospite C', 2, current_date, '21:00') $$,
  '42501',
  null,
  'receptionist C (neither front-desk department nor dining.manage) is still denied'
);
select is(
  (select count(*)::int from restaurant_reservation_requests where hotel_id = '00000088-0000-0000-0000-00000000ff01'),
  0,
  'receptionist C cannot even SELECT the two reservations A and B created -- the same policy denies her read, same as before this fix, no new leak'
);

reset role;
select is(
  (select count(*)::int from restaurant_reservation_requests where hotel_id = '00000088-0000-0000-0000-00000000ff01'),
  2,
  'exactly the two reservations A and B created landed in the table -- C never got one in'
);

select * from finish();
rollback;
