-- guest_stay_info's further widened result (20260916130000): a valid guest
-- token now also resolves the mapped property's public website
-- (settings.website), same null-not-error behavior as the rest of this
-- function when there's no mapping or the hotel never set one.
begin;
create extension if not exists pgtap;
select plan(3);

insert into hotels (id, name, timezone, active) values
  ('00000054-0000-0000-0000-00000000ff01', 'Hotel Con Sito', 'Europe/Rome', true),
  ('00000054-0000-0000-0000-00000000ff02', 'Hotel Senza Sito', 'Europe/Rome', true);

insert into rooms (id, hotel_id, room_number) values
  ('00000054-0000-0000-0000-0000000fa001', '00000054-0000-0000-0000-00000000ff01', '101'),
  ('00000054-0000-0000-0000-0000000fa002', '00000054-0000-0000-0000-00000000ff02', '201');

insert into stays (id, hotel_id, room_id, guest_last_name, guest_pin, status, check_in_at, check_out_at) values
  ('00000054-0000-0000-0000-0000000ca001', '00000054-0000-0000-0000-00000000ff01', '00000054-0000-0000-0000-0000000fa001', 'Rossi', '1111', 'active', now() - interval '1 hour', now() + interval '1 day'),
  ('00000054-0000-0000-0000-0000000ca002', '00000054-0000-0000-0000-00000000ff02', '00000054-0000-0000-0000-0000000fa002', 'Bianchi', '2222', 'active', now() - interval '1 hour', now() + interval '1 day');

insert into organizations (id, name, slug) values
  ('00000054-0000-0000-0000-000000000010', 'Website Test Org', 'test-054-org');
insert into properties (id, organization_id, name, slug, settings) values
  ('00000054-0000-0000-0000-000000000011', '00000054-0000-0000-0000-000000000010', 'Website Test Property', 'test-054-prop',
   '{"website": "https://hotelzattere.it"}'::jsonb),
  ('00000054-0000-0000-0000-000000000012', '00000054-0000-0000-0000-000000000010', 'No Website Property', 'test-054-prop-2',
   '{}'::jsonb);
insert into legacy_property_mapping (platform_property_id, legacy_hotel_id) values
  ('00000054-0000-0000-0000-000000000011', '00000054-0000-0000-0000-00000000ff01'),
  ('00000054-0000-0000-0000-000000000012', '00000054-0000-0000-0000-00000000ff02');

select guest_login('00000054-0000-0000-0000-00000000ff01', '101', '1111', null) as token_with_site \gset
select guest_login('00000054-0000-0000-0000-00000000ff02', '201', '2222', null) as token_without_site \gset

select is(
  (select hotel_website from guest_stay_info(:'token_with_site')),
  'https://hotelzattere.it',
  'guest_stay_info resolves the mapped property''s settings.website'
);
select is(
  (select hotel_website from guest_stay_info(:'token_without_site')),
  null,
  'a property that never set a website resolves null, not an error'
);
select is(
  (select hotel_phone from guest_stay_info(:'token_with_site')),
  null,
  'other stay-info fields are unaffected by this widening'
);

select * from finish();
rollback;
