-- guest_stay_info's further widened result (20260915170000): a valid guest
-- token now also resolves the hotel's WiFi network/password and
-- breakfast/bar hours from the Core property's settings jsonb, same
-- null-not-error behavior as the rest of this function when there's no
-- mapping or the fields were never filled in.
begin;
create extension if not exists pgtap;
select plan(6);

insert into hotels (id, name, timezone, active) values
  ('00000051-0000-0000-0000-00000000ff01', 'Hotel Con Servizi', 'Europe/Rome', true),
  ('00000051-0000-0000-0000-00000000ff02', 'Hotel Senza Mappatura', 'Europe/Rome', true);

insert into rooms (id, hotel_id, room_number) values
  ('00000051-0000-0000-0000-0000000fa001', '00000051-0000-0000-0000-00000000ff01', '101'),
  ('00000051-0000-0000-0000-0000000fa002', '00000051-0000-0000-0000-00000000ff02', '201');

insert into stays (id, hotel_id, room_id, guest_last_name, guest_pin, status, check_in_at, check_out_at) values
  ('00000051-0000-0000-0000-0000000ca001', '00000051-0000-0000-0000-00000000ff01', '00000051-0000-0000-0000-0000000fa001', 'Verdi', '1111', 'active', now() - interval '1 hour', now() + interval '1 day'),
  ('00000051-0000-0000-0000-0000000ca002', '00000051-0000-0000-0000-00000000ff02', '00000051-0000-0000-0000-0000000fa002', 'Neri', '2222', 'active', now() - interval '1 hour', now() + interval '1 day');

insert into organizations (id, name, slug) values
  ('00000051-0000-0000-0000-000000000010', 'Amenities Test Org', 'test-051-org');
insert into properties (id, organization_id, name, slug, settings) values
  ('00000051-0000-0000-0000-000000000011', '00000051-0000-0000-0000-000000000010', 'Amenities Test Property', 'test-051-prop',
   '{"wifiNetwork": "Hotel-Guest", "wifiPassword": "benvenuto2026", "breakfastHours": "7:30 - 10:30", "barHours": "11:00 - 23:00"}'::jsonb);
insert into legacy_property_mapping (platform_property_id, legacy_hotel_id) values
  ('00000051-0000-0000-0000-000000000011', '00000051-0000-0000-0000-00000000ff01');

select guest_login('00000051-0000-0000-0000-00000000ff01', '101', '1111', null) as token_mapped \gset
select guest_login('00000051-0000-0000-0000-00000000ff02', '201', '2222', null) as token_unmapped \gset

select is(
  (select hotel_wifi_network from guest_stay_info(:'token_mapped')),
  'Hotel-Guest',
  'guest_stay_info resolves the mapped property''s settings.wifiNetwork'
);
select is(
  (select hotel_wifi_password from guest_stay_info(:'token_mapped')),
  'benvenuto2026',
  'guest_stay_info resolves the mapped property''s settings.wifiPassword'
);
select is(
  (select hotel_breakfast_hours from guest_stay_info(:'token_mapped')),
  '7:30 - 10:30',
  'guest_stay_info resolves the mapped property''s settings.breakfastHours'
);
select is(
  (select hotel_bar_hours from guest_stay_info(:'token_mapped')),
  '11:00 - 23:00',
  'guest_stay_info resolves the mapped property''s settings.barHours'
);

select is(
  (select hotel_wifi_network from guest_stay_info(:'token_unmapped')),
  null,
  'an unmapped hotel resolves a null WiFi network, not an error'
);
select is(
  (select hotel_breakfast_hours from guest_stay_info(:'token_unmapped')),
  null,
  'an unmapped hotel resolves null breakfast hours too'
);

select * from finish();
rollback;
