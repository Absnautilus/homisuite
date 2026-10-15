-- Fix: the legacy-hotel-id bridge functions each module's frontend calls
-- FIRST (guest_requests_legacy_hotel_for_property for Housekeeping,
-- legacy_hotel_for_property for Dining) each independently gated on
-- has_property_access -- an ordinary tenant membership Admin Master never
-- has. C2's own RLS work on the operational tables was never reachable
-- for her: both bridge functions returned null regardless of the mapping
-- actually existing, which both modules' frontends read as "not bridged
-- to a legacy hotel at all" -- a dead end one level before any of C2's
-- own policies ever got evaluated. Caught during live testing against a
-- real property (Palazzo Veneziano) after the Fase C migrations were
-- applied.
begin;
create extension if not exists pgtap;
select plan(8);

insert into hotels (id, name, timezone, active) values
  ('00000083-0000-0000-0000-00000000ff01', 'Hotel Ottantatre', 'Europe/Rome', true);
select backfill_legacy_property_mapping();

insert into property_modules (property_id, module_id, enabled)
select m.platform_property_id, mo.id, true
from legacy_property_mapping m, modules mo
where m.legacy_hotel_id = '00000083-0000-0000-0000-00000000ff01'
  and mo.slug in ('guest_requests', 'dining');

reset role;
select m.platform_property_id as fixture_property_id
  from legacy_property_mapping m
 where m.legacy_hotel_id = '00000083-0000-0000-0000-00000000ff01' \gset

-- Real tenant staff, to prove their own access is completely unaffected.
insert into auth.users (id) values ('00000083-0000-0000-0000-000000000a01');
insert into profiles (id, full_name) values ('00000083-0000-0000-0000-000000000a01', 'Staff 083');
insert into memberships (profile_id, property_id, role_id, status)
select '00000083-0000-0000-0000-000000000a01', :'fixture_property_id'::uuid, r.id, 'active'
from roles r where r.slug = 'property_admin';

-- Platform Admin, holding platform.support.read + verified MFA.
insert into auth.users (id) values ('00000083-0000-0000-0000-000000000b01');
insert into profiles (id, full_name) values ('00000083-0000-0000-0000-000000000b01', 'PA 083');
insert into platform_admins (id, profile_id, status) values
  ('00000083-0000-0000-0000-00000000ba01', '00000083-0000-0000-0000-000000000b01', 'active');
insert into platform_admin_permissions (platform_admin_id, permission_slug) values
  ('00000083-0000-0000-0000-00000000ba01', 'platform.support.read');

-- A second Platform Admin holding no platform permissions at all -- proves
-- this fix is not a blanket bypass for any admin, session or not.
insert into auth.users (id) values ('00000083-0000-0000-0000-000000000c01');
insert into profiles (id, full_name) values ('00000083-0000-0000-0000-000000000c01', 'PA 083 no permission');
insert into platform_admins (id, profile_id, status) values
  ('00000083-0000-0000-0000-00000000ca01', '00000083-0000-0000-0000-000000000c01', 'active');

set local role authenticated;
set local request.jwt.claim.sub = '00000083-0000-0000-0000-000000000a01';
select is(
  guest_requests_legacy_hotel_for_property(:'fixture_property_id'::uuid),
  '00000083-0000-0000-0000-00000000ff01'::uuid,
  'real tenant staff still resolve the legacy hotel id for Housekeeping, unaffected by this fix'
);
select is(
  legacy_hotel_for_property(:'fixture_property_id'::uuid, 'dining'),
  '00000083-0000-0000-0000-00000000ff01'::uuid,
  'real tenant staff still resolve the legacy hotel id for Dining, unaffected by this fix'
);

-- Before this fix, both of these returned null for Admin Master even
-- though the mapping row exists (confirmed above) -- she has no
-- has_property_access and (before opening a session) no
-- platform_operational_read_allowed either.
set local request.jwt.claim.sub = '00000083-0000-0000-0000-000000000b01';
set local request.jwt.claims = '{"aal":"aal2"}';
select is(
  guest_requests_legacy_hotel_for_property(:'fixture_property_id'::uuid),
  null::uuid,
  'before opening a session, Admin Master still cannot resolve the Housekeeping bridge (standing right alone is not enough -- a session must scope it)'
);
select is(
  legacy_hotel_for_property(:'fixture_property_id'::uuid, 'dining'),
  null::uuid,
  'same for the Dining bridge, before opening a session'
);

select lives_ok(
  format('select platform_open_operational_session(%L, null)', :'fixture_property_id'),
  'Admin Master opens an operational session on the fixture property'
);

-- This is the actual fix: both bridge functions now resolve for her once
-- platform_operational_read_allowed() holds, exactly like every other
-- operational read in this series.
select is(
  guest_requests_legacy_hotel_for_property(:'fixture_property_id'::uuid),
  '00000083-0000-0000-0000-00000000ff01'::uuid,
  'with an active session, Admin Master now resolves the Housekeeping legacy hotel id -- the actual bug this migration fixes'
);
select is(
  legacy_hotel_for_property(:'fixture_property_id'::uuid, 'dining'),
  '00000083-0000-0000-0000-00000000ff01'::uuid,
  'with an active session, Admin Master now resolves the Dining legacy hotel id -- same fix'
);

-- A platform admin without platform.support.read at all must still be
-- denied -- this fix only adds platform_operational_read_allowed() as an
-- alternative to has_property_access(), never a blanket bypass.
set local request.jwt.claim.sub = '00000083-0000-0000-0000-000000000c01';
select is(
  guest_requests_legacy_hotel_for_property(:'fixture_property_id'::uuid),
  null::uuid,
  'an admin holding no platform permissions at all still cannot resolve the Housekeeping bridge, session or not'
);

select * from finish();
rollback;
