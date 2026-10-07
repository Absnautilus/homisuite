-- 20261006100000_dining_concierge_workflow: curated/operational restaurant
-- fields, the richer reservation-status set, authorized alternatives, the
-- guest-tag vocabulary, and post-dinner feedback. Builds on 058's fixtures
-- (same hotel/staff shape) since this migration only extends tables 058
-- already exercises end-to-end — the isolation/entitlement/admin-only
-- behavior those columns inherit is 058's job, not re-proven here.
--
-- A SECOND hotel is fixtured specifically for the composite-FK/RLS
-- hardening this migration adds to restaurant_reservation_alternatives and
-- restaurant_reservation_requests -- single-hotel fixtures can prove a
-- feature works, never that tenant isolation holds, since there's nothing
-- else for a bug to leak across.
begin;
create extension if not exists pgtap;
select plan(27);

insert into hotels (id, name, timezone, active) values
  ('00000068-0000-0000-0000-00000000ff01', 'Hotel Sessantotto', 'Europe/Rome', true),
  ('00000068-0000-0000-0000-00000000ff02', 'Hotel Sessantotto Due', 'Europe/Rome', true);
select backfill_legacy_property_mapping();

insert into property_modules (property_id, module_id, enabled)
select m.platform_property_id, mo.id, true
from legacy_property_mapping m, modules mo
where m.legacy_hotel_id in ('00000068-0000-0000-0000-00000000ff01', '00000068-0000-0000-0000-00000000ff02')
  and mo.slug = 'dining';

insert into auth.users (id) values
  ('00000068-0000-0000-0000-000000000a01'), -- admin, hotel A
  ('00000068-0000-0000-0000-000000000a02'), -- reception operatore, hotel A
  ('00000068-0000-0000-0000-000000000a03'); -- admin, hotel B

insert into profiles (id, full_name) values
  ('00000068-0000-0000-0000-000000000a01', 'Admin 68 A'),
  ('00000068-0000-0000-0000-000000000a02', 'Reception 68 A'),
  ('00000068-0000-0000-0000-000000000a03', 'Admin 68 B');

insert into staff_profiles (id, hotel_id, auth_user_id, name, role, department, active, login_username) values
  ('00000068-0000-0000-0000-000000000101', '00000068-0000-0000-0000-00000000ff01', '00000068-0000-0000-0000-000000000a01', 'Admin 68 A', 'admin', null, true, null),
  ('00000068-0000-0000-0000-000000000102', '00000068-0000-0000-0000-00000000ff01', '00000068-0000-0000-0000-000000000a02', 'Reception 68 A', 'operatore', 'reception', true, 'test068.rec'),
  ('00000068-0000-0000-0000-000000000103', '00000068-0000-0000-0000-00000000ff02', '00000068-0000-0000-0000-000000000a03', 'Admin 68 B', 'admin', null, true, null);

insert into memberships (profile_id, property_id, role_id, status)
select '00000068-0000-0000-0000-000000000a01', m.platform_property_id, r.id, 'active'
from legacy_property_mapping m, roles r
where m.legacy_hotel_id = '00000068-0000-0000-0000-00000000ff01' and r.slug = 'property_admin';
insert into memberships (profile_id, property_id, role_id, status)
select '00000068-0000-0000-0000-000000000a02', m.platform_property_id, r.id, 'active'
from legacy_property_mapping m, roles r
where m.legacy_hotel_id = '00000068-0000-0000-0000-00000000ff01' and r.slug = 'receptionist';
insert into memberships (profile_id, property_id, role_id, status)
select '00000068-0000-0000-0000-000000000a03', m.platform_property_id, r.id, 'active'
from legacy_property_mapping m, roles r
where m.legacy_hotel_id = '00000068-0000-0000-0000-00000000ff02' and r.slug = 'property_admin';

insert into dining_categories (id, hotel_id, name) values
  ('00000068-0000-0000-0000-000000000c01', '00000068-0000-0000-0000-00000000ff01', 'Fine dining'),
  ('00000068-0000-0000-0000-000000000c02', '00000068-0000-0000-0000-00000000ff02', 'Fine dining B');

