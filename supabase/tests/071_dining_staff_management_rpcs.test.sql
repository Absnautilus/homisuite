-- 20261006120000_dining_staff_management_rpcs: the two atomic staff RPCs
-- (set_restaurant_reservation_alternatives, save_restaurant_management)
-- added in response to an external review flagging the client-side
-- DELETE+INSERT / two-separate-updates versions as non-atomic.
begin;
create extension if not exists pgtap;
select plan(17);

insert into hotels (id, name, timezone, active) values
  ('00000071-0000-0000-0000-00000000ff01', 'Hotel Settantuno A', 'Europe/Rome', true),
  ('00000071-0000-0000-0000-00000000ff02', 'Hotel Settantuno B', 'Europe/Rome', true);
select backfill_legacy_property_mapping();

insert into property_modules (property_id, module_id, enabled)
select m.platform_property_id, mo.id, true
from legacy_property_mapping m, modules mo
where m.legacy_hotel_id in ('00000071-0000-0000-0000-00000000ff01', '00000071-0000-0000-0000-00000000ff02')
  and mo.slug = 'dining';

insert into auth.users (id) values
  ('00000071-0000-0000-0000-000000000a01'), -- admin A
  ('00000071-0000-0000-0000-000000000a02'), -- reception operatore A (manages front desk, no dining.manage)
  ('00000071-0000-0000-0000-000000000a03'), -- admin B
  ('00000071-0000-0000-0000-000000000a04'); -- housekeeping operatore A (manages NEITHER front desk NOR dining)

insert into profiles (id, full_name) values
  ('00000071-0000-0000-0000-000000000a01', 'Admin 71 A'),
  ('00000071-0000-0000-0000-000000000a02', 'Reception 71 A'),
  ('00000071-0000-0000-0000-000000000a03', 'Admin 71 B'),
  ('00000071-0000-0000-0000-000000000a04', 'Housekeeping 71 A');

insert into staff_profiles (id, hotel_id, auth_user_id, name, role, department, active, login_username) values
  ('00000071-0000-0000-0000-000000000101', '00000071-0000-0000-0000-00000000ff01', '00000071-0000-0000-0000-000000000a01', 'Admin 71 A', 'admin', null, true, null),
  ('00000071-0000-0000-0000-000000000102', '00000071-0000-0000-0000-00000000ff01', '00000071-0000-0000-0000-000000000a02', 'Reception 71 A', 'operatore', 'reception', true, 'test071.rec'),
  ('00000071-0000-0000-0000-000000000103', '00000071-0000-0000-0000-00000000ff02', '00000071-0000-0000-0000-000000000a03', 'Admin 71 B', 'admin', null, true, null),
  ('00000071-0000-0000-0000-000000000104', '00000071-0000-0000-0000-00000000ff01', '00000071-0000-0000-0000-000000000a04', 'Housekeeping 71 A', 'operatore', 'housekeeping', true, 'test071.hk');

insert into memberships (profile_id, property_id, role_id, status)
select '00000071-0000-0000-0000-000000000a01', m.platform_property_id, r.id, 'active'
from legacy_property_mapping m, roles r
where m.legacy_hotel_id = '00000071-0000-0000-0000-00000000ff01' and r.slug = 'property_admin';
insert into memberships (profile_id, property_id, role_id, status)
select '00000071-0000-0000-0000-000000000a02', m.platform_property_id, r.id, 'active'
from legacy_property_mapping m, roles r
where m.legacy_hotel_id = '00000071-0000-0000-0000-00000000ff01' and r.slug = 'receptionist';
insert into memberships (profile_id, property_id, role_id, status)
select '00000071-0000-0000-0000-000000000a03', m.platform_property_id, r.id, 'active'
from legacy_property_mapping m, roles r
where m.legacy_hotel_id = '00000071-0000-0000-0000-00000000ff02' and r.slug = 'property_admin';
insert into memberships (profile_id, property_id, role_id, status)
select '00000071-0000-0000-0000-000000000a04', m.platform_property_id, r.id, 'active'
from legacy_property_mapping m, roles r
where m.legacy_hotel_id = '00000071-0000-0000-0000-00000000ff01' and r.slug = 'receptionist';

insert into dining_categories (id, hotel_id, name) values
  ('00000071-0000-0000-0000-000000000c01', '00000071-0000-0000-0000-00000000ff01', 'Cat A'),
  ('00000071-0000-0000-0000-000000000c02', '00000071-0000-0000-0000-00000000ff02', 'Cat B');
