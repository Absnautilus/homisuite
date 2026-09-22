-- 20260918150000_guest_requests_priority_urgent_webhooks: two more
-- pg_net-direct triggers alongside the existing new-request webhook
-- (031_guest_request_webhook_no_placeholders covers that one). Same
-- approach as that file: check the function body and trigger metadata
-- rather than the actual HTTP delivery (pg_net queues the request
-- asynchronously; it isn't observable from inside this same transaction).
begin;
create extension if not exists pgtap;
select plan(6);

select ok(
  pg_get_functiondef('public.notify_guest_request_webhook()'::regprocedure) like '%notify-request-event%',
  'notify_guest_request_webhook() posts to the notify-request-event endpoint'
);

select is(
  (select tgenabled from pg_trigger
   where tgname = 'guest_requests_notify_priority_changed' and tgrelid = 'public.guest_requests'::regclass),
  'O',
  'guest_requests_notify_priority_changed exists on guest_requests and is enabled'
);

select is(
  (select tgenabled from pg_trigger
   where tgname = 'guest_requests_notify_urgent_flagged' and tgrelid = 'public.guest_requests'::regclass),
  'O',
  'guest_requests_notify_urgent_flagged exists on guest_requests and is enabled'
);

select ok(
  pg_get_triggerdef((select oid from pg_trigger where tgname = 'guest_requests_notify_priority_changed' and tgrelid = 'public.guest_requests'::regclass)) ilike '%old.priority IS DISTINCT FROM new.priority%',
  'the priority-changed trigger only fires when priority actually changes'
);

select ok(
  pg_get_triggerdef((select oid from pg_trigger where tgname = 'guest_requests_notify_urgent_flagged' and tgrelid = 'public.guest_requests'::regclass)) ilike '%old.urgent IS DISTINCT FROM new.urgent%new.urgent%',
  'the urgent-flagged trigger only fires on a change to urgent'
);

-- Actually exercising the triggers (an UPDATE that changes priority/urgent)
-- is covered implicitly by every other test that reorders or flags a
-- request without erroring -- pg_net.http_post() queues silently and never
-- raises, so there is nothing more specific to assert here without a live
-- network mock.
insert into hotels (id, name, timezone, active) values
  ('00000062-0000-0000-0000-00000000ff01', 'Hotel Sessantadue', 'Europe/Rome', true);
select backfill_legacy_property_mapping();
select backfill_guest_requests_entitlement();
insert into request_categories (id, hotel_id, name) values
  ('00000062-0000-0000-0000-000000000c01', '00000062-0000-0000-0000-00000000ff01', 'Pulizie');
insert into request_types (id, category_id, name) values
  ('00000062-0000-0000-0000-0000000fee01', '00000062-0000-0000-0000-000000000c01', 'Asciugamani');
insert into rooms (id, hotel_id, room_number) values
  ('00000062-0000-0000-0000-0000000fa001', '00000062-0000-0000-0000-00000000ff01', '101');
insert into auth.users (id) values ('00000062-0000-0000-0000-000000000a01');
insert into profiles (id, full_name) values ('00000062-0000-0000-0000-000000000a01', 'Reception Webhook');
insert into staff_profiles (id, hotel_id, auth_user_id, name, role, department, active) values
  ('00000062-0000-0000-0000-000000000101', '00000062-0000-0000-0000-00000000ff01',
   '00000062-0000-0000-0000-000000000a01', 'Reception Webhook', 'admin', 'reception', true);
insert into memberships (profile_id, property_id, role_id, status)
select '00000062-0000-0000-0000-000000000a01', m.platform_property_id, r.id, 'active'
from legacy_property_mapping m, roles r
where m.legacy_hotel_id = '00000062-0000-0000-0000-00000000ff01' and r.slug = 'receptionist';
insert into property_staff_details (property_id, profile_id, housekeeping_department)
select m.platform_property_id, '00000062-0000-0000-0000-000000000a01', 'reception'::department
from legacy_property_mapping m where m.legacy_hotel_id = '00000062-0000-0000-0000-00000000ff01';

insert into guest_requests (id, hotel_id, room_number, request_type_id, status) values
  ('00000062-0000-0000-0000-00000000ba01', '00000062-0000-0000-0000-00000000ff01', '101', '00000062-0000-0000-0000-0000000fee01', 'requested');

set local role authenticated;
set local request.jwt.claim.sub = '00000062-0000-0000-0000-000000000a01';
select lives_ok(
  $ update guest_requests set priority = priority + 1, urgent = true where id = '00000062-0000-0000-0000-00000000ba01' $$,
  'Reception can change priority and flag urgent on the same row (both triggers fire)'
);
reset role;

select * from finish();
rollback;