-- ### admin can set the new curated fields directly on restaurants ###
set local role authenticated;
set local request.jwt.claim.sub = '00000068-0000-0000-0000-000000000a01';
insert into restaurants (
  id, hotel_id, category_id, name, cuisine, price_tier, walk_minutes,
  short_description, guest_tags, is_recommended, concierge_description, ideal_for, guest_profile
) values (
  '00000068-0000-0000-0000-0000000da001', '00000068-0000-0000-0000-00000000ff01', '00000068-0000-0000-0000-000000000c01', 'Oniga',
  'Giapponese', 3, 8, 'Cucina giapponese contemporanea.', array['Romantico', 'Sushi'], true,
  'Ambiente intimo, ottimo per coppie.', 'Coppie, cene tranquille', 'Romantico, elegante'
);
reset role;
select is(
  (select row(cuisine, price_tier, is_recommended, guest_tags) from restaurants where id = '00000068-0000-0000-0000-0000000da001'),
  row('Giapponese'::text, 3::smallint, true::boolean, array['Romantico', 'Sushi']::text[]),
  'curated fields were saved on the restaurant row'
);

-- ### price_tier is constrained to 1..4 ###
select throws_ok(
  $$ insert into restaurants (hotel_id, category_id, name, price_tier) values ('00000068-0000-0000-0000-00000000ff01', '00000068-0000-0000-0000-000000000c01', 'X', 5) $$,
  '23514',
  null,
  'price_tier rejects a value outside 1..4'
);

-- ### anon can read the new curated/guest-facing columns -- same public
--     read boundary as the rest of `restaurants` (see this migration's own
--     "human decision on record" header comment) ###
set local role anon;
select is(
  (select concierge_description from restaurants where id = '00000068-0000-0000-0000-0000000da001'),
  'Ambiente intimo, ottimo per coppie.',
  'anon can read the guest-facing concierge_description'
);
reset role;

-- ### restaurant_operational_profiles: admin can write it ###
set local role authenticated;
set local request.jwt.claim.sub = '00000068-0000-0000-0000-000000000a01';
insert into restaurant_operational_profiles (restaurant_id, contact_person, commercial_agreement, commission_rate)
values ('00000068-0000-0000-0000-0000000da001', 'Luca (maitre)', 'partner_commission', 10.00);
reset role;
select is(
  (select row(contact_person, commercial_agreement, commission_rate) from restaurant_operational_profiles where restaurant_id = '00000068-0000-0000-0000-0000000da001'),
  row('Luca (maitre)'::text, 'partner_commission'::text, 10.00::numeric),
  'admin saved the operational profile'
);

-- ### commission_rate is constrained to 0..100 -- a FRESH restaurant_id is
--     used here specifically so the insert fails on the CHECK this test
--     means to exercise, not on the table's own restaurant_id PK (which a
--     second row for '...da001' would hit first, proving nothing about
--     commission_rate at all) ###
insert into restaurants (id, hotel_id, category_id, name) values
  ('00000068-0000-0000-0000-0000000da002', '00000068-0000-0000-0000-00000000ff01', '00000068-0000-0000-0000-000000000c01', 'Estro');
select throws_ok(
  $$ insert into restaurant_operational_profiles (restaurant_id, commission_rate) values ('00000068-0000-0000-0000-0000000da002', 150) $$,
  '23514',
  null,
  'commission_rate rejects a value above 100 (the CHECK itself, proven on a restaurant with no existing profile row)'
);

-- ### anon can NEVER read restaurant_operational_profiles -- no anon grant
--     at all, regardless of the restaurant's own public visibility ###
set local role anon;
select is(
  (select count(*)::int from restaurant_operational_profiles),
  0,
  'anon cannot read operational profiles -- no table grant exists for anon'
);
reset role;

-- ### a non-admin operatore cannot write the operational profile either --
--     RLS filters the row out of the UPDATE's own WHERE match (same
--     no-error, no-effect shape as 058's cross-hotel UPDATE case), so the
--     assertion is "nothing changed", not a thrown exception ###
set local role authenticated;
set local request.jwt.claim.sub = '00000068-0000-0000-0000-000000000a02';
update restaurant_operational_profiles set contact_person = 'Hijacked' where restaurant_id = '00000068-0000-0000-0000-0000000da001';
reset role;
select is(
  (select contact_person from restaurant_operational_profiles where restaurant_id = '00000068-0000-0000-0000-0000000da001'),
  'Luca (maitre)',
  'reception operatore cannot write the operational profile -- dining.manage required, operatore does not have it'
);

