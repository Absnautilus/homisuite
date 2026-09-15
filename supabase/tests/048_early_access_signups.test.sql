-- early_access_signups (20260915140000): reached only by the
-- early-access-signup Edge Function's service-role client. RLS enabled,
-- zero policies -- same "fully locked down" shape as guest_sessions, so
-- anon gets 0 rows on SELECT and a 42501 violation on INSERT; UPDATE's
-- USING clause silently matches 0 rows rather than raising (same as
-- storage.objects' own zero-policy UPDATE behavior, see
-- 047_property_logo_storage.test.sql).
begin;
create extension if not exists pgtap;
select plan(10);

select ok(to_regclass('public.early_access_signups') is not null, 'the early_access_signups table exists');

set local role service_role;

select lives_ok(
  $$ insert into early_access_signups (email, hotel_name, role, rooms_range, main_problem)
     values ('mario.rossi@hotel-test.it', 'Hotel Test', 'general_manager', '21-50', 'guest_requests') $$,
  'the service role can insert a valid lead'
);

select throws_ok(
  $$ insert into early_access_signups (email, hotel_name, role, rooms_range, main_problem)
     values ('Mario.Rossi@Hotel-Test.it', 'Hotel Test Duplicate', 'owner', '1-20', 'shift_planning') $$,
  '23505', null,
  'the same email in a different case is rejected as a duplicate'
);

select throws_ok(
  $$ insert into early_access_signups (email, hotel_name, role, rooms_range, main_problem)
     values ('bad-role@hotel-test.it', 'Hotel Test', 'ceo', '21-50', 'guest_requests') $$,
  '23514', null,
  'an invalid role is rejected'
);

select throws_ok(
  $$ insert into early_access_signups (email, hotel_name, role, rooms_range, main_problem)
     values ('bad-rooms@hotel-test.it', 'Hotel Test', 'general_manager', '500+', 'guest_requests') $$,
  '23514', null,
  'an invalid rooms_range is rejected'
);

select throws_ok(
  $$ insert into early_access_signups (email, hotel_name, role, rooms_range, main_problem)
     values ('bad-problem@hotel-test.it', 'Hotel Test', 'general_manager', '21-50', 'world_peace') $$,
  '23514', null,
  'an invalid main_problem is rejected'
);

select throws_ok(
  $$ insert into early_access_signups (email, hotel_name, role, rooms_range, main_problem, status)
     values ('bad-status@hotel-test.it', 'Hotel Test', 'general_manager', '21-50', 'guest_requests', 'won') $$,
  '23514', null,
  'an invalid status is rejected'
);

reset role;
set local role anon;

select ok(
  (select count(*) = 0 from early_access_signups),
  'anon cannot see any row (RLS, zero policies)'
);

select throws_ok(
  $$ insert into early_access_signups (email, hotel_name, role, rooms_range, main_problem)
     values ('anon-attempt@hotel-test.it', 'Hotel Test', 'general_manager', '21-50', 'guest_requests') $$,
  '42501', null,
  'anon cannot insert a lead'
);

with upd as (
  update early_access_signups set status = 'contacted'
  where lower(trim(email)) = 'mario.rossi@hotel-test.it'
  returning 1
)
select is((select count(*)::int from upd), 0,
  'anon cannot update an existing lead');

reset role;
select * from finish();
rollback;
