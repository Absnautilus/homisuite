-- Audited Admin Master stay creation in an explicit "view as" session.
-- All fixtures rolled back; no production data is touched.
begin;
create extension if not exists pgtap;
select plan(16);

insert into hotels (id, name, timezone, active) values
  ('00000091-0000-0000-0000-00000000ff01', 'Hotel Test A 091', 'Europe/Rome', true),
  ('00000091-0000-0000-0000-00000000ff02', 'Hotel Test B 091', 'Europe/Rome', true);
select backfill_legacy_property_mapping();

insert into property_modules (property_id, module_id, enabled)
select m.platform_property_id, mo.id, true
from legacy_property_mapping m, modules mo
where m.legacy_hotel_id in ('00000091-0000-0000-0000-00000000ff01', '00000091-0000-0000-0000-00000000ff02')
  and mo.slug = 'guest_requests';

insert into rooms (id, hotel_id, room_number) values
  ('00000091-0000-0000-0000-00000000aa01', '00000091-0000-0000-0000-00000000ff01', '001'),
  ('00000091-0000-0000-0000-00000000aa02', '00000091-0000-0000-0000-00000000ff02', '002');

-- Active, property-scoped property administrator bridged to Housekeeping.
insert into auth.users (id) values
  ('00000091-0000-0000-0000-000000000301'),
  ('00000091-0000-0000-0000-000000000302'),
  ('00000091-0000-0000-0000-000000000201'),
  ('00000091-0000-0000-0000-000000000202'),
  ('00000091-0000-0000-0000-000000000401');
insert into profiles (id, full_name) values
  ('00000091-0000-0000-0000-000000000301', 'Reception Admin 091'),
  ('00000091-0000-0000-0000-000000000302', 'Non-bridged 091'),
  ('00000091-0000-0000-0000-000000000201', 'Platform Master 091'),
  ('00000091-0000-0000-0000-000000000202', 'Platform Readonly 091'),
  ('00000091-0000-0000-0000-000000000401', 'Ordinary Staff 091');
insert into memberships (id, profile_id, property_id, role_id, status)
select '00000091-0000-0000-0000-0000000d0301', '00000091-0000-0000-0000-000000000301', m.platform_property_id, ro.id, 'active'
from legacy_property_mapping m, roles ro
where m.legacy_hotel_id='00000091-0000-0000-0000-00000000ff01' and ro.slug='property_admin';
insert into memberships (id, profile_id, property_id, role_id, status)
select '00000091-0000-0000-0000-0000000d0302', '00000091-0000-0000-0000-000000000302', m.platform_property_id, ro.id, 'active'
from legacy_property_mapping m, roles ro
where m.legacy_hotel_id='00000091-0000-0000-0000-00000000ff01' and ro.slug='receptionist';

insert into property_staff_details (property_id, profile_id, housekeeping_department)
select m.platform_property_id, '00000091-0000-0000-0000-000000000301', 'reception'
from legacy_property_mapping m where m.legacy_hotel_id='00000091-0000-0000-0000-00000000ff01';
insert into staff_profiles (id, hotel_id, auth_user_id, name, role, department, active) values
  ('00000091-0000-0000-0000-00000000ee01', '00000091-0000-0000-0000-00000000ff01',
   '00000091-0000-0000-0000-000000000301', 'Reception Admin 091', 'admin', 'reception', true);

insert into platform_admins (id, profile_id, status) values
  ('00000091-0000-0000-0000-00000000a201', '00000091-0000-0000-0000-000000000201', 'active'),
  ('00000091-0000-0000-0000-00000000a202', '00000091-0000-0000-0000-000000000202', 'active');
insert into platform_admin_permissions (platform_admin_id, permission_slug) values
  ('00000091-0000-0000-0000-00000000a201', 'platform.impersonation.write'),
  ('00000091-0000-0000-0000-00000000a202', 'platform.support.read');

-- Capture property id before narrowing role (mapping is not client readable).
select platform_property_id as fixture_property_id
from legacy_property_mapping
where legacy_hotel_id='00000091-0000-0000-0000-00000000ff01' \gset

set local role authenticated;
set local request.jwt.claim.sub = '00000091-0000-0000-0000-000000000201';
set local request.jwt.claims = '{"aal":"aal2"}';

select throws_ok(
 format($fmt$ select platform_impersonated_create_stay(%L::uuid, '00000091-0000-0000-0000-00000000aa01', 'No session', now(), now()+interval '1 day', '00000091-0000-0000-0000-0000000d0301') $fmt$, :'fixture_property_id'),
 '42501', null, 'even an Admin Master cannot write without a view-as session'
);

select lives_ok(
 format($fmt$ select platform_open_impersonation_session(%L::uuid, '00000091-0000-0000-0000-0000000d0301', 'test stay activation') $fmt$, :'fixture_property_id'),
 'Admin Master opens a valid view-as session'
);