-- ### reservation requests: new confirmation_status values are accepted ###
set local role authenticated;
set local request.jwt.claim.sub = '00000068-0000-0000-0000-000000000a02';
insert into restaurant_reservation_requests
  (id, hotel_id, restaurant_id, guest_name, party_size, reservation_date, reservation_time, source, confirmation_status)
values
  ('00000068-0000-0000-0000-0000000eb001', '00000068-0000-0000-0000-00000000ff01', '00000068-0000-0000-0000-0000000da001', 'Ana Simone', 2, '2026-10-18', '20:00', 'guest', 'new');
reset role;
select is(
  (select confirmation_status from restaurant_reservation_requests where id = '00000068-0000-0000-0000-0000000eb001'),
  'new',
  'a guest-submitted reservation can start life in the new ''new'' status'
);

-- ### the new status default is 'new', not the legacy 'pending' ###
set local role authenticated;
set local request.jwt.claim.sub = '00000068-0000-0000-0000-000000000a02';
insert into restaurant_reservation_requests
  (id, hotel_id, restaurant_id, guest_name, party_size, reservation_date, reservation_time, source)
values
  ('00000068-0000-0000-0000-0000000eb002', '00000068-0000-0000-0000-00000000ff01', '00000068-0000-0000-0000-0000000da001', 'Smith', 2, '2026-10-18', '20:00', 'staff');
reset role;
select is(
  (select confirmation_status from restaurant_reservation_requests where id = '00000068-0000-0000-0000-0000000eb002'),
  'new',
  'confirmation_status defaults to ''new'' now, not the legacy ''pending'''
);

-- ### every new status value transitions cleanly through the workflow ###
set local role authenticated;
set local request.jwt.claim.sub = '00000068-0000-0000-0000-000000000a01';
update restaurant_reservation_requests set confirmation_status = 'in_progress' where id = '00000068-0000-0000-0000-0000000eb002';
update restaurant_reservation_requests set confirmation_status = 'unavailable' where id = '00000068-0000-0000-0000-0000000eb002';
reset role;
select is(
  (select confirmation_status from restaurant_reservation_requests where id = '00000068-0000-0000-0000-0000000eb002'),
  'unavailable',
  'a reservation can move new -> in_progress -> unavailable'
);

-- ### the legacy status set is still valid -- existing rows never break ###
select lives_ok(
  $$ insert into restaurant_reservation_requests (hotel_id, restaurant_id, guest_name, party_size, reservation_date, reservation_time, confirmation_status)
     values ('00000068-0000-0000-0000-00000000ff01', '00000068-0000-0000-0000-0000000da001', 'Legacy Row', 2, '2026-10-19', '20:00', 'pending') $$,
  'the legacy ''pending'' status is still accepted -- no backfill required for rows already in that state'
);

-- ### a genuinely made-up status is still rejected ###
select throws_ok(
  $$ insert into restaurant_reservation_requests (hotel_id, restaurant_id, guest_name, party_size, reservation_date, reservation_time, confirmation_status)
     values ('00000068-0000-0000-0000-00000000ff01', '00000068-0000-0000-0000-0000000da001', 'X', 2, '2026-10-20', '20:00', 'made_up_status') $$,
  '23514',
  null,
  'confirmation_status still rejects a value outside the full known set'
);

-- ### guest_preference_tags + assigned_to round-trip ###
set local role authenticated;
set local request.jwt.claim.sub = '00000068-0000-0000-0000-000000000a01';
update restaurant_reservation_requests
  set guest_preference_tags = array['Tavolo tranquillo', 'Compleanno'], assigned_to = '00000068-0000-0000-0000-000000000102'
  where id = '00000068-0000-0000-0000-0000000eb001';
reset role;
select is(
  (select row(guest_preference_tags, assigned_to) from restaurant_reservation_requests where id = '00000068-0000-0000-0000-0000000eb001'),
  row(array['Tavolo tranquillo', 'Compleanno']::text[], '00000068-0000-0000-0000-000000000102'::uuid),
  'guest_preference_tags and assigned_to were saved'
);

