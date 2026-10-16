-- Platform Admin "visualizza come" with real writes -- Housekeeping's
-- in_progress->completed transition (Fase C follow-up, Part 2 first
-- slice). The security property that matters most here is attribution:
-- the write must land as Admin Master in platform_audit_log, carrying
-- WHICH staff member's authority she exercised as metadata -- never
-- indistinguishable from that staff member's own action. Assertions 5-6
-- below are that property, directly.
begin;
create extension if not exists pgtap;
select plan(12);

insert into hotels (id, name, timezone, active) values
  ('00000085-0000-0000-0000-00000000ff01', 'Hotel Ottantacinque A', 'Europe/Rome', true),
  ('00000085-0000-0000-0000-00000000ff02', 'Hotel Ottantacinque B', 'Europe/Rome', true);
select backfill_legacy_property_mapping();

insert into property_modules (property_id, module_id, enabled)
select m.platform_property_id, mo.id, true
from legacy_property_mapping m, modules mo
where m.legacy_hotel_id in ('00000085-0000-0000-0000-00000000ff01', '00000085-0000-0000-0000-00000000ff02')
  and mo.slug = 'guest_requests';

insert into rooms (id, hotel_id, room_number) values
  ('00000085-0000-0000-0000-00000000aa01', '00000085-0000-0000-0000-00000000ff01', '101');
insert into request_categories (id, hotel_id, name, department) values
  ('00000085-0000-0000-0000-00000000bb01', '00000085-0000-0000-0000-00000000ff01', 'Housekeeping 085', 'housekeeping');
insert into request_types (id, category_id, name) values
  ('00000085-0000-0000-0000-00000000cc01', '00000085-0000-0000-0000-00000000bb01', 'Towels 085');

-- Chiara: a real Core team member AND bridged into Housekeeping as
-- Reception (sees_full_queue + can_manage_queue both true) -- the person
-- Admin Master will "view as".
insert into auth.users (id) values ('00000085-0000-0000-0000-000000000301');
insert into profiles (id, full_name) values ('00000085-0000-0000-0000-000000000301', 'Chiara 085');
insert into memberships (id, profile_id, property_id, role_id, status)
select '00000085-0000-0000-0000-0000000d0301', '00000085-0000-0000-0000-000000000301', m.platform_property_id, r.id, 'active'
from legacy_property_mapping m, roles r
where m.legacy_hotel_id = '00000085-0000-0000-0000-00000000ff01' and r.slug = 'manager';
insert into property_staff_details (property_id, profile_id, housekeeping_department)
select m.platform_property_id, '00000085-0000-0000-0000-000000000301', 'reception'
from legacy_property_mapping m where m.legacy_hotel_id = '00000085-0000-0000-0000-00000000ff01';
insert into staff_profiles (id, hotel_id, auth_user_id, name, role, department, active) values
  ('00000085-0000-0000-0000-00000000ee01', '00000085-0000-0000-0000-00000000ff01', '00000085-0000-0000-0000-000000000301', 'Chiara 085', 'admin', null, true);

-- Marco: a real Core team member who was NEVER bridged into Housekeeping
-- (no staff_profiles row at all) -- proves "acting as" someone with no
-- Housekeeping access is denied, not silently granted by Admin Master's
-- own standing rights.
insert into auth.users (id) values ('00000085-0000-0000-0000-000000000302');
insert into profiles (id, full_name) values ('00000085-0000-0000-0000-000000000302', 'Marco 085');
insert into memberships (id, profile_id, property_id, role_id, status)
select '00000085-0000-0000-0000-0000000d0302', '00000085-0000-0000-0000-000000000302', m.platform_property_id, r.id, 'active'
from legacy_property_mapping m, roles r
where m.legacy_hotel_id = '00000085-0000-0000-0000-00000000ff01' and r.slug = 'receptionist';

