-- 20261006110000_dining_guest_reservation_rpc: the guest self-service
-- submission path deferred since 20260918100000_dining_module. Builds a
-- real guest session the same way guest_requests' own tests do (a stay +
-- guest_requests_guest_sessions row with a known plaintext token hashed the
-- same way guest_login() would have produced it) since this RPC reuses
-- guest_stay_from_token() rather than having its own auth.
begin;
create extension if not exists pgtap;
select plan(22);

insert into hotels (id, name, timezone, active) values
  ('00000070-0000-0000-0000-00000000ff01', 'Hotel Settanta', 'Europe/Rome', true),
  ('00000070-0000-0000-0000-00000000ff02', 'Hotel Settanta Senza Dining', 'Europe/Rome', true);
select backfill_legacy_property_mapping();

insert into property_modules (property_id, module_id, enabled)
select m.platform_property_id, mo.id, true
from legacy_property_mapping m, modules mo
where m.legacy_hotel_id = '00000070-0000-0000-0000-00000000ff01' and mo.slug = 'dining';
-- Hotel 2 never buys dining -- the "module not enabled" case below.

insert into rooms (id, hotel_id, room_number) values
  ('00000070-0000-0000-0000-0000000a0b01', '00000070-0000-0000-0000-00000000ff01', '204'),
  ('00000070-0000-0000-0000-0000000a0b02', '00000070-0000-0000-0000-00000000ff02', '101');

insert into stays (id, hotel_id, room_id, guest_last_name, check_in_at, check_out_at, status) values
  ('00000070-0000-0000-0000-0000000a0c01', '00000070-0000-0000-0000-00000000ff01', '00000070-0000-0000-0000-0000000a0b01', 'Simone', now() - interval '1 day', now() + interval '2 days', 'active'),
  ('00000070-0000-0000-0000-0000000a0c02', '00000070-0000-0000-0000-00000000ff02', '00000070-0000-0000-0000-0000000a0b02', 'Rossi', now() - interval '1 day', now() + interval '2 days', 'active'),
  -- a checked-out stay, for the invalid-session case
  ('00000070-0000-0000-0000-0000000a0c03', '00000070-0000-0000-0000-00000000ff01', '00000070-0000-0000-0000-0000000a0b01', 'Bianchi', now() - interval '5 days', now() - interval '1 day', 'active');

-- Plaintext tokens known to the test; only their sha256 hash is stored,
-- exactly like guest_login() itself would have produced.
insert into guest_requests_guest_sessions (stay_id, token_hash, expires_at) values
  ('00000070-0000-0000-0000-0000000a0c01', encode(digest('token-ana-valid', 'sha256'), 'hex'), now() + interval '1 day'),
  ('00000070-0000-0000-0000-0000000a0c02', encode(digest('token-rossi-no-dining', 'sha256'), 'hex'), now() + interval '1 day'),
  ('00000070-0000-0000-0000-0000000a0c03', encode(digest('token-bianchi-checked-out', 'sha256'), 'hex'), now() + interval '1 day'),
  -- same (still-active) stay as token-ana-valid, but this particular
  -- token's own session already expired -- distinct from the
  -- checked-out-stay case above, which fails on the stay itself.
  ('00000070-0000-0000-0000-0000000a0c01', encode(digest('token-ana-expired', 'sha256'), 'hex'), now() - interval '1 hour');

insert into dining_categories (id, hotel_id, name) values
  ('00000070-0000-0000-0000-000000000c01', '00000070-0000-0000-0000-00000000ff01', 'Fine dining'),
  ('00000070-0000-0000-0000-000000000c02', '00000070-0000-0000-0000-00000000ff02', 'Altro');
insert into restaurants (id, hotel_id, category_id, name, active) values
  ('00000070-0000-0000-0000-0000000da001', '00000070-0000-0000-0000-00000000ff01', '00000070-0000-0000-0000-000000000c01', 'Oniga', true),
  ('00000070-0000-0000-0000-0000000da002', '00000070-0000-0000-0000-00000000ff01', '00000070-0000-0000-0000-000000000c01', 'Chiuso Temporaneamente', false),
  -- belongs to hotel 2 -- for the cross-hotel booking test below
  ('00000070-0000-0000-0000-0000000da099', '00000070-0000-0000-0000-00000000ff02', '00000070-0000-0000-0000-000000000c02', 'Ristorante Altrove', true);

-- ### anon can call the RPC directly (it's the whole point) ###
set local role anon;