insert into restaurants (id, hotel_id, category_id, name) values
  ('00000071-0000-0000-0000-0000000da001', '00000071-0000-0000-0000-00000000ff01', '00000071-0000-0000-0000-000000000c01', 'Ristorante A1'),
  ('00000071-0000-0000-0000-0000000da002', '00000071-0000-0000-0000-00000000ff01', '00000071-0000-0000-0000-000000000c01', 'Ristorante A2'),
  ('00000071-0000-0000-0000-0000000da0b1', '00000071-0000-0000-0000-00000000ff02', '00000071-0000-0000-0000-000000000c02', 'Ristorante B1');
insert into restaurant_reservation_requests (id, hotel_id, restaurant_id, guest_name, party_size, reservation_date, reservation_time, source) values
  ('00000071-0000-0000-0000-0000000eb001', '00000071-0000-0000-0000-00000000ff01', '00000071-0000-0000-0000-0000000da001', 'Guest A', 2, '2026-10-20', '20:00', 'staff');

-- ### set_restaurant_reservation_alternatives: happy path ###
set local role authenticated;
set local request.jwt.claim.sub = '00000071-0000-0000-0000-000000000a01';
select is(
  (select count(*)::int from set_restaurant_reservation_alternatives('00000071-0000-0000-0000-0000000eb001', array['00000071-0000-0000-0000-0000000da002'::uuid])),
  1,
  'admin A sets one alternative for their own reservation'
);
reset role;
select is(
  (select count(*)::int from restaurant_reservation_alternatives where reservation_id = '00000071-0000-0000-0000-0000000eb001'),
  1,
  'the alternative was actually persisted'
);

-- ### cross-hotel restaurant is rejected, and the PREVIOUS list survives
--     intact (the whole point of making this atomic) ###
set local role authenticated;
set local request.jwt.claim.sub = '00000071-0000-0000-0000-000000000a01';
select throws_ok(
  $$ select set_restaurant_reservation_alternatives('00000071-0000-0000-0000-0000000eb001', array['00000071-0000-0000-0000-0000000da0b1'::uuid]) $$,
  '22023',
  null,
  'a restaurant belonging to a different hotel is rejected'
);
reset role;
select is(
  (select array_agg(restaurant_id) from restaurant_reservation_alternatives where reservation_id = '00000071-0000-0000-0000-0000000eb001'),
  array['00000071-0000-0000-0000-0000000da002'::uuid],
  'the previous alternative list is untouched after the failed call -- no partial delete'
);

-- ### a reception operatore DOES manage the booking dashboard (same
--     authorization as restaurant_reservation_requests_concierge/
--     restaurant_reservation_alternatives_concierge, which both use
--     current_staff_manages_front_desk() -- admin OR reception -- not
--     dining.manage), so this call is expected to succeed ###
set local role authenticated;
set local request.jwt.claim.sub = '00000071-0000-0000-0000-000000000a02';
select is(
  (select count(*)::int from set_restaurant_reservation_alternatives('00000071-0000-0000-0000-0000000eb001', array['00000071-0000-0000-0000-0000000da001'::uuid])),
  1,
  'a reception operatore (manages front desk) CAN set alternatives -- same authorization as the dashboard itself'
);
reset role;

-- ### staff who manage NEITHER front desk NOR dining (housekeeping) cannot
--     call it at all -- same "hidden before denied" shape as the hotel B
--     case: housekeeping has no RLS-visible row on
--     restaurant_reservation_requests either, so the function's own lookup
--     reports 22023 before its explicit 42501 check is ever reached ###
set local role authenticated;
set local request.jwt.claim.sub = '00000071-0000-0000-0000-000000000a04';
select throws_ok(
  $$ select set_restaurant_reservation_alternatives('00000071-0000-0000-0000-0000000eb001', array['00000071-0000-0000-0000-0000000da002'::uuid]) $$,
  '22023',
  null,
  'a housekeeping operatore (manages neither front desk nor dining) cannot call the RPC'
);
reset role;

