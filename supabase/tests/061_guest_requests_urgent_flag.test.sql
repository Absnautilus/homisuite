-- Urgency is a Reception queue-control capability. This regression test
-- proves the flag defaults safely and that a Reception member can change it.
begin;
create extension if not exists pgtap;
select plan(4);

insert into hotels (id, name, timezone, active) values
  ('00000061-0000-0000-0000-00000000ff01', 'Hotel Sessantuno', 'Europe/Rome', true);
select backfill_legacy_property_mapping();
select backfill_guest_requests_entitlement();

insert into request_categories (id, hotel_id, name) values
  ('00000061-0000-0000-0000-000000000c01', '00000061-0000-0000-0000-00000000ff01', 'Pulizie');
insert into request_types (id, category_id, name) values
  ('00000061-0000-0000-0000-0000000fee01', '00000061-0000-0000-0000-000000000c01', 'Asciugamani');
insert into rooms (id, hotel_id, room_number) values
  ('00000061-0000-0000-0000-0000000fa001', '00000061-0000-0000-0000-00000000ff01', '101');

insert into auth.users (id) values ('00000061-0000-0000-0000-000000000a01');
insert into profiles (id, full_name) values ('00000061-0000-0000-0000-000000000a01', 'Reception Uno');
insert into staff_profiles (id, hotel_id, auth_user_id, name, role, active) values
  ('00000061-0000-0000-0000-000000000101', '00000061-0000-0000-0000-00000000ff01', '00000061-0000-0000-0000-000000000a01', 'Reception Uno', 'admin', true);
insert into memberships (profile_id, property_id, role_id, status)
select '00000061-0000-0000-0000-000000000a01', m.platform_property_id, r.id, 'active'
from legacy_property_mapping m, roles r
where m.legacy_hotel_id = '00000061-0000-0000-0000-00000000ff01' and r.slug = 'receptionist';

insert into property_staff_details (property_id, profile_id, housekeeping_department)
select m.platform_property_id, '00000061-0000-0000-0000-000000000a01', 'reception'::department
from legacy_property_mapping m where m.legacy_hotel_id = '00000061-0000-0000-0000-00000000ff01';

insert into guest_requests (id, hotel_id, room_number, request_type_id, status) values
  ('00000061-0000-0000-0000-00000000ba01', '00000061-0000-0000-0000-00000000ff01', '101', '00000061-0000-0000-0000-0000000fee01', 'requested');

select is(
  (select urgent from guest_requests where id = '00000061-0000-0000-0000-00000000ba01'),
  false,
  'urgent defaults to false on a new request'
);

set local role authenticated;
set local request.jwt.claim.sub = '00000061-0000-0000-0000-000000000a01';
select lives_ok(
  $$ update guest_requests set urgent = true where id = '00000061-0000-0000-0000-00000000ba01' $$,
  'a Reception member can flag a request urgent'
);
reset role;

select is(
  (select urgent from guest_requests where id = '00000061-0000-0000-0000-00000000ba01'),
  true,
  'the urgent flag was actually persisted'
);

select is(
  (select attnotnull from pg_attribute where attrelid = 'public.guest_requests'::regclass and attname = 'urgent'),
  true,
  'urgent is not-null (a request is either urgent or it is not, never unknown)'
);

select * from finish();
rollback;
