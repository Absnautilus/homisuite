-- resolve_hotel_guest_slug's further widened result (20260917100000): an
-- anon lookup of an active hotel's slug now also resolves the mapped
-- property's brand color and logo, same null-not-error behavior as the
-- rest of the guest-facing bridge when there's no mapping or the hotel
-- never set one -- lets the login screen (pre-session, only the slug is
-- known) brand itself before the guest has even logged in.
begin;
create extension if not exists pgtap;
select plan(4);

-- guest_slug is always auto-assigned by an insert trigger from `name` (see
-- 044_hotels_guest_slug.test.sql) -- an explicit value here would just be
-- silently overwritten, so these names are chosen to slugify predictably.
insert into hotels (id, name, timezone, active) values
  ('00000055-0000-0000-0000-00000000ff01', 'Hotel Con Marchio 055', 'Europe/Rome', true),
  ('00000055-0000-0000-0000-00000000ff02', 'Hotel Senza Marchio 055', 'Europe/Rome', true);

insert into organizations (id, name, slug) values
  ('00000055-0000-0000-0000-000000000010', 'Slug Branding Test Org', 'test-055-org');
insert into properties (id, organization_id, name, slug, settings) values
  ('00000055-0000-0000-0000-000000000011', '00000055-0000-0000-0000-000000000010', 'Branded Property', 'test-055-prop',
   '{"brandColor": "#0f9d78", "logoUpdatedAt": "2026-09-17T10:00:00.000Z"}'::jsonb);
insert into legacy_property_mapping (platform_property_id, legacy_hotel_id) values
  ('00000055-0000-0000-0000-000000000011', '00000055-0000-0000-0000-00000000ff01');

select is(
  (select brand_color from resolve_hotel_guest_slug('hotel-con-marchio-055')),
  '#0f9d78',
  'resolve_hotel_guest_slug resolves the mapped property''s settings.brandColor'
);
select is(
  (select logo_path from resolve_hotel_guest_slug('hotel-con-marchio-055')),
  '00000055-0000-0000-0000-000000000011/logo.png',
  'resolve_hotel_guest_slug resolves the mapped property''s logo storage path'
);
select is(
  (select logo_updated_at from resolve_hotel_guest_slug('hotel-con-marchio-055')),
  '2026-09-17T10:00:00.000Z',
  'resolve_hotel_guest_slug resolves the mapped property''s logoUpdatedAt'
);
select is(
  (select brand_color from resolve_hotel_guest_slug('hotel-senza-marchio-055')),
  null,
  'an unmapped hotel resolves a null brand color, not an error'
);

select * from finish();
rollback;
