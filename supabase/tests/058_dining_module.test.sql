-- 20260918100000_dining_module: schema + entitlement gating + staff RLS for
-- the new Dining module. Hotel A has the module enabled, Hotel B does not
-- (no property_modules row at all, the "never switched on" case) -- every
-- policy must treat that identically to an explicit enabled=false row.
begin;
create extension if not exists pgtap;
select plan(22);

insert into hotels (id, name, timezone, active) values
  ('00000058-0000-0000-0000-00000000ff01', 'Hotel Con Dining', 'Europe/Rome', true),
  ('00000058-0000-0000-0000-00000000ff02', 'Hotel Senza Dining', 'Europe/Rome', true);
select backfill_legacy_property_mapping();

insert into property_modules (property_id, module_id, enabled)
select m.platform_property_id, mo.id, true
from legacy_property_mapping m, modules mo
where m.legacy_hotel_id = '00000058-0000-0000-0000-00000000ff01' and mo.slug = 'dining';
-- Hotel B: no property_modules row at all -- the default, never-bought state.

insert into auth.users (id) values
  ('00000058-0000-0000-0000-000000000a01'), -- admin @ Hotel A
  ('00000058-0000-0000-0000-000000000a02'), -- reception operatore @ Hotel A
  ('00000058-0000-0000-0000-000000000a03'), -- housekeeping operatore @ Hotel A
  ('00000058-0000-0000-0000-000000000a04'); -- admin @ Hotel B

insert into profiles (id, full_name) values
  ('00000058-0000-0000-0000-000000000a01', 'Admin A'),
  ('00000058-0000-0000-0000-000000000a02', 'Reception A'),
  ('00000058-0000-0000-0000-000000000a03', 'Housekeeping A'),
  ('00000058-0000-0000-0000-000000000a04', 'Admin B');

insert into staff_profiles (id, hotel_id, auth_user_id, name, role, department, active, login_username) values
  ('00000058-0000-0000-0000-000000000101', '00000058-0000-0000-0000-00000000ff01', '00000058-0000-0000-0000-000000000a01', 'Admin A', 'admin', null, true, null),
  ('00000058-0000-0000-0000-000000000102', '00000058-0000-0000-0000-00000000ff01', '00000058-0000-0000-0000-000000000a02', 'Reception A', 'operatore', 'reception', true, 'test058.rec'),
  ('00000058-0000-0000-0000-000000000103', '00000058-0000-0000-0000-00000000ff01', '00000058-0000-0000-0000-000000000a03', 'Housekeeping A', 'operatore', 'housekeeping', true, 'test058.hk'),
  ('00000058-0000-0000-0000-000000000104', '00000058-0000-0000-0000-00000000ff02', '00000058-0000-0000-0000-000000000a04', 'Admin B', 'admin', null, true, null);

-- current_staff_role()/current_staff_hotel_for_module() both derive from a
-- real Core membership (20260827122100_guest_requests_authorization_wrapper),
-- not from staff_profiles.role -- every actor here needs one at their
-- mapped property to resolve at all.
insert into memberships (profile_id, property_id, role_id, status)
select '00000058-0000-0000-0000-000000000a01', m.platform_property_id, r.id, 'active'
from legacy_property_mapping m, roles r
where m.legacy_hotel_id = '00000058-0000-0000-0000-00000000ff01' and r.slug = 'property_admin';
insert into memberships (profile_id, property_id, role_id, status)
select '00000058-0000-0000-0000-000000000a02', m.platform_property_id, r.id, 'active'
from legacy_property_mapping m, roles r
where m.legacy_hotel_id = '00000058-0000-0000-0000-00000000ff01' and r.slug = 'receptionist';
insert into memberships (profile_id, property_id, role_id, status)
select '00000058-0000-0000-0000-000000000a03', m.platform_property_id, r.id, 'active'
from legacy_property_mapping m, roles r
where m.legacy_hotel_id = '00000058-0000-0000-0000-00000000ff01' and r.slug = 'receptionist';
insert into memberships (profile_id, property_id, role_id, status)
select '00000058-0000-0000-0000-000000000a04', m.platform_property_id, r.id, 'active'
from legacy_property_mapping m, roles r
where m.legacy_hotel_id = '00000058-0000-0000-0000-00000000ff02' and r.slug = 'property_admin';

