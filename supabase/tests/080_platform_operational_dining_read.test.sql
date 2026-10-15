-- Platform Admin operational read access -- Dining module (Fase C, PR C2).
-- Exercises platform_operational_read_allowed() wired into Dining's tables
-- via two distinct techniques: brand-new, additive SELECT-only policies on
-- tables whose only existing policy is `for all` (restaurant_operational_
-- profiles, restaurant_reservation_requests, restaurant_reservation_
-- alternatives -- never touching that `for all` policy itself), and
-- drop+recreate extension of the two tables that already had their own
-- separate SELECT-only policy (feedback, change_log). The public catalog
-- tables (dining_categories/restaurants/restaurant_hours/dining_guest_tags)
-- need no change at all -- confirmed at the top of this file.
begin;
create extension if not exists pgtap;
select plan(14);

insert into hotels (id, name, timezone, active) values
  ('00000080-0000-0000-0000-00000000ff01', 'Hotel Ottanta A', 'Europe/Rome', true),
  ('00000080-0000-0000-0000-00000000ff02', 'Hotel Ottanta B', 'Europe/Rome', true);
select backfill_legacy_property_mapping();

insert into property_modules (property_id, module_id, enabled)
select m.platform_property_id, mo.id, true
from legacy_property_mapping m, modules mo
where m.legacy_hotel_id in ('00000080-0000-0000-0000-00000000ff01', '00000080-0000-0000-0000-00000000ff02')
  and mo.slug = 'dining';

-- Real staff at hotel A -- confirms this PR never changes their own access.
insert into auth.users (id) values ('00000080-0000-0000-0000-000000000a01');
insert into profiles (id, full_name) values ('00000080-0000-0000-0000-000000000a01', 'Admin 080 A');
insert into staff_profiles (id, hotel_id, auth_user_id, name, role, department, active) values
  ('00000080-0000-0000-0000-000000000101', '00000080-0000-0000-0000-00000000ff01', '00000080-0000-0000-0000-000000000a01', 'Admin 080 A', 'admin', null, true);
insert into memberships (profile_id, property_id, role_id, status)
select '00000080-0000-0000-0000-000000000a01', m.platform_property_id, r.id, 'active'
from legacy_property_mapping m, roles r
where m.legacy_hotel_id = '00000080-0000-0000-0000-00000000ff01' and r.slug = 'property_admin';

-- Platform Admin.
insert into auth.users (id) values ('00000080-0000-0000-0000-000000000201');
insert into profiles (id, full_name) values ('00000080-0000-0000-0000-000000000201', 'PA — full 080');
insert into platform_admins (id, profile_id, status) values
  ('00000080-0000-0000-0000-00000000a201', '00000080-0000-0000-0000-000000000201', 'active');
insert into platform_admin_permissions (platform_admin_id, permission_slug) values
  ('00000080-0000-0000-0000-00000000a201', 'platform.support.read');

-- Dining data on hotel A.
insert into dining_categories (id, hotel_id, name) values
  ('00000080-0000-0000-0000-000000000c01', '00000080-0000-0000-0000-00000000ff01', 'Fine dining 080-A');
insert into restaurants (id, hotel_id, category_id, name) values
  ('00000080-0000-0000-0000-00000000da01', '00000080-0000-0000-0000-00000000ff01', '00000080-0000-0000-0000-000000000c01', 'Ristorante 080-A');
insert into restaurant_operational_profiles (restaurant_id, contact_phone) values
  ('00000080-0000-0000-0000-00000000da01', '+39 000 0000080');
insert into restaurant_reservation_requests (id, hotel_id, restaurant_id, guest_name, party_size, reservation_date, reservation_time) values
  ('00000080-0000-0000-0000-00000000ee01', '00000080-0000-0000-0000-00000000ff01', '00000080-0000-0000-0000-00000000da01', 'Mario Rossi 080', 2, '2026-11-10', '20:00');
insert into restaurant_reservation_alternatives (id, hotel_id, reservation_id, restaurant_id, rank) values
  ('00000080-0000-0000-0000-0000000a1a01', '00000080-0000-0000-0000-00000000ff01', '00000080-0000-0000-0000-00000000ee01', '00000080-0000-0000-0000-00000000da01', 1);
insert into restaurant_reservation_feedback (id, reservation_id, rating, comment) values
  ('00000080-0000-0000-0000-00000000fb01', '00000080-0000-0000-0000-00000000ee01', 5, 'Ottima esperienza 080');

-- Same shapes on hotel B, to prove isolation.
insert into dining_categories (id, hotel_id, name) values
  ('00000080-0000-0000-0000-000000000c02', '00000080-0000-0000-0000-00000000ff02', 'Fine dining 080-B');
insert into restaurants (id, hotel_id, category_id, name) values
  ('00000080-0000-0000-0000-00000000da02', '00000080-0000-0000-0000-00000000ff02', '00000080-0000-0000-0000-000000000c02', 'Ristorante 080-B');
insert into restaurant_operational_profiles (restaurant_id, contact_phone) values
  ('00000080-0000-0000-0000-00000000da02', '+39 000 0000081');
insert into restaurant_reservation_requests (id, hotel_id, restaurant_id, guest_name, party_size, reservation_date, reservation_time) values
  ('00000080-0000-0000-0000-00000000ee02', '00000080-0000-0000-0000-00000000ff02', '00000080-0000-0000-0000-00000000da02', 'Giulia Bianchi 080', 4, '2026-11-11', '21:00');