-- An ordinary tenant staff member, not a platform admin at all.
insert into auth.users (id) values ('00000085-0000-0000-0000-000000000401');
insert into profiles (id, full_name) values ('00000085-0000-0000-0000-000000000401', 'Staff 085');
insert into memberships (profile_id, property_id, role_id, status)
select '00000085-0000-0000-0000-000000000401', m.platform_property_id, r.id, 'active'
from legacy_property_mapping m, roles r
where m.legacy_hotel_id = '00000085-0000-0000-0000-00000000ff01' and r.slug = 'receptionist';

insert into stays (id, hotel_id, room_id, guest_last_name, check_in_at, check_out_at, created_by) values
  ('00000085-0000-0000-0000-0000000aa301', '00000085-0000-0000-0000-00000000ff01', '00000085-0000-0000-0000-00000000aa01', 'Rossi 085', now(), now() + interval '1 day', '00000085-0000-0000-0000-00000000ee01');

-- The request Admin Master will complete while viewing as Chiara.
insert into guest_requests (id, hotel_id, stay_id, room_number, request_type_id, assigned_department, status, accepted_by, accepted_at) values
  ('00000085-0000-0000-0000-0000000ee201', '00000085-0000-0000-0000-00000000ff01', '00000085-0000-0000-0000-0000000aa301', '101', '00000085-0000-0000-0000-00000000cc01', 'housekeeping', 'in_progress', '00000085-0000-0000-0000-00000000ee01', now());

-- A still-'requested' request on the same property, for the invalid-transition case.
insert into guest_requests (id, hotel_id, stay_id, room_number, request_type_id, assigned_department, status) values
  ('00000085-0000-0000-0000-0000000ee202', '00000085-0000-0000-0000-00000000ff01', '00000085-0000-0000-0000-0000000aa301', '101', '00000085-0000-0000-0000-00000000cc01', 'housekeeping', 'requested');

-- Platform Admin A: platform.impersonation.write + MFA.
insert into auth.users (id) values ('00000085-0000-0000-0000-000000000201');
insert into profiles (id, full_name) values ('00000085-0000-0000-0000-000000000201', 'PA — impersonation 085');
insert into platform_admins (id, profile_id, status) values
  ('00000085-0000-0000-0000-00000000a201', '00000085-0000-0000-0000-000000000201', 'active');
insert into platform_admin_permissions (platform_admin_id, permission_slug) values
  ('00000085-0000-0000-0000-00000000a201', 'platform.impersonation.write');

-- Platform Admin B: support.read only -- never granted impersonation.write.
insert into auth.users (id) values ('00000085-0000-0000-0000-000000000202');
insert into profiles (id, full_name) values ('00000085-0000-0000-0000-000000000202', 'PA — no impersonation 085');
insert into platform_admins (id, profile_id, status) values
  ('00000085-0000-0000-0000-00000000a202', '00000085-0000-0000-0000-000000000202', 'active');
insert into platform_admin_permissions (platform_admin_id, permission_slug) values
  ('00000085-0000-0000-0000-00000000a202', 'platform.support.read');

-- Captured before the role switch -- legacy_property_mapping has no direct
-- SELECT grant to authenticated (only through SECURITY DEFINER bridge
-- functions), same reason test 083 captures its fixture property id this way.
select m.platform_property_id as fixture_property_id
  from legacy_property_mapping m
 where m.legacy_hotel_id = '00000085-0000-0000-0000-00000000ff01' \gset

set local role authenticated;
set local request.jwt.claim.sub = '00000085-0000-0000-0000-000000000201';
set local request.jwt.claims = '{"aal":"aal2"}';

-- === before any impersonation session: standing permission alone is not enough ===
select throws_ok(
  $$ select platform_impersonated_complete_guest_request('00000085-0000-0000-0000-0000000ee201'::uuid, '00000085-0000-0000-0000-0000000d0301'::uuid) $$,
  '42501', null, 'Admin A cannot complete the request before opening an impersonation session'
);

