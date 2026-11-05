-- 20261105200000_dining_reservation_feedback_rpcs: the post-dinner star
-- rating, finally wired end to end. Same guest-session fixture pattern as
-- 070_dining_guest_reservation_rpc's own tests (a stay + a known plaintext
-- token hashed the same way guest_login() would have produced it), since
-- both RPCs here reuse guest_stay_from_token() rather than having their
-- own auth.
begin;
create extension if not exists pgtap;
select plan(16);

insert into hotels (id, name, timezone, active) values
  ('00000087-0000-0000-0000-00000000ff01', 'Hotel Ottantasette', 'Europe/Rome', true);
select backfill_legacy_property_mapping();

insert into property_modules (property_id, module_id, enabled)
select m.platform_property_id, mo.id, true
from legacy_property_mapping m, modules mo
where m.legacy_hotel_id = '00000087-0000-0000-0000-00000000ff01' and mo.slug = 'dining';

insert into rooms (id, hotel_id, room_number) values
  ('00000087-0000-0000-0000-0000000a0b01', '00000087-0000-0000-0000-00000000ff01', '301'),
  ('00000087-0000-0000-0000-0000000a0b02', '00000087-0000-0000-0000-00000000ff01', '302');

insert into stays (id, hotel_id, room_id, guest_last_name, check_in_at, check_out_at, status) values
  ('00000087-0000-0000-0000-0000000a0c01', '00000087-0000-0000-0000-00000000ff01', '00000087-0000-0000-0000-0000000a0b01', 'Simone', now() - interval '10 days', now() + interval '2 days', 'active'),
  -- a second, unrelated stay -- for the cross-stay "not found" case
  ('00000087-0000-0000-0000-0000000a0c02', '00000087-0000-0000-0000-00000000ff01', '00000087-0000-0000-0000-0000000a0b02', 'Rossi', now() - interval '10 days', now() + interval '2 days', 'active');

insert into guest_requests_guest_sessions (stay_id, token_hash, expires_at) values
  ('00000087-0000-0000-0000-0000000a0c01', encode(digest('token-simone-valid', 'sha256'), 'hex'), now() + interval '1 day'),
  ('00000087-0000-0000-0000-0000000a0c02', encode(digest('token-rossi-valid', 'sha256'), 'hex'), now() + interval '1 day');

insert into dining_categories (id, hotel_id, name) values
  ('00000087-0000-0000-0000-000000000c01', '00000087-0000-0000-0000-00000000ff01', 'Fine dining');
insert into restaurants (id, hotel_id, category_id, name, active) values
  ('00000087-0000-0000-0000-0000000da001', '00000087-0000-0000-0000-00000000ff01', '00000087-0000-0000-0000-000000000c01', 'Oniga', true);

-- Seeded directly (not through create_dining_reservation_request) so each
-- row's status/date combination is exact and independent of "today":
--   past-confirmed  -- the only one actually rateable
--   future-confirmed -- confirmed, but the dinner hasn't happened yet
--   past-new        -- never confirmed, so nothing to rate even though it's past
--   other-stay      -- confirmed + past, but belongs to Rossi's stay, not Simone's
insert into restaurant_reservation_requests (id, hotel_id, restaurant_id, stay_id, room_number, guest_name, party_size, reservation_date, reservation_time, source, confirmation_status) values
  ('00000087-0000-0000-0000-0000000e0001', '00000087-0000-0000-0000-00000000ff01', '00000087-0000-0000-0000-0000000da001', '00000087-0000-0000-0000-0000000a0c01', '301', 'Simone', 2, current_date - 1, '20:00', 'guest', 'confirmed'),
  ('00000087-0000-0000-0000-0000000e0002', '00000087-0000-0000-0000-00000000ff01', '00000087-0000-0000-0000-0000000da001', '00000087-0000-0000-0000-0000000a0c01', '301', 'Simone', 2, current_date + 1, '20:00', 'guest', 'confirmed'),
  ('00000087-0000-0000-0000-0000000e0003', '00000087-0000-0000-0000-00000000ff01', '00000087-0000-0000-0000-0000000da001', '00000087-0000-0000-0000-0000000a0c01', '301', 'Simone', 2, current_date - 1, '20:00', 'guest', 'new'),
  ('00000087-0000-0000-0000-0000000e0004', '00000087-0000-0000-0000-00000000ff01', '00000087-0000-0000-0000-0000000da001', '00000087-0000-0000-0000-0000000a0c02', '302', 'Rossi', 2, current_date - 1, '20:00', 'guest', 'confirmed');

set local role anon;