-- ### tenant-safety hardening: assigned_to must belong to the SAME hotel
--     as the reservation -- the composite FK, not just RLS, is what
--     rejects this ###
select throws_ok(
  $$ update restaurant_reservation_requests set assigned_to = '00000068-0000-0000-0000-000000000103'
     where id = '00000068-0000-0000-0000-0000000eb001' $$,
  '23503',
  null,
  'assigned_to cannot be set to a staff member from a different hotel -- composite FK violation'
);

-- ### restaurant_reservation_alternatives: ranked, FK-checked, staff-only ###
insert into restaurants (id, hotel_id, category_id, name) values
  ('00000068-0000-0000-0000-0000000da003', '00000068-0000-0000-0000-00000000ff01', '00000068-0000-0000-0000-000000000c01', 'Local'),
  ('00000068-0000-0000-0000-0000000da0b1', '00000068-0000-0000-0000-00000000ff02', '00000068-0000-0000-0000-000000000c02', 'Ristorante B');

set local role authenticated;
set local request.jwt.claim.sub = '00000068-0000-0000-0000-000000000a02';
insert into restaurant_reservation_alternatives (reservation_id, restaurant_id, rank) values
  ('00000068-0000-0000-0000-0000000eb001', '00000068-0000-0000-0000-0000000da002', 1),
  ('00000068-0000-0000-0000-0000000eb001', '00000068-0000-0000-0000-0000000da003', 2);
reset role;
select is(
  (select count(*)::int from restaurant_reservation_alternatives where reservation_id = '00000068-0000-0000-0000-0000000eb001'),
  2,
  'two ranked alternatives were authorized for the reservation'
);

-- ### the hotel_id column is trigger-stamped from the reservation, never
--     trusted from the caller ###
select is(
  (select hotel_id from restaurant_reservation_alternatives where reservation_id = '00000068-0000-0000-0000-0000000eb001' limit 1),
  '00000068-0000-0000-0000-00000000ff01'::uuid,
  'restaurant_reservation_alternatives.hotel_id was auto-stamped from the reservation''s own hotel'
);

-- ### rank must be unique per reservation -- no two alternatives tie ###
select throws_ok(
  $$ insert into restaurant_reservation_alternatives (reservation_id, restaurant_id, rank)
     values ('00000068-0000-0000-0000-0000000eb001', '00000068-0000-0000-0000-0000000da001', 1) $$,
  '23505',
  null,
  'two alternatives for the same reservation cannot share a rank'
);

-- ### CROSS-HOTEL: hotel A's reservation cannot be given hotel B's
--     restaurant as an authorized alternative -- the composite FK
--     (hotel_id, restaurant_id) -> restaurants(hotel_id, id) rejects it
--     even though both rows individually exist and the caller is a
--     legitimate admin of hotel A ###
set local role authenticated;
set local request.jwt.claim.sub = '00000068-0000-0000-0000-000000000a01';
select throws_ok(
  $$ insert into restaurant_reservation_alternatives (reservation_id, restaurant_id, rank)
     values ('00000068-0000-0000-0000-0000000eb001', '00000068-0000-0000-0000-0000000da0b1', 3) $$,
  '23503',
  null,
  'hotel A staff cannot authorize hotel B''s restaurant as an alternative for hotel A''s reservation'
);
reset role;

-- ### CROSS-HOTEL: hotel B's admin cannot see or modify hotel A's
--     reservation's alternatives at all ###
set local role authenticated;
set local request.jwt.claim.sub = '00000068-0000-0000-0000-000000000a03';
select is(
  (select count(*)::int from restaurant_reservation_alternatives where reservation_id = '00000068-0000-0000-0000-0000000eb001'),
  0,
  'hotel B admin cannot read hotel A''s authorized alternatives at all'
);
-- The hotel_id-stamping trigger resolves reservation_id through a plain
-- (non-SECURITY-DEFINER) SELECT, which RLS on restaurant_reservation_requests
-- already hides from a different hotel's staff -- so this fails as "the
-- reservation doesn't exist" (22023), one step before the composite FK or
-- the alternatives table's own RLS ever gets a chance to run. That's a
-- reasonable, arguably better-than-42501 outcome: it never confirms to
-- hotel B that a reservation with this id exists at hotel A at all.
select throws_ok(
  $$ insert into restaurant_reservation_alternatives (reservation_id, restaurant_id, rank)
     values ('00000068-0000-0000-0000-0000000eb001', '00000068-0000-0000-0000-0000000da0b1', 4) $$,
  '22023',
  null,
  'hotel B admin cannot add an alternative to hotel A''s reservation either, even using their own hotel''s restaurant'
);
reset role;