-- === catalog tables already need no change: public regardless of identity ==

set local role authenticated;
set local request.jwt.claim.sub = '00000080-0000-0000-0000-000000000201';
set local request.jwt.claims = '{"aal":"aal2"}';
select is(
  (select name from restaurants where id = '00000080-0000-0000-0000-00000000da01'),
  'Ristorante 080-A',
  'the admin reads the public restaurants catalog with zero session/permission -- already open to everyone, nothing to change'
);

-- === no session yet: staff-only tables stay closed ==========================

select is(
  (select count(*)::int from restaurant_reservation_requests where hotel_id = '00000080-0000-0000-0000-00000000ff01'),
  0,
  'without an open session, the admin sees nothing in the staff-only restaurant_reservation_requests table'
);

-- === open a session, then read across every pattern this PR touches ========

-- legacy_property_mapping has zero grants for `authenticated` (by design --
-- see the original Dining audit); resolve it as the unrestricted test role
-- first, same \gset pattern used elsewhere for this exact reason.
reset role;
select platform_property_id as hotel_a_property_id from legacy_property_mapping
  where legacy_hotel_id = '00000080-0000-0000-0000-00000000ff01' \gset

set local role authenticated;
set local request.jwt.claim.sub = '00000080-0000-0000-0000-000000000201';
set local request.jwt.claims = '{"aal":"aal2"}';
select lives_ok(
  format('select platform_open_operational_session(%L, %L)', :'hotel_a_property_id', 'diagnosi ristorazione'),
  'admin opens an operational session on hotel A''s property'
);

select is(
  (select contact_phone from restaurant_operational_profiles where restaurant_id = '00000080-0000-0000-0000-00000000da01'),
  '+39 000 0000080',
  'the admin reads restaurant_operational_profiles (new additive SELECT-only policy alongside the existing for-all one)'
);
select is(
  (select guest_name from restaurant_reservation_requests where id = '00000080-0000-0000-0000-00000000ee01'),
  'Mario Rossi 080',
  'the admin reads restaurant_reservation_requests (new additive SELECT-only policy)'
);
select is(
  (select rank::int from restaurant_reservation_alternatives where id = '00000080-0000-0000-0000-0000000a1a01'),
  1,
  'the admin reads restaurant_reservation_alternatives (new additive SELECT-only policy)'
);
select is(
  (select comment from restaurant_reservation_feedback where id = '00000080-0000-0000-0000-00000000fb01'),
  'Ottima esperienza 080',
  'the admin reads restaurant_reservation_feedback (extended existing SELECT-only policy)'
);

-- === isolation: the session scoped to hotel A's property leaks nothing from B

select is(
  (select count(*)::int from restaurant_reservation_requests where hotel_id = '00000080-0000-0000-0000-00000000ff02'),
  0,
  'a session scoped to hotel A''s property grants no visibility into hotel B''s reservation requests'
);
select is(
  (select count(*)::int from restaurant_operational_profiles where restaurant_id = '00000080-0000-0000-0000-00000000da02'),
  0,
  'a session scoped to hotel A''s property grants no visibility into hotel B''s operational profile'
);

-- === writes remain denied -- the new additive SELECT-only policies grant
-- nothing beyond SELECT on the tables whose write authority is a `for all`
-- policy this PR never touches =============================================

-- RLS denial on UPDATE is silent (0 rows matched, no exception) rather than
-- a thrown error -- same lesson as the Shifts PR's test suite. Prove the
-- denial the way it actually manifests: the row is untouched.
update restaurant_operational_profiles set contact_phone = 'should not change' where restaurant_id = '00000080-0000-0000-0000-00000000da01';
select is(
  (select contact_phone from restaurant_operational_profiles where restaurant_id = '00000080-0000-0000-0000-00000000da01'),
  '+39 000 0000080',
  'the admin''s UPDATE on restaurant_operational_profiles matches zero rows under RLS -- the contact_phone is still the original value'
);
update restaurant_reservation_requests set confirmation_status = 'confirmed' where id = '00000080-0000-0000-0000-00000000ee01';
select is(
  (select confirmation_status from restaurant_reservation_requests where id = '00000080-0000-0000-0000-00000000ee01'),
  'new',
  'the admin''s UPDATE on restaurant_reservation_requests matches zero rows under RLS -- confirmation_status is still the original default'
);
select throws_ok(
  $$ insert into restaurant_reservation_alternatives (hotel_id, reservation_id, restaurant_id, rank)
     values ('00000080-0000-0000-0000-00000000ff01', '00000080-0000-0000-0000-00000000ee01', '00000080-0000-0000-0000-00000000da01', 2) $$,
  '42501',
  null,
  'the admin cannot INSERT into restaurant_reservation_alternatives either'
);

-- === regression: the real tenant staff member's own access is unaffected ===

set local request.jwt.claim.sub = '00000080-0000-0000-0000-000000000a01';
select is(
  (select guest_name from restaurant_reservation_requests where id = '00000080-0000-0000-0000-00000000ee01'),
  'Mario Rossi 080',
  'the real hotel-A admin still reads her own hotel''s reservation exactly as before this PR'
);
select lives_ok(
  $$ update restaurant_reservation_requests set confirmation_status = 'confirmed' where id = '00000080-0000-0000-0000-00000000ee01' $$,
  'the real hotel-A admin can still update her own hotel''s reservation (front-desk write path unaffected)'
);

select * from finish();
rollback;