-- ### a different hotel's admin cannot touch this reservation either ###
set local role authenticated;
set local request.jwt.claim.sub = '00000071-0000-0000-0000-000000000a03';
select throws_ok(
  $$ select set_restaurant_reservation_alternatives('00000071-0000-0000-0000-0000000eb001', array['00000071-0000-0000-0000-0000000da0b1'::uuid]) $$,
  '22023',
  null,
  'hotel B admin cannot set alternatives on hotel A''s reservation (hidden by RLS, reads as not-found)'
);
reset role;

-- ### duplicate restaurant ids in the same call are rejected ###
set local role authenticated;
set local request.jwt.claim.sub = '00000071-0000-0000-0000-000000000a01';
select throws_ok(
  $$ select set_restaurant_reservation_alternatives('00000071-0000-0000-0000-0000000eb001', array['00000071-0000-0000-0000-0000000da001'::uuid, '00000071-0000-0000-0000-0000000da001'::uuid]) $$,
  '22023',
  null,
  'duplicate restaurant ids in one call are rejected'
);

-- ### an empty array clears the list cleanly ###
select is(
  (select count(*)::int from set_restaurant_reservation_alternatives('00000071-0000-0000-0000-0000000eb001', array[]::uuid[])),
  0,
  'an empty array clears the alternatives list'
);
reset role;
select is(
  (select count(*)::int from restaurant_reservation_alternatives where reservation_id = '00000071-0000-0000-0000-0000000eb001'),
  0,
  'the list is actually empty afterward'
);

-- ### save_restaurant_management: happy path saves both halves atomically ###
set local role authenticated;
set local request.jwt.claim.sub = '00000071-0000-0000-0000-000000000a01';
select is(
  (select name from save_restaurant_management(
    '00000071-0000-0000-0000-0000000da001', 'Ristorante A1 Rinominato', 'Giapponese', 3::smallint, 10::smallint,
    'Via Roma 1', null, null, null, array[]::text[], true, 1, null, null, null, true,
    '+39 000', null, null, null, null, 'partner_commission', 15.5, null, null, null
  )),
  'Ristorante A1 Rinominato',
  'save_restaurant_management saves the restaurants half and returns the updated row'
);
reset role;
select is(
  (select row(commercial_agreement, commission_rate) from restaurant_operational_profiles where restaurant_id = '00000071-0000-0000-0000-0000000da001'),
  row('partner_commission'::text, 15.5::numeric),
  'save_restaurant_management saves the operational profile half in the same call'
);

-- ### an unauthorized caller gets a clear error, not a silent partial save ###
set local role authenticated;
set local request.jwt.claim.sub = '00000071-0000-0000-0000-000000000a02';
select throws_ok(
  $$ select save_restaurant_management(
    '00000071-0000-0000-0000-0000000da001', 'Hijacked', null, null, null, null, null, null, null, array[]::text[], false, 0, null, null, null, false,
    null, null, null, null, null, 'none', null, null, null, null
  ) $$,
  '22023',
  null,
  'a non-admin operatore cannot save restaurant management (0-row UPDATE becomes a real error, not a silent success)'
);
reset role;
select is(
  (select name from restaurants where id = '00000071-0000-0000-0000-0000000da001'),
  'Ristorante A1 Rinominato',
  'the restaurant was NOT renamed by the unauthorized attempt'
);

-- ### a restaurant from a different hotel cannot be touched either ###
set local role authenticated;
set local request.jwt.claim.sub = '00000071-0000-0000-0000-000000000a03';
select throws_ok(
  $$ select save_restaurant_management(
    '00000071-0000-0000-0000-0000000da001', 'Hijacked By B', null, null, null, null, null, null, null, array[]::text[], false, 0, null, null, null, false,
    null, null, null, null, null, 'none', null, null, null, null
  ) $$,
  '22023',
  null,
  'hotel B admin cannot save management for hotel A''s restaurant'
);
reset role;

-- ### anon can call neither RPC ###
set local role anon;
select throws_ok(
  $$ select set_restaurant_reservation_alternatives('00000071-0000-0000-0000-0000000eb001', array[]::uuid[]) $$,
  '42501',
  null,
  'anon cannot call set_restaurant_reservation_alternatives at all'
);
select throws_ok(
  $$ select save_restaurant_management(
    '00000071-0000-0000-0000-0000000da001', 'X', null, null, null, null, null, null, null, array[]::text[], false, 0, null, null, null, false,
    null, null, null, null, null, 'none', null, null, null, null
  ) $$,
  '42501',
  null,
  'anon cannot call save_restaurant_management at all'
);
reset role;

select * from finish();
rollback;
