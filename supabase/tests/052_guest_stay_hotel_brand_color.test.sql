-- guest_stay_info's further widened result (20260916100000): a valid guest
-- token now also resolves the hotel's custom brand color (properties.
-- settings.brandColor), same null-not-error behavior as the rest of this
-- function when there's no mapping or the hotel never set one.
begin;
create extension if not exists pgtap;
select plan(3);

insert into hotels (id, name, timezone, active) values
  ('00000052-0000-0000-0000-00000000ff01', 'Hotel Con Colore', 'Europe/Rome', true),
  ('00000052-0000-0000-0000-00000000ff02', 'Hotel Senza Colore', 'Europe/Rome', true);

insert into rooms (id, hotel_id, room_number) values
  ('00000052-0000-0000-0000-0000000fa001', '00000052-0000-0000-0000-00000000ff01', '101'),
  ('00000052-0000-0000-0000-0000000fa002', '00000052-0000-0000-0000-00000000ff02', '201');

insert into stays (id, hotel_id, room_id, guest_last_name, guest_pin, status, check_in_at, check_out_at) values
  ('00000052-0000-0000-0000-0000000ca001', '00000052-0000-0000-0000-00000000ff01', '00000052-0000-0000-0000-0000000fa001', 'Verdi', '1111', 'active', now() - interval '1 hour', now() + interval '1 day'),
  ('00000052-0000-0000-0000-0000000ca002', '00000052-0000-0000-0000-00000000ff02', '00000052-0000-0000-0000-0000000fa002', 'Neri', '2222', 'active', now() - interval '1 hour', now() + interval '1 day');

insert into organizations (id, name, slug) values
  ('00000052-0000-0000-0000-000000000010', 'Brand Color Test Org', 'test-052-org');
insert into properties (id, organization_id, name, slug, settings) values
  ('00000052-0000-0000-0000-000000000011', '00000052-0000-0000-0000-000000000010', 'Brand Color Test Property', 'test-052-prop',
   '{"brandColor": "#0f9d78"}'::jsonb),
  ('00000052-0000-0000-0000-000000000012', '00000052-0000-0000-0000-000000000010', 'No Brand Color Property', 'test-052-prop-2',
   '{}'::jsonb);
insert into legacy_property_mapping (platform_property_id, legacy_hotel_id) values
  ('00000052-0000-0000-0000-000000000011', '00000052-0000-0000-0000-00000000ff01'),
  ('00000052-0000-0000-0000-000000000012', '00000052-0000-0000-0000-00000000ff02');

select guest_login('00000052-0000-0000-0000-00000000ff01', '101', '1111', null) as token_colored \gset
select guest_login('00000052-0000-0000-0000-00000000ff02', '201', '2222', null) as token_uncolored \gset

select is(
  (select hotel_brand_color from guest_stay_info(:'token_colored')),
  '#0f9d78',
  'guest_stay_info resolves the mapped property''s settings.brandColor'
);
select is(
  (select hotel_brand_color from guest_stay_info(:'token_uncolored')),
  null,
  'a property that never set a brand color resolves null, not an error'
);
select is(
  (select hotel_wifi_network from guest_stay_info(:'token_colored')),
  null,
  'other stay-info fields are unaffected by this widening'
);

select * from finish();
rollback;