-- ### happy path: a valid guest session creates a reservation ###
select lives_ok(
  $$ select create_dining_reservation_request('token-ana-valid', '00000070-0000-0000-0000-0000000da001', current_date + 1, '20:00', 2, 'Tavolo tranquillo') $$,
  'a guest with a valid session can request a table'
);
reset role; -- restaurant_reservation_requests has no anon select grant at all (by design); verify as superuser
select is(
  (select row(hotel_id, restaurant_id, stay_id, room_number, guest_name, party_size, source, confirmation_status, special_requests)
   from restaurant_reservation_requests where stay_id = '00000070-0000-0000-0000-0000000a0c01'),
  row(
    '00000070-0000-0000-0000-00000000ff01'::uuid, '00000070-0000-0000-0000-0000000da001'::uuid, '00000070-0000-0000-0000-0000000a0c01'::uuid,
    '204'::text, 'Simone'::text, 2::int, 'guest'::text, 'new'::text, 'Tavolo tranquillo'::text
  ),
  'the row was stamped with the stay''s own hotel/room/guest name server-side, source=guest, status=new'
);
set local role anon;

-- ### invalid/unknown token ###
select throws_ok(
  $$ select create_dining_reservation_request('not-a-real-token', '00000070-0000-0000-0000-0000000da001', current_date + 1, '20:00', 2, null) $$,
  '28000',
  null,
  'an unknown token is rejected as invalid_session'
);

-- ### a checked-out stay's token is also rejected -- guest_stay_from_token
--     itself filters on status/checkout, same contract as guest_requests ###
select throws_ok(
  $$ select create_dining_reservation_request('token-bianchi-checked-out', '00000070-0000-0000-0000-0000000da001', current_date + 1, '20:00', 2, null) $$,
  '28000',
  null,
  'a checked-out stay''s token is rejected the same as an unknown one'
);

-- ### an expired session token is rejected even though the stay itself
--     is still active -- the session's own expires_at is a separate gate ###
select throws_ok(
  $$ select create_dining_reservation_request('token-ana-expired', '00000070-0000-0000-0000-0000000da001', current_date + 1, '20:00', 2, null) $$,
  '28000',
  null,
  'an expired session token is rejected as invalid_session'
);

-- ### hotel without the dining module enabled -- blocked even with an
--     otherwise-perfectly-valid session ###
select throws_ok(
  $$ select create_dining_reservation_request('token-rossi-no-dining', '00000070-0000-0000-0000-0000000da001', current_date + 1, '20:00', 2, null) $$,
  '42501',
  null,
  'a guest at a hotel without Dining enabled cannot submit a reservation'
);

-- ### a restaurant belonging to a different hotel cannot be booked ###
select throws_ok(
  $$ select create_dining_reservation_request('token-ana-valid', '00000070-0000-0000-0000-0000000da099', current_date + 1, '20:00', 2, null) $$,
  '22023',
  null,
  'a guest cannot book a restaurant belonging to a different hotel'
);

-- ### an inactive restaurant cannot be booked ###
select throws_ok(
  $$ select create_dining_reservation_request('token-ana-valid', '00000070-0000-0000-0000-0000000da002', current_date + 1, '20:00', 2, null) $$,
  '22023',
  null,
  'a guest cannot book a restaurant that has been deactivated'
);

-- ### invalid party size ###
select throws_ok(
  $$ select create_dining_reservation_request('token-ana-valid', '00000070-0000-0000-0000-0000000da001', current_date + 1, '20:00', 0, null) $$,
  '22023',
  null,
  'party_size must be at least 1'
);
select throws_ok(
  $$ select create_dining_reservation_request('token-ana-valid', '00000070-0000-0000-0000-0000000da001', current_date + 1, '20:00', null, null) $$,
  '22023',
  null,
  'party_size cannot be null'
);
select throws_ok(
  $$ select create_dining_reservation_request('token-ana-valid', '00000070-0000-0000-0000-0000000da001', current_date + 1, '20:00', 21, null) $$,
  '22023',
  null,
  'party_size over the upper bound (20) is rejected'
);

-- ### null date/time ###
select throws_ok(
  $$ select create_dining_reservation_request('token-ana-valid', '00000070-0000-0000-0000-0000000da001', null, '20:00', 2, null) $$,
  '22023',
  null,
  'reservation_date cannot be null'
);
select throws_ok(
  $$ select create_dining_reservation_request('token-ana-valid', '00000070-0000-0000-0000-0000000da001', current_date + 1, null, 2, null) $$,
  '22023',
  null,
  'reservation_time cannot be null'
);