-- ### hotel_has_module ###
select ok(hotel_has_module('00000058-0000-0000-0000-00000000ff01', 'dining'), 'hotel A has the dining module enabled');
select ok(not hotel_has_module('00000058-0000-0000-0000-00000000ff02', 'dining'), 'hotel B never bought the dining module');
select ok(not hotel_has_module('00000000-0000-0000-0000-000000000000', 'dining'), 'a nonexistent hotel resolves false, not an error');

-- ### legacy_hotel_for_property -- the frontend's property_id -> hotel_id
--     bridge, gated the same way (access + this specific module).
--     legacy_property_mapping has no grants for authenticated at all (only
--     SECURITY DEFINER functions may read it), so the property ids are
--     captured here, as superuser, before switching role. ###
select platform_property_id as property_a from legacy_property_mapping where legacy_hotel_id = '00000058-0000-0000-0000-00000000ff01' \gset
select platform_property_id as property_b from legacy_property_mapping where legacy_hotel_id = '00000058-0000-0000-0000-00000000ff02' \gset

set local role authenticated;
set local request.jwt.claim.sub = '00000058-0000-0000-0000-000000000a01';
select is(
  legacy_hotel_for_property(:'property_a', 'dining'),
  '00000058-0000-0000-0000-00000000ff01'::uuid,
  'admin A resolves hotel A''s own legacy hotel_id for the dining module'
);
reset role;
set local role authenticated;
set local request.jwt.claim.sub = '00000058-0000-0000-0000-000000000a04';
select is(
  legacy_hotel_for_property(:'property_b', 'dining'),
  null::uuid,
  'admin B resolves nothing for the dining module -- hotel B never bought it'
);
reset role;

-- ### admin @ hotel A can build the directory ###
set local role authenticated;
set local request.jwt.claim.sub = '00000058-0000-0000-0000-000000000a01';
insert into dining_categories (id, hotel_id, name) values
  ('00000058-0000-0000-0000-000000000c01', '00000058-0000-0000-0000-00000000ff01', 'Fine dining');
insert into restaurants (id, hotel_id, category_id, name, is_external, maps_url, website_url, requires_online_booking) values
  ('00000058-0000-0000-0000-0000000da001', '00000058-0000-0000-0000-00000000ff01', '00000058-0000-0000-0000-000000000c01', 'Trattoria Da Mario', true, 'https://maps.google.com/?q=trattoria-da-mario', 'https://trattoriadamario.example', true);
insert into restaurant_hours (restaurant_id, day_of_week, opens_at, closes_at) values
  ('00000058-0000-0000-0000-0000000da001', 1, '12:00', '15:00'),
  ('00000058-0000-0000-0000-0000000da001', 1, '19:00', '23:00');
reset role;
select is((select count(*)::int from restaurant_hours where restaurant_id = '00000058-0000-0000-0000-0000000da001'), 2, 'two opening intervals for the same day were both created (lunch + dinner)');
select is(
  (select row(website_url, requires_online_booking) from restaurants where id = '00000058-0000-0000-0000-0000000da001'),
  row('https://trattoriadamario.example'::text, true::boolean),
  'website_url and requires_online_booking were saved for the restaurant'
);

-- ### housekeeping operatore cannot write the directory (admin-only) ###
set local role authenticated;
set local request.jwt.claim.sub = '00000058-0000-0000-0000-000000000a03';
select throws_ok(
  $$ insert into dining_categories (hotel_id, name) values ('00000058-0000-0000-0000-00000000ff01', 'Snacking') $$,
  '42501',
  null,
  'a non-admin operatore cannot create a dining category'
);
reset role;