-- ### positive control: hotel B can manage its OWN alternatives fine --
--     the cross-hotel tests above aren't just "everything fails" ###
set local role authenticated;
set local request.jwt.claim.sub = '00000068-0000-0000-0000-000000000a03';
insert into restaurant_reservation_requests
  (id, hotel_id, restaurant_id, guest_name, party_size, reservation_date, reservation_time, source)
values
  ('00000068-0000-0000-0000-0000000eb0b1', '00000068-0000-0000-0000-00000000ff02', '00000068-0000-0000-0000-0000000da0b1', 'Guest B', 2, '2026-10-18', '20:00', 'staff');
insert into restaurant_reservation_alternatives (reservation_id, restaurant_id, rank) values
  ('00000068-0000-0000-0000-0000000eb0b1', '00000068-0000-0000-0000-0000000da0b1', 1);
reset role;
select is(
  (select count(*)::int from restaurant_reservation_alternatives where reservation_id = '00000068-0000-0000-0000-0000000eb0b1'),
  1,
  'hotel B can manage its own reservation''s alternatives normally'
);

set local role anon;
select is(
  (select count(*)::int from restaurant_reservation_alternatives),
  0,
  'anon cannot read authorized alternatives -- same sensitivity as the reservation itself'
);
-- Same "hidden before denied" shape as the hotel B case above: anon has no
-- RLS-visible row on restaurant_reservation_requests at all, so the
-- stamping trigger reports 22023 rather than ever reaching a 42501.
select throws_ok(
  $$ insert into restaurant_reservation_alternatives (reservation_id, restaurant_id, rank)
     values ('00000068-0000-0000-0000-0000000eb001', '00000068-0000-0000-0000-0000000da002', 9) $$,
  '22023',
  null,
  'anon cannot write authorized alternatives either'
);
reset role;

-- ### dining_guest_tags: admin-managed vocabulary, publicly readable like
--     dining_categories ###
set local role authenticated;
set local request.jwt.claim.sub = '00000068-0000-0000-0000-000000000a01';
insert into dining_guest_tags (id, hotel_id, label) values
  ('00000068-0000-0000-0000-000000001001', '00000068-0000-0000-0000-00000000ff01', 'Tavolo tranquillo');
reset role;
set local role anon;
select is(
  (select count(*)::int from dining_guest_tags where hotel_id = '00000068-0000-0000-0000-00000000ff01'),
  1,
  'anon can read the guest-tag vocabulary -- same reference-data boundary as dining_categories'
);
reset role;

-- ### a reception operatore (not admin) cannot manage the tag vocabulary ###
set local role authenticated;
set local request.jwt.claim.sub = '00000068-0000-0000-0000-000000000a02';
select throws_ok(
  $$ insert into dining_guest_tags (hotel_id, label) values ('00000068-0000-0000-0000-00000000ff01', 'Vista') $$,
  '42501',
  null,
  'a non-admin operatore cannot add a guest tag'
);
reset role;

-- ### restaurant_reservation_feedback: staff can read, nobody but a future
--     RPC can write (no insert grant to anon or authenticated yet) ###
insert into restaurant_reservation_feedback (reservation_id, rating, comment) values
  ('00000068-0000-0000-0000-0000000eb001', 5, 'Serata perfetta.');
set local role authenticated;
set local request.jwt.claim.sub = '00000068-0000-0000-0000-000000000a02'; -- reception, manages front desk
select is(
  (select rating from restaurant_reservation_feedback where reservation_id = '00000068-0000-0000-0000-0000000eb001'),
  5::smallint,
  'reception can read the guest feedback for a reservation they manage'
);
select throws_ok(
  $$ insert into restaurant_reservation_feedback (reservation_id, rating) values ('00000068-0000-0000-0000-0000000eb002', 4) $$,
  '42501',
  null,
  'authenticated staff cannot insert feedback directly -- no insert grant exists yet, only a future guest RPC will'
);
reset role;

select * from finish();
rollback;
