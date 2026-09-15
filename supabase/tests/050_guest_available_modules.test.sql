-- guest_available_modules(hotel_id) (20260915160000): anon can ask which
-- guest-facing modules a hotel has enabled, without any guest session --
-- only guest_requests is ever guest_facing today, and only when the
-- hotel's mapped property actually has it enabled.
begin;
create extension if not exists pgtap;
select plan(5);

insert into hotels (id, name, timezone, active) values
  ('00000050-0000-0000-0000-00000000ff01', 'Hotel Con Housekeeping', 'Europe/Rome', true),
  ('00000050-0000-0000-0000-00000000ff02', 'Hotel Senza Housekeeping', 'Europe/Rome', true),
  ('00000050-0000-0000-0000-00000000ff03', 'Hotel Non Mappato', 'Europe/Rome', true);

insert into organizations (id, name, slug) values
  ('00000050-0000-0000-0000-000000000010', 'Modules Test Org', 'test-050-org');
insert into properties (id, organization_id, name, slug) values
  ('00000050-0000-0000-0000-000000000011', '00000050-0000-0000-0000-000000000010', 'Property Con Housekeeping', 'test-050-prop-a'),
  ('00000050-0000-0000-0000-000000000012', '00000050-0000-0000-0000-000000000010', 'Property Senza Housekeeping', 'test-050-prop-b');

insert into legacy_property_mapping (platform_property_id, legacy_hotel_id) values
  ('00000050-0000-0000-0000-000000000011', '00000050-0000-0000-0000-00000000ff01'),
  ('00000050-0000-0000-0000-000000000012', '00000050-0000-0000-0000-00000000ff02');

-- Property A has guest_requests enabled; property B exists but doesn't.
insert into property_modules (property_id, module_id, enabled)
select '00000050-0000-0000-0000-000000000011', id, true from modules where slug = 'guest_requests';
insert into property_modules (property_id, module_id, enabled)
select '00000050-0000-0000-0000-000000000012', id, false from modules where slug = 'guest_requests';

set local role anon;

select is(
  (select array_agg(slug order by slug) from guest_available_modules('00000050-0000-0000-0000-00000000ff01')),
  array['guest_requests'],
  'a hotel whose mapped property has guest_requests enabled resolves it as an available module'
);
select is(
  (select count(*)::int from guest_available_modules('00000050-0000-0000-0000-00000000ff02')),
  0,
  'a hotel whose mapped property has the module disabled resolves no available modules'
);
select is(
  (select count(*)::int from guest_available_modules('00000050-0000-0000-0000-00000000ff03')),
  0,
  'an unmapped hotel resolves no available modules, not an error'
);
select is(
  (select count(*)::int from guest_available_modules('00000000-0000-0000-0000-000000000000')),
  0,
  'a nonexistent hotel id resolves no available modules, not an error'
);

reset role;

select is(
  (select guest_facing from modules where slug = 'guest_requests'),
  true,
  'guest_requests is marked guest_facing; every other module defaults to false'
);

select * from finish();
rollback;