-- ### list_my_dining_reservations: happy path, scoped to the calling stay only ###
select is(
  (select count(*)::int from list_my_dining_reservations('token-simone-valid')),
  3,
  'Simone sees her own 3 reservations, not Rossi''s'
);
select is(
  (select feedback_rating from list_my_dining_reservations('token-simone-valid') where id = '00000087-0000-0000-0000-0000000e0001'),
  null,
  'a reservation with no feedback yet returns a null feedback_rating'
);
select throws_ok(
  $$ select * from list_my_dining_reservations('not-a-real-token') $$,
  '28000',
  null,
  'list_my_dining_reservations rejects an unknown token'
);

-- ### create_dining_reservation_feedback: happy path ###
select lives_ok(
  $$ select create_dining_reservation_feedback('token-simone-valid', '00000087-0000-0000-0000-0000000e0001', 5::smallint, 'Serata meravigliosa') $$,
  'feedback can be submitted for a past, confirmed reservation'
);
reset role; -- restaurant_reservation_feedback has no anon select grant at all; verify as superuser
select is(
  (select row(reservation_id, rating, comment) from restaurant_reservation_feedback where reservation_id = '00000087-0000-0000-0000-0000000e0001'),
  row('00000087-0000-0000-0000-0000000e0001'::uuid, 5::smallint, 'Serata meravigliosa'::text),
  'the feedback row was written with the submitted rating and comment'
);
set local role anon;

-- ### the just-submitted feedback now shows up in the guest's own list ###
select is(
  (select feedback_rating from list_my_dining_reservations('token-simone-valid') where id = '00000087-0000-0000-0000-0000000e0001'),
  5::smallint,
  'the submitted feedback is reflected back in list_my_dining_reservations'
);

-- ### editing: resubmitting updates the same row, not a second one ###
select lives_ok(
  $$ select create_dining_reservation_feedback('token-simone-valid', '00000087-0000-0000-0000-0000000e0001', 3::smallint, 'Ripensandoci, cibo nella media') $$,
  'the guest can revise feedback she already submitted'
);
reset role;
select is(
  (select count(*)::int from restaurant_reservation_feedback where reservation_id = '00000087-0000-0000-0000-0000000e0001'),
  1,
  'revising feedback updates the existing row rather than inserting a second one'
);
select is(
  (select rating from restaurant_reservation_feedback where reservation_id = '00000087-0000-0000-0000-0000000e0001'),
  3::smallint,
  'the revised rating replaced the original one'
);
set local role anon;

-- ### a reservation that hasn't happened yet cannot be rated ###
select throws_ok(
  $$ select create_dining_reservation_feedback('token-simone-valid', '00000087-0000-0000-0000-0000000e0002', 4::smallint, null) $$,
  '22023',
  null,
  'a confirmed reservation whose date is still in the future cannot be rated yet'
);

-- ### a reservation that was never confirmed cannot be rated, even if its date has passed ###
select throws_ok(
  $$ select create_dining_reservation_feedback('token-simone-valid', '00000087-0000-0000-0000-0000000e0003', 4::smallint, null) $$,
  '22023',
  null,
  'a reservation that was never confirmed cannot be rated'
);

-- ### a reservation belonging to a different stay is not found, not just
--     unauthorized -- same "not found" posture update_my_request-style RPCs
--     use elsewhere, so existence of other guests'' bookings is never leaked ###
select throws_ok(
  $$ select create_dining_reservation_feedback('token-simone-valid', '00000087-0000-0000-0000-0000000e0004', 4::smallint, null) $$,
  '22023',
  null,
  'a reservation belonging to a different stay is rejected as not found'
);

-- ### invalid rating values ###
select throws_ok(
  $$ select create_dining_reservation_feedback('token-simone-valid', '00000087-0000-0000-0000-0000000e0001', 0::smallint, null) $$,
  '22023',
  null,
  'a rating of 0 is rejected'
);
select throws_ok(
  $$ select create_dining_reservation_feedback('token-simone-valid', '00000087-0000-0000-0000-0000000e0001', 6::smallint, null) $$,
  '22023',
  null,
  'a rating of 6 is rejected'
);

-- ### comment over the 500-char limit ###
select throws_ok(
  $$ select create_dining_reservation_feedback('token-simone-valid', '00000087-0000-0000-0000-0000000e0001', 4::smallint, repeat('x', 501)) $$,
  '22023',
  null,
  'a comment over 500 characters is rejected'
);

-- ### restaurant_reservation_feedback itself still rejects a direct anon
--     read -- the RPCs are the only door, not a relaxed table-level grant ###
select throws_ok(
  $$ select * from restaurant_reservation_feedback $$,
  '42501',
  null,
  'anon still cannot select from restaurant_reservation_feedback directly'
);

reset role;

select * from finish();
rollback;