-- === Admin A opens an impersonation session acting as Chiara ============
select lives_ok(
  format(
    $$ select platform_open_impersonation_session(%L::uuid, '00000085-0000-0000-0000-0000000d0301', 'Test: completare una richiesta come Chiara') $$,
    :'fixture_property_id'
  ),
  'Admin A opens an impersonation session, viewing as Chiara'
);

select lives_ok(
  $$ select platform_impersonated_complete_guest_request('00000085-0000-0000-0000-0000000ee201'::uuid, '00000085-0000-0000-0000-0000000d0301'::uuid) $$,
  'Admin A completes the request while viewing as Chiara -- the real write this PR adds'
);

reset role;
select is(
  (select status::text from guest_requests where id = '00000085-0000-0000-0000-0000000ee201'),
  'completed',
  'the guest_requests row is genuinely updated, not just a mirrored UI state'
);
select is(
  (select actor_profile_id from platform_audit_log
    where action = 'platform.impersonated_guest_request_completed'
    order by created_at desc limit 1),
  '00000085-0000-0000-0000-000000000201'::uuid,
  'the audit log attributes the write to Admin Master herself, never to Chiara -- the one non-negotiable constraint'
);

select is(
  (select metadata->>'acting_as_profile_id' from platform_audit_log
    where action = 'platform.impersonated_guest_request_completed'
    order by created_at desc limit 1),
  '00000085-0000-0000-0000-000000000301',
  'the audit log records WHOSE functional authority was exercised, as metadata, never as the actor'
);
set local role authenticated;
set local request.jwt.claim.sub = '00000085-0000-0000-0000-000000000201';
set local request.jwt.claims = '{"aal":"aal2"}';

-- === invalid transitions =================================================
select throws_ok(
  $$ select platform_impersonated_complete_guest_request('00000085-0000-0000-0000-0000000ee201'::uuid, '00000085-0000-0000-0000-0000000d0301'::uuid) $$,
  '22023', 'invalid_transition', 'completing an already-completed request is rejected'
);

select throws_ok(
  $$ select platform_impersonated_complete_guest_request('00000085-0000-0000-0000-0000000ee202'::uuid, '00000085-0000-0000-0000-0000000d0301'::uuid) $$,
  '22023', 'invalid_transition', 'a still-requested request cannot be completed -- only in_progress->completed is wired'
);

-- === acting as someone with no Housekeeping access at all =================
select lives_ok(
  format(
    $$ select platform_open_impersonation_session(%L::uuid, %L, 'Test: Marco has no Housekeeping access') $$,
    :'fixture_property_id', '00000085-0000-0000-0000-0000000d0302'
  ),
  'opening a session acting as Marco is itself allowed (a valid, active Core membership) -- the write itself is what must deny him'
);

select throws_ok(
  $$ select platform_impersonated_complete_guest_request('00000085-0000-0000-0000-0000000ee202'::uuid, '00000085-0000-0000-0000-0000000d0302'::uuid) $$,
  '42501', 'acting_as_has_no_housekeeping_access', 'Marco was never bridged into Housekeeping -- acting as him for this write is denied'
);

-- === Admin B, without platform.impersonation.write, cannot even open one ==
set local request.jwt.claim.sub = '00000085-0000-0000-0000-000000000202';
select throws_ok(
  format(
    $$ select platform_open_impersonation_session(%L::uuid, '00000085-0000-0000-0000-0000000d0301', null) $$,
    :'fixture_property_id'
  ),
  '42501', null, 'Admin B, holding platform.support.read but not platform.impersonation.write, cannot open an impersonation session'
);

-- === an ordinary tenant staff member, not a platform admin at all ========
set local request.jwt.claim.sub = '00000085-0000-0000-0000-000000000401';
select throws_ok(
  $$ select platform_impersonated_complete_guest_request('00000085-0000-0000-0000-0000000ee202'::uuid, '00000085-0000-0000-0000-0000000d0301'::uuid) $$,
  '42501', null, 'an ordinary tenant staff member, not a platform admin at all, cannot reach this RPC either'
);

select * from finish();
rollback;
