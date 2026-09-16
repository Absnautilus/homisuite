-- 20260917110000_request_menu_delete_grants grants authenticated the DELETE
-- privilege on rooms/request_categories/request_types that was missing
-- since these tables were first created -- without it, a delete always hit
-- Postgres' table-level privilege check (42501) before RLS was ever
-- evaluated, which is why the admin "Rimuovi"/delete actions on Camere and
-- Menu richieste never actually removed anything.
--
-- current_staff_hotel()/current_staff_role() are Core-derived (see
-- 20260827122100_guest_requests_authorization_wrapper.sql), not read from
-- staff_profiles.role directly -- fixture mirrors
-- 046_housekeeping_department_override.test.sql's real membership/rank shape
-- rather than the legacy staff_profiles.role column alone.
begin;
create extension if not exists pgtap;
select plan(6);

insert into hotels (id, name, timezone, active) values
  ('00000055-0000-0000-0000-00000000ff01', 'Hotel Uno', 'Europe/Rome', true),
  ('00000055-0000-0000-0000-00000000ff02', 'Hotel Due', 'Europe/Rome', true);
select backfill_legacy_property_mapping();
select backfill_guest_requests_entitlement();

insert into auth.users (id) values ('00000055-0000-0000-0000-000000000a01');
insert into profiles (id, full_name) values ('00000055-0000-0000-0000-000000000a01', 'Admin Uno');
insert into staff_profiles (id, hotel_id, auth_user_id, name, role, department, active, login_username) values
  ('00000055-0000-0000-0000-000000000101', '00000055-0000-0000-0000-00000000ff01', '00000055-0000-0000-0000-000000000a01', 'Admin Uno', 'admin', null, true, null);
insert into memberships (profile_id, property_id, role_id, status)
select '00000055-0000-0000-0000-000000000a01', m.platform_property_id, r.id, 'active'
from legacy_property_mapping m, roles r
where m.legacy_hotel_id = '00000055-0000-0000-0000-00000000ff01' and r.slug = 'property_admin';

insert into rooms (id, hotel_id, room_number) values
  ('00000055-0000-0000-0000-000000000201', '00000055-0000-0000-0000-00000000ff01', '055-A'),
  ('00000055-0000-0000-0000-000000000202', '00000055-0000-0000-0000-00000000ff02', '055-B'); -- another hotel's room

insert into request_categories (id, hotel_id, name, department) values
  ('00000055-0000-0000-0000-000000000301', '00000055-0000-0000-0000-00000000ff01', 'Categoria 055', 'housekeeping');
insert into request_types (id, category_id, name) values
  ('00000055-0000-0000-0000-000000000401', '00000055-0000-0000-0000-000000000301', 'Voce 055');

set local role authenticated;
set local request.jwt.claim.sub = '00000055-0000-0000-0000-000000000a01';

delete from request_types where id = '00000055-0000-0000-0000-000000000401';
select is(
  (select count(*)::int from request_types where id = '00000055-0000-0000-0000-000000000401'),
  0,
  'an admin can now really delete a request_type in their own hotel (previously 42501: no DELETE grant)'
);
delete from request_categories where id = '00000055-0000-0000-0000-000000000301';
select is(
  (select count(*)::int from request_categories where id = '00000055-0000-0000-0000-000000000301'),
  0,
  'an admin can now really delete a request_category in their own hotel, once its items are gone'
);
delete from rooms where id = '00000055-0000-0000-0000-000000000201';
select is(
  (select count(*)::int from rooms where id = '00000055-0000-0000-0000-000000000201'),
  0,
  'an admin can now really delete a room in their own hotel (previously 42501: no DELETE grant)'
);

-- RLS (rooms_admin_write's `for all`) still scopes the new grant to the
-- caller's own hotel -- another hotel's room matches zero rows, not an error.
select lives_ok(
  $$ delete from rooms where id = '00000055-0000-0000-0000-000000000202' $$,
  'deleting another hotel''s room is a no-op, not an error, under the same admin'
);
reset role;

select is(
  (select count(*)::int from rooms where id = '00000055-0000-0000-0000-000000000202'),
  1,
  'the other hotel''s room was not actually deleted -- RLS still scopes the new grant by hotel'
);
select is(
  (select count(*)::int from rooms where id = '00000055-0000-0000-0000-000000000201'),
  0,
  'the caller''s own-hotel room really is gone, not just hidden client-side'
);

select * from finish();
rollback;
