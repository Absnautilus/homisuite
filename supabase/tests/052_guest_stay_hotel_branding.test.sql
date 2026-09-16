-- guest_stay_info's further widened result (20260915190000): a valid guest
-- token now also resolves the storage path to the hotel's logo (same
-- "<property_id>/logo.png" convention apps/web's Settings page uses) and
-- its own logoUpdatedAt cache-buster, staying null (not an error) when the
-- hotel never uploaded a logo or has no Core mapping -- the guest UI falls
-- back to generic Homisuite branding in that case.
begin;
create extension if not exists pgtap;
select plan(4);

insert into hotels (id, name, timezone, active) values
  ('00000052-0000-0000-0000-00000000ff01', 'Hotel Con Logo', 'Europe/Rome', true),
  ('00000052-0000-0000-0000-00000000ff02', 'Hotel Senza Logo', 'Europe/Rome', true);

insert into rooms (id, hotel_id, room_number) values
  ('00000052-0000-0000-0000-0000000fa001', '00000052-0000-0000-0000-00000000ff01', '101'),
  ('00000052-0000-0000-0000-0000000fa002', '00000052-0000-0000-0000-00000000ff02', '201');

insert into stays (id, hotel_id, room_id, guest_last_name, guest_pin, status, check_in_at, check_out_at) values
  ('00000052-0000-0000-0000-0000000ca001', '00000052-0000-0000-0000-00000000ff01', '00000052-0000-0000-0000-0000000fa001', 'Gialli', '1111', 'active', now() - interval '1 hour', now() + interval '1 day'),
  ('00000052-0000-0000-0000-0000000ca002', '00000052-0000-0000-0000-00000000ff02', '00000052-0000-0000-0000-0000000fa002', 'Blu', '2222', 'active', now() - interval '1 hour', now() + interval '1 day');

insert into organizations (id, name, slug) values
  ('00000052-0000-0000-0000-000000000010', 'Branding Test Org', 'test-052-org');
insert into properties (id, organization_id, name, slug, settings) values
  ('00000052-0000-0000-0000-000000000011', '00000052-0000-0000-0000-000000000010', 'Property Con Logo', 'test-052-prop-a',
   '{"logoUpdatedAt": "2026-09-16T10:00:00.000Z"}'::jsonb),
  ('00000052-0000-0000-0000-000000000012', '00000052-0000-0000-0000-000000000010', 'Property Senza Logo', 'test-052-prop-b', '{}'::jsonb);
insert into legacy_property_mapping (platform_property_id, legacy_hotel_id) values
  ('00000052-0000-0000-0000-000000000011', '00000052-0000-0000-0000-00000000ff01'),
  ('00000052-0000-0000-0000-000000000012', '00000052-0000-0000-0000-00000000ff02');

select guest_login('00000052-0000-0000-0000-00000000ff01', '101', '1111', null) as token_with_logo \gset
select guest_login('00000052-0000-0000-0000-00000000ff02', '201', '2222', null) as token_without_logo \gset

select is(
  (select hotel_logo_path from guest_stay_info(:'token_with_logo')),
  '00000052-0000-0000-0000-000000000011/logo.png',
  'guest_stay_info resolves the mapped property''s logo storage path'
);
select is(
  (select hotel_logo_updated_at from guest_stay_info(:'token_with_logo')),
  '2026-09-16T10:00:00.000Z',
  'guest_stay_info resolves the mapped property''s logoUpdatedAt'
);
select is(
  (select hotel_logo_updated_at from guest_stay_info(:'token_without_logo')),
  null,
  'a property that never uploaded a logo resolves a null logoUpdatedAt, not an error'
);
select is(
  (select hotel_logo_path from guest_stay_info(:'token_without_logo')),
  '00000052-0000-0000-0000-000000000012/logo.png',
  'the logo path is still resolved from the mapping even without a logo -- the frontend gates display on logoUpdatedAt instead'
);

select * from finish();
rollback;