-- SQL-level tenant policy is unchanged: direct INSERT remains denied.
select throws_ok(
 $$ insert into stays(hotel_id,room_id,guest_last_name,check_in_at,check_out_at)
    values('00000091-0000-0000-0000-00000000ff01','00000091-0000-0000-0000-00000000aa01','Direct denied',now(),now()+interval '1 day') $$,
 '42501', null, 'direct client-side stays INSERT is still denied'
);

select lives_ok(
 format($fmt$ select platform_impersonated_create_stay(%L::uuid, '00000091-0000-0000-0000-00000000aa01', 'Guest 091', now(), now()+interval '1 day', '00000091-0000-0000-0000-0000000d0301') $fmt$, :'fixture_property_id'),
 'authorized view-as session creates the stay through the audited RPC'
);

reset role;
select is(
 (select count(*)::int from stays where guest_last_name='Guest 091'),
 1, 'stay is genuinely persisted'
);
select is(
 (select actor_profile_id from platform_audit_log where action='platform.impersonated_stay_created' order by created_at desc limit 1),
 '00000091-0000-0000-0000-000000000201'::uuid, 'audit attributes the write to Admin Master, not the viewed-as employee'
);
select is(
 (select metadata->>'acting_as_profile_id' from platform_audit_log where action='platform.impersonated_stay_created' order by created_at desc limit 1),
 '00000091-0000-0000-0000-000000000301', 'audit retains viewed-as staff identity in metadata'
);

set local role authenticated;
set local request.jwt.claim.sub = '00000091-0000-0000-0000-000000000201';
set local request.jwt.claims = '{"aal":"aal2"}';

select throws_ok(
 format($fmt$ select platform_impersonated_create_stay(%L::uuid, '00000091-0000-0000-0000-00000000aa01', 'Overlap', now(), now()+interval '1 day', '00000091-0000-0000-0000-0000000d0301') $fmt$, :'fixture_property_id'),
 '23P01', null, 'overlapping active stays remain blocked by exclusion constraint'
);
select throws_ok(
 format($fmt$ select platform_impersonated_create_stay(%L::uuid, '00000091-0000-0000-0000-00000000aa02', 'Wrong property', now(), now()+interval '1 day', '00000091-0000-0000-0000-0000000d0301') $fmt$, :'fixture_property_id'),
 '22023', 'room_not_found_in_property', 'cross-tenant room IDs cannot be used'
);
select throws_ok(
 format($fmt$ select platform_impersonated_create_stay(%L::uuid, '00000091-0000-0000-0000-00000000aa01', 'Invalid dates', now()+interval '2 days', now(), '00000091-0000-0000-0000-0000000d0301') $fmt$, :'fixture_property_id'),
 '22023', 'invalid_stay_dates', 'invalid checkout before checkin is rejected'
);

-- Switching impersonation target closes the former active session.
select lives_ok(
 format($fmt$ select platform_open_impersonation_session(%L::uuid, '00000091-0000-0000-0000-0000000d0302', 'test missing bridge') $fmt$, :'fixture_property_id'),
 'Admin Master switches view-as target'
);
select throws_ok(
 format($fmt$ select platform_impersonated_create_stay(%L::uuid, '00000091-0000-0000-0000-00000000aa01', 'No bridge', now()+interval '2 days', now()+interval '3 days', '00000091-0000-0000-0000-0000000d0302') $fmt$, :'fixture_property_id'),
 '42501', 'acting_as_cannot_manage_stays', 'a real user without Housekeeping bridge cannot create stays'
);

set local request.jwt.claim.sub = '00000091-0000-0000-0000-000000000202';
select throws_ok(
 format($fmt$ select platform_impersonated_create_stay(%L::uuid, '00000091-0000-0000-0000-00000000aa01', 'Read-only admin', now()+interval '2 days', now()+interval '3 days', '00000091-0000-0000-0000-0000000d0301') $fmt$, :'fixture_property_id'),
 '42501', null, 'read-only Platform Support has no write permission'
);

set local request.jwt.claim.sub = '00000091-0000-0000-0000-000000000401';
select throws_ok(
 format($fmt$ select platform_impersonated_create_stay(%L::uuid, '00000091-0000-0000-0000-00000000aa01', 'Ordinary user', now()+interval '2 days', now()+interval '3 days', '00000091-0000-0000-0000-0000000d0301') $fmt$, :'fixture_property_id'),
 '42501', null, 'ordinary tenant staff cannot invoke the privileged write'
);

set local request.jwt.claim.sub = '00000091-0000-0000-0000-000000000201';
set local request.jwt.claims = '{"aal":"aal1"}';
select throws_ok(
 format($fmt$ select platform_impersonated_create_stay(%L::uuid, '00000091-0000-0000-0000-00000000aa01', 'MFA missing', now()+interval '2 days', now()+interval '3 days', '00000091-0000-0000-0000-0000000d0302') $fmt$, :'fixture_property_id'),
 '42501', null, 'MFA downgrade immediately blocks RPC'
);

select * from finish();
rollback;