-- ### admin @ hotel B cannot modify hotel A's restaurant (wrong hotel --
--     RLS filters the row out of the UPDATE's WHERE match, no error, no
--     effect) -- reading it is a separate question, see the next block ###
set local role authenticated;
set local request.jwt.claim.sub = '00000058-0000-0000-0000-000000000a04';
update restaurants set name = 'Hijacked' where id = '00000058-0000-0000-0000-0000000da001';
reset role;
select is(
  (select name from restaurants where id = '00000058-0000-0000-0000-0000000da001'),
  'Trattoria Da Mario',
  'admin @ hotel B could not rename hotel A''s restaurant'
);

-- ### reading the directory is NOT hotel-isolated for authenticated staff
--     either -- documented, not accidental: same trust boundary as
--     request_categories/request_types (non-sensitive reference data,
--     hotel-scoping left to the client), so a staff member at a different
--     hotel with Dining enabled can browse another hotel's public menu ###
set local role authenticated;
set local request.jwt.claim.sub = '00000058-0000-0000-0000-000000000a04';
select is(
  (select name from restaurants where id = '00000058-0000-0000-0000-0000000da001'),
  'Trattoria Da Mario',
  'admin @ hotel B can still read hotel A''s restaurant -- reads are public reference data, not isolated'
);
reset role;

-- ### anon read: gated on the module being enabled, not just `active` ###
set local role anon;
select is(
  (select count(*)::int from restaurants where hotel_id = '00000058-0000-0000-0000-00000000ff01'),
  1,
  'anon can read hotel A''s active restaurant -- module enabled'
);
select is(
  (select count(*)::int from restaurant_hours where restaurant_id = '00000058-0000-0000-0000-0000000da001'),
  2,
  'anon can read hotel A''s opening hours -- module enabled'
);
reset role;

-- ### module gate blocks even an otherwise-identical row on a hotel that
--     never bought Dining -- built directly (bypassing RLS) since Hotel B's
--     own admin has no write access to prove the read gate independently ###
insert into dining_categories (id, hotel_id, name) values
  ('00000058-0000-0000-0000-000000000c02', '00000058-0000-0000-0000-00000000ff02', 'Colazione');
insert into restaurants (id, hotel_id, category_id, name) values
  ('00000058-0000-0000-0000-0000000da002', '00000058-0000-0000-0000-00000000ff02', '00000058-0000-0000-0000-000000000c02', 'Bar Centrale');
set local role anon;
select is(
  (select count(*)::int from restaurants where hotel_id = '00000058-0000-0000-0000-00000000ff02'),
  0,
  'anon reads nothing for hotel B -- active but the module was never switched on'
);
reset role;

-- ### admin @ hotel B still cannot write even though it's their own hotel --
--     the module gate blocks staff writes too, not only guest reads ###
set local role authenticated;
set local request.jwt.claim.sub = '00000058-0000-0000-0000-000000000a04';
select throws_ok(
  $$ insert into dining_categories (hotel_id, name) values ('00000058-0000-0000-0000-00000000ff02', 'Aperitivo') $$,
  '42501',
  null,
  'admin @ hotel B cannot create a category either -- module not enabled'
);
reset role;

-- ### restaurant_reservation_requests: manual dashboard entry ###
set local role authenticated;
set local request.jwt.claim.sub = '00000058-0000-0000-0000-000000000a02'; -- reception, manages front desk
insert into restaurant_reservation_requests
  (id, hotel_id, restaurant_id, room_number, guest_name, party_size, reservation_date, reservation_time, source, created_by)
