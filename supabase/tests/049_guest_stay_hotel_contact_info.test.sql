-- guest_stay_info's widened result (20260915150000): a valid guest token
-- now also resolves the hotel's contact details and default checkout time
-- from the Core property's settings jsonb via legacy_property_mapping,
-- staying null (not an error) when there's no mapping or the fields were
-- never filled in -- the guest UI must never fall back to some other,
-- wrong contact.
begin;
create extension if not exists pgtap;
select plan(8);

insert into hotels (id, name, timezone, active) values
  ('00000049-0000-0000-0000-00000000ff01', 'Hotel Con Contatti', 'Europe/Rome', true),
  ('00000049-0000-0000-0000-00000000ff02', 'Hotel Senza Mappatura', 'Europe/Rome', true);

insert into rooms (id, hotel_id, room_number) values
  ('00000049-0000-0000-0000-0000000fa001', '00000049-0000-0000-0000-00000000ff01', '101'),
  ('00000049-0000-0000-0000-0000000fa002', '00000049-0000-0000-0000-00000000ff02', '201');

insert into stays (id, hotel_id, room_id, guest_last_name, guest_pin, status, check_in_at, check_out_at) values
  ('00000049-0000-0000-0000-0000000ca001', '00000049-0000-0000-0000-00000000ff01', '00000049-0000-0000-0000-0000000fa001', 'Rossi', '1111', 'active', now() - interval '1 hour', now() + interval '1 day'),
  ('00000049-0000-0000-0000-0000000ca002', '00000049-0000-0000-0000-00000000ff02', '00000049-0000-0000-0000-0000000fa002', 'Bianchi', '2222', 'active', now() - interval '1 hour', now() + interval '1 day');

-- Hotel Con Contatti is bridged to a Core property with phone+address+
-- email+a default checkout time set.
insert into organizations (id, name, slug) values
  ('00000049-0000-0000-0000-000000000010', 'Contact Test Org', 'test-049-org');
insert into properties (id, organization_id, name, slug, settings) values
  ('00000049-0000-0000-0000-000000000011', '00000049-0000-0000-0000-000000000010', 'Contact Test Property', 'test-049-prop',
   '{"phone": "+39 02 1234567", "address": "Via Roma 1, Milano", "publicEmail": "info@test049.it", "checkOutTime": "11:00"}'::jsonb);
insert into legacy_property_mapping (platform_property_id, legacy_hotel_id) values
  ('00000049-0000-0000-0000-000000000011', '00000049-0000-0000-0000-00000000ff01');

select guest_login('00000049-0000-0000-0000-00000000ff01', '101', '1111', null) as token_mapped \gset
select guest_login('00000049-0000-0000-0000-00000000ff02', '201', '2222', null) as token_unmapped \gset

select is(
  (select hotel_name from guest_stay_info(:'token_mapped')),
  'Hotel Con Contatti',
  'guest_stay_info returns the hotel''s own name'
);
select is(
  (select hotel_phone from guest_stay_info(:'token_mapped')),
  '+39 02 1234567',
  'guest_stay_info resolves the mapped property''s settings.phone'
);
select is(
  (select hotel_address from guest_stay_info(:'token_mapped')),
  'Via Roma 1, Milano',
  'guest_stay_info resolves the mapped property''s settings.address'
);
select is(
  (select hotel_email from guest_stay_info(:'token_mapped')),
  'info@test049.it',
  'guest_stay_info resolves the mapped property''s settings.publicEmail'
);
select is(
  (select hotel_check_out_time from guest_stay_info(:'token_mapped')),
  '11:00',
  'guest_stay_info resolves the mapped property''s settings.checkOutTime'
);
select is(
  (select check_out_at from guest_stay_info(:'token_mapped')),
  (select check_out_at from stays where id = '00000049-0000-0000-0000-0000000ca001'),
  'guest_stay_info still returns the stay''s own check_out_at unchanged'
);

select is(
  (select hotel_phone from guest_stay_info(:'token_unmapped')),
  null,
  'an unmapped hotel resolves a null phone, not an error or someone else''s number'
);
select is(
  (select hotel_check_out_time from guest_stay_info(:'token_unmapped')),
  null,
  'an unmapped hotel resolves a null default checkout time too'
);

select * from finish();
rollback;