-- ### special_requests over the 500-char limit ###
select throws_ok(
  $$ select create_dining_reservation_request('token-ana-valid', '00000070-0000-0000-0000-0000000da001', current_date + 1, '20:00', 2, repeat('x', 501)) $$,
  '22023',
  null,
  'special_requests over 500 characters is rejected'
);

-- ### a reservation in the past is rejected ###
select throws_ok(
  $$ select create_dining_reservation_request('token-ana-valid', '00000070-0000-0000-0000-0000000da001', current_date - 1, '20:00', 2, null) $$,
  '22023',
  null,
  'a reservation_date in the past is rejected'
);

-- ### a reservation date after the guest's own checkout is rejected --
--     stay 0c01 checks out in 2 days, so +10 is unambiguously past it ###
select throws_ok(
  $$ select create_dining_reservation_request('token-ana-valid', '00000070-0000-0000-0000-0000000da001', current_date + 10, '20:00', 2, null) $$,
  '22023',
  null,
  'a reservation_date after the stay''s own check_out_at is rejected'
);

-- ### duplicate submission (double-tap / retried request) is idempotent:
--     the same stay/restaurant/date/time returns the existing row instead
--     of inserting a second one ###
select lives_ok(
  $$ select create_dining_reservation_request('token-ana-valid', '00000070-0000-0000-0000-0000000da001', current_date + 1, '21:30', 4, 'prima chiamata') $$,
  'first submission for this date/time succeeds'
);
-- Both calls below only ever hit the idempotency short-circuit (the row
-- already exists from the lives_ok call above), so comparing their two
-- returned ids needs no table-read privilege of its own -- anon only ever
-- sees what the RPC itself returns, never restaurant_reservation_requests
-- directly.
select is(
  (select id from create_dining_reservation_request('token-ana-valid', '00000070-0000-0000-0000-0000000da001', current_date + 1, '21:30', 4, 'seconda chiamata (stesso tavolo/orario)')),
  (select id from create_dining_reservation_request('token-ana-valid', '00000070-0000-0000-0000-0000000da001', current_date + 1, '21:30', 4, 'terza chiamata (stesso tavolo/orario)')),
  'two more resubmissions of the identical stay/restaurant/date/time both return the same existing row'
);
reset role;
select is(
  (select count(*)::int from restaurant_reservation_requests
   where stay_id = '00000070-0000-0000-0000-0000000a0c01' and reservation_time = '21:30'),
  1,
  'the duplicate submission did not create a second row'
);

-- ### the RPC touched last_seen_at on the guest session, same courtesy
--     create_guest_request pays its own sessions -- scoped to the specific
--     token actually used (token-ana-valid), since this stay now also
--     carries the separate, still-untouched token-ana-expired session ###
select isnt(
  (select last_seen_at from guest_requests_guest_sessions
   where token_hash = encode(digest('token-ana-valid', 'sha256'), 'hex')),
  null,
  'the guest session''s last_seen_at was updated on a successful submission'
);

-- ### authenticated staff cannot call this guest-only RPC ###
insert into auth.users (id) values ('00000070-0000-0000-0000-000000000a01');
insert into profiles (id, full_name) values ('00000070-0000-0000-0000-000000000a01', 'Admin 70');
insert into staff_profiles (id, hotel_id, auth_user_id, name, role, active) values
  ('00000070-0000-0000-0000-000000000101', '00000070-0000-0000-0000-00000000ff01', '00000070-0000-0000-0000-000000000a01', 'Admin 70', 'admin', true);
set local role authenticated;
set local request.jwt.claim.sub = '00000070-0000-0000-0000-000000000a01';
select throws_ok(
  $$ select create_dining_reservation_request('token-ana-valid', '00000070-0000-0000-0000-0000000da001', current_date + 1, '20:00', 2, null) $$,
  '42501',
  null,
  'authenticated (non-anon) callers cannot execute this guest-only RPC either'
);
reset role;

-- ### restaurant_reservation_requests itself still rejects a direct
--     anon INSERT bypassing the RPC -- the RPC's SECURITY DEFINER is the
--     only door, not a relaxed table-level grant ###
set local role anon;
select throws_ok(
  $$ insert into restaurant_reservation_requests (hotel_id, restaurant_id, guest_name, party_size, reservation_date, reservation_time, source)
     values ('00000070-0000-0000-0000-00000000ff01', '00000070-0000-0000-0000-0000000da001', 'Hijack', 2, current_date + 1, '20:00', 'guest') $$,
  '42501',
  null,
  'anon still cannot insert into restaurant_reservation_requests directly, only through the RPC'
);
reset role;

select * from finish();
rollback;