values
  ('00000058-0000-0000-0000-0000000eb001', '00000058-0000-0000-0000-00000000ff01', '00000058-0000-0000-0000-0000000da001', '204', 'Sig.ra Bianchi', 4, '2026-09-20', '20:30', 'staff', '00000058-0000-0000-0000-000000000102');
reset role;
select is((select count(*)::int from restaurant_reservation_requests where id = '00000058-0000-0000-0000-0000000eb001'), 1, 'reception could manually add a reservation to the dashboard');

-- ### housekeeping operatore cannot see or manage the reservation dashboard
--     (not a front-desk/concierge duty) ###
set local role authenticated;
set local request.jwt.claim.sub = '00000058-0000-0000-0000-000000000a03';
select is(
  (select count(*)::int from restaurant_reservation_requests where hotel_id = '00000058-0000-0000-0000-00000000ff01'),
  0,
  'housekeeping operatore has no visibility into the reservation dashboard'
);
select throws_ok(
  $$ insert into restaurant_reservation_requests (hotel_id, restaurant_id, guest_name, party_size, reservation_date, reservation_time)
     values ('00000058-0000-0000-0000-00000000ff01', '00000058-0000-0000-0000-0000000da001', 'Someone', 2, '2026-09-21', '20:00') $$,
  '42501',
  null,
  'housekeeping operatore cannot add a reservation either'
);
reset role;

-- ### anon can never read the reservation dashboard, module aside ###
set local role anon;
select is(
  (select count(*)::int from restaurant_reservation_requests where hotel_id = '00000058-0000-0000-0000-00000000ff01'),
  0,
  'anon cannot read the reservation dashboard at all'
);
reset role;

-- ### staff can triage a reservation -- confirm it, then cancel it (the
--     dashboard's red row) ###
set local role authenticated;
set local request.jwt.claim.sub = '00000058-0000-0000-0000-000000000a01'; -- admin, also manages front desk
update restaurant_reservation_requests
  set confirmation_status = 'confirmed', confirmation_note = 'Confermato per le 20:30'
  where id = '00000058-0000-0000-0000-0000000eb001';
update restaurant_reservation_requests
  set confirmation_status = 'cancelled'
  where id = '00000058-0000-0000-0000-0000000eb001';
reset role;
select is(
  (select confirmation_status from restaurant_reservation_requests where id = '00000058-0000-0000-0000-0000000eb001'),
  'cancelled',
  'admin confirmed then cancelled the reservation -- the dashboard renders this row in red'
);

-- ### delete grant actually works, not just the RLS policy
--     (20260917110000 already showed a `for all` policy alone isn't enough) ###
set local role authenticated;
set local request.jwt.claim.sub = '00000058-0000-0000-0000-000000000a01';
delete from restaurant_hours where restaurant_id = '00000058-0000-0000-0000-0000000da001' and opens_at = '12:00';
reset role;
select is((select count(*)::int from restaurant_hours where restaurant_id = '00000058-0000-0000-0000-0000000da001'), 1, 'admin could delete one opening interval, the grant is wired up');

-- ### an overnight-style interval (closes before it opens) is rejected ###
select throws_ok(
  $$ insert into restaurant_hours (restaurant_id, day_of_week, opens_at, closes_at)
     values ('00000058-0000-0000-0000-0000000da001', 2, '22:00', '01:00') $$,
  '23514',
  null,
  'closes_at must be after opens_at -- an overnight span needs two rows instead'
);

-- ### confirmation_status is constrained to the known set ###
select throws_ok(
  $$ insert into restaurant_reservation_requests (hotel_id, restaurant_id, guest_name, party_size, reservation_date, reservation_time, confirmation_status)
     values ('00000058-0000-0000-0000-00000000ff01', '00000058-0000-0000-0000-0000000da001', 'X', 2, '2026-09-22', '20:00', 'made_up_status') $$,
  '23514',
  null,
  'confirmation_status rejects a value outside pending/confirmed/declined/cancelled'
);

select * from finish();
rollback;
