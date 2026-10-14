-- 20261013120000_membership_module_access: has_permission() extended with a
-- per-membership MODULE ACCESS gate (distinct from membership_permission_grants'
-- own per-permission override), plus set_member_module_access /
-- member_module_access_status. Exercised against the real seeded 'shifts'
-- module/'shifts.view'+'shifts.manage' permissions (Turni has no per-member
-- gate at all today) and 'dining'/'dining.manage' (to confirm the new gate
-- composes correctly with an existing module-scoped permission override).
begin;
create extension if not exists pgtap;
select plan(26);

insert into organizations (id, name, slug) values
  ('00000073-0000-0000-0000-000000000001', 'Org Settantatre', 'test-073-org');

insert into properties (id, organization_id, name, slug) values
  ('00000073-0000-0000-0000-000000000011', '00000073-0000-0000-0000-000000000001', 'Property Settantatre', 'test-073-prop');

insert into property_modules (property_id, module_id, enabled)
select '00000073-0000-0000-0000-000000000011', id, true from modules where slug = 'shifts';
insert into property_modules (property_id, module_id, enabled)
select '00000073-0000-0000-0000-000000000011', id, true from modules where slug = 'dining';

insert into auth.users (id) values
  ('00000073-0000-0000-0000-000000000a01'), -- property_admin
  ('00000073-0000-0000-0000-000000000a02'), -- receptionist (member_a, holds shifts.view by role)
  ('00000073-0000-0000-0000-000000000a03'); -- receptionist (member_b, no core.staff.manage of their own)

insert into profiles (id, full_name) values
  ('00000073-0000-0000-0000-000000000a01', 'Admin 73'),
  ('00000073-0000-0000-0000-000000000a02', 'Member 73 A'),
  ('00000073-0000-0000-0000-000000000a03', 'Member 73 B');

insert into memberships (id, profile_id, property_id, role_id, status)
select '00000073-0000-0000-0000-000000000101', '00000073-0000-0000-0000-000000000a01', '00000073-0000-0000-0000-000000000011', id, 'active'
from roles where slug = 'property_admin';
insert into memberships (id, profile_id, property_id, role_id, status)
select '00000073-0000-0000-0000-000000000102', '00000073-0000-0000-0000-000000000a02', '00000073-0000-0000-0000-000000000011', id, 'active'
from roles where slug = 'receptionist';
insert into memberships (id, profile_id, property_id, role_id, status)
select '00000073-0000-0000-0000-000000000103', '00000073-0000-0000-0000-000000000a03', '00000073-0000-0000-0000-000000000011', id, 'active'
from roles where slug = 'receptionist';

-- ### absence of a row means access is allowed -- the default-safe
--     migration guarantee: no backfill, no accidental revocation ###
set local role authenticated;
set local request.jwt.claim.sub = '00000073-0000-0000-0000-000000000a02';
select ok(
  has_permission('00000073-0000-0000-0000-000000000011', 'shifts.view'),
  'member_a has shifts.view by role, with no membership_module_access row at all'
);
reset role;

set local role authenticated;
set local request.jwt.claim.sub = '00000073-0000-0000-0000-000000000a01';
select is(
  member_module_access_status('00000073-0000-0000-0000-000000000102', 'shifts'),
  true,
  'member_module_access_status defaults to true with no row'
);
reset role;

-- ### property_admin disables member_a's access to shifts ###
set local role authenticated;
set local request.jwt.claim.sub = '00000073-0000-0000-0000-000000000a01';
select lives_ok(
  $$ select set_member_module_access('00000073-0000-0000-0000-000000000102', 'shifts', false) $$,
  'property_admin can disable member_a''s access to shifts'
);
select is(
  member_module_access_status('00000073-0000-0000-0000-000000000102', 'shifts'),
  false,
  'member_module_access_status now reflects the explicit disable'
);
reset role;

-- ### module access block takes effect immediately on has_permission,
--     for BOTH a role-derived permission (shifts.view) and a permission
--     this member doesn't even have (shifts.manage) ###
set local role authenticated;
set local request.jwt.claim.sub = '00000073-0000-0000-0000-000000000a02';
select ok(
  not has_permission('00000073-0000-0000-0000-000000000011', 'shifts.view'),
  'member_a no longer has shifts.view once their module access is disabled'
);
reset role;

-- ### disabling access to shifts does not affect dining -- the gate is
--     per-module, not an all-or-nothing block on the membership ###
set local role authenticated;
set local request.jwt.claim.sub = '00000073-0000-0000-0000-000000000a01';
select lives_ok(
  $$ select grant_member_permission('00000073-0000-0000-0000-000000000102', 'dining.manage') $$,
  'property_admin can still grant member_a a dining permission while their shifts access is disabled'
);
reset role;

set local role authenticated;
set local request.jwt.claim.sub = '00000073-0000-0000-0000-000000000a02';
select ok(
  has_permission('00000073-0000-0000-0000-000000000011', 'dining.manage'),
  'member_a still has dining.manage via the override -- shifts access being off does not block dining'
);
reset role;

-- ### persistence: the permission override is NOT deleted by disabling
--     module access, and takes effect again automatically the moment
--     access is re-enabled -- this is also exercised directly against
--     shifts.manage below, which member_a does not hold by role ###
set local role authenticated;
set local request.jwt.claim.sub = '00000073-0000-0000-0000-000000000a01';
select lives_ok(
  $$ select grant_member_permission('00000073-0000-0000-0000-000000000102', 'shifts.manage') $$,
  'property_admin can grant shifts.manage to member_a even while their shifts module access is off'
);
reset role;

set local role authenticated;
set local request.jwt.claim.sub = '00000073-0000-0000-0000-000000000a02';
select ok(
  not has_permission('00000073-0000-0000-0000-000000000011', 'shifts.manage'),
  'the shifts.manage override exists but is ineffective while module access is disabled'
);
reset role;

select is(
  (select count(*)::int from membership_permission_grants g join permissions p on p.id = g.permission_id
     where g.membership_id = '00000073-0000-0000-0000-000000000102' and p.slug = 'shifts.manage'),
  1,
  'the override row itself is still stored, not deleted, while module access is off'
);

-- ### re-enable: the stored override becomes effective again automatically,
--     with no separate re-grant step ###
set local role authenticated;
set local request.jwt.claim.sub = '00000073-0000-0000-0000-000000000a01';
select lives_ok(
  $$ select set_member_module_access('00000073-0000-0000-0000-000000000102', 'shifts', true) $$,
  'property_admin re-enables member_a''s access to shifts'
);
reset role;

set local role authenticated;
set local request.jwt.claim.sub = '00000073-0000-0000-0000-000000000a02';
select ok(
  has_permission('00000073-0000-0000-0000-000000000011', 'shifts.view'),
  'member_a has shifts.view again now that module access is re-enabled'
);
select ok(
  has_permission('00000073-0000-0000-0000-000000000011', 'shifts.manage'),
  'the previously-stored shifts.manage override is effective again automatically, with no re-grant'
);
reset role;

-- ### structural (core.*) access is never affected by a module access
--     block -- module_id is null for every core.* permission, so the
--     gate added to has_permission() doesn't apply to it at all ###
set local role authenticated;
set local request.jwt.claim.sub = '00000073-0000-0000-0000-000000000a01';
select lives_ok(
  $$ select set_member_module_access('00000073-0000-0000-0000-000000000101', 'shifts', false) $$,
  'property_admin can disable their own module access to shifts (an unusual but valid admin action)'
);
reset role;

set local role authenticated;
set local request.jwt.claim.sub = '00000073-0000-0000-0000-000000000a01';
select ok(
  has_permission('00000073-0000-0000-0000-000000000011', 'core.staff.manage'),
  'property_admin retains core.staff.manage (structural) even with their own shifts access disabled'
);
-- ...and, since core.staff.manage is unaffected, they can still reach the
-- Team page and reverse their own mistake:
select lives_ok(
  $$ select set_member_module_access('00000073-0000-0000-0000-000000000101', 'shifts', true) $$,
  'property_admin can re-enable their own access -- no lockout, since core.staff.manage was never affected'
);
reset role;

-- ### unknown module slug ###
set local role authenticated;
set local request.jwt.claim.sub = '00000073-0000-0000-0000-000000000a01';
select throws_ok(
  $$ select set_member_module_access('00000073-0000-0000-0000-000000000102', 'does_not_exist', false) $$,
  '22023',
  null,
  'setting access on an unknown module slug is rejected'
);
reset role;

-- ### self-assignment: a member with no core.staff.manage of their own
--     cannot flip their OWN module access, even to re-enable it ###
set local role authenticated;
set local request.jwt.claim.sub = '00000073-0000-0000-0000-000000000a03';
select throws_ok(
  $$ select set_member_module_access('00000073-0000-0000-0000-000000000103', 'shifts', false) $$,
  '42501',
  null,
  'a receptionist (no core.staff.manage) cannot change their own module access'
);
reset role;

-- ### a member with no core.staff.manage cannot change anyone else's
--     module access either ###
set local role authenticated;
set local request.jwt.claim.sub = '00000073-0000-0000-0000-000000000a03';
select throws_ok(
  $$ select set_member_module_access('00000073-0000-0000-0000-000000000102', 'shifts', false) $$,
  '42501',
  null,
  'a receptionist (no core.staff.manage) cannot change another member''s module access either'
);
reset role;

-- ### anon cannot call either RPC at all ###
set local role anon;
select throws_ok(
  $$ select set_member_module_access('00000073-0000-0000-0000-000000000102', 'shifts', false) $$,
  '42501',
  null,
  'anon cannot call set_member_module_access at all'
);
select throws_ok(
  $$ select member_module_access_status('00000073-0000-0000-0000-000000000102', 'shifts') $$,
  '42501',
  null,
  'anon cannot call member_module_access_status at all'
);
reset role;

-- ### cross-tenant: an admin of one property cannot touch a membership in
--     an unrelated organization ###
insert into organizations (id, name, slug) values
  ('00000073-0000-0000-0000-000000000002', 'Org Settantatre Y', 'test-073-org-y');
insert into properties (id, organization_id, name, slug) values
  ('00000073-0000-0000-0000-000000000012', '00000073-0000-0000-0000-000000000002', 'Property Settantatre Y', 'test-073-y');
insert into property_modules (property_id, module_id, enabled)
select '00000073-0000-0000-0000-000000000012', id, true from modules where slug = 'shifts';
insert into auth.users (id) values ('00000073-0000-0000-0000-000000000a04');
insert into profiles (id, full_name) values ('00000073-0000-0000-0000-000000000a04', 'Member 73 Y');
insert into memberships (id, profile_id, property_id, role_id, status)
select '00000073-0000-0000-0000-000000000104', '00000073-0000-0000-0000-000000000a04', '00000073-0000-0000-0000-000000000012', id, 'active'
from roles where slug = 'receptionist';

set local role authenticated;
set local request.jwt.claim.sub = '00000073-0000-0000-0000-000000000a01';
select throws_ok(
  $$ select set_member_module_access('00000073-0000-0000-0000-000000000104', 'shifts', false) $$,
  '42501',
  null,
  'property_admin of property X cannot change module access for a membership in an unrelated organization'
);
reset role;

-- ### direct RPC access when nav would hide the module: has_permission
--     already enforces the block regardless of what the UI shows, so a
--     disabled member calling a shifts RPC directly still fails ###
set local role authenticated;
set local request.jwt.claim.sub = '00000073-0000-0000-0000-000000000a01';
select lives_ok(
  $$ select set_member_module_access('00000073-0000-0000-0000-000000000102', 'shifts', false) $$,
  'property_admin disables member_a''s shifts access again, for the direct-RPC-access check below'
);
reset role;

set local role authenticated;
set local request.jwt.claim.sub = '00000073-0000-0000-0000-000000000a02';
select ok(
  not has_permission('00000073-0000-0000-0000-000000000011', 'shifts.view'),
  'direct has_permission(''shifts.view'') call still fails for a module-access-disabled member, independent of any frontend nav check'
);
reset role;

-- ### module disabled for the whole structure (property_modules.enabled =
--     false) still blocks access even when the member's own individual
--     module access is enabled (the default) -- structure-wide entitlement
--     and per-member access are independent AND-conditions, neither one
--     substitutes for the other ###
update property_modules set enabled = false
where property_id = '00000073-0000-0000-0000-000000000011'
  and module_id = (select id from modules where slug = 'dining');

set local role authenticated;
set local request.jwt.claim.sub = '00000073-0000-0000-0000-000000000a02';
select ok(
  not has_permission('00000073-0000-0000-0000-000000000011', 'dining.manage'),
  'member_a''s own module access is still enabled, but dining.manage fails once the module itself is disabled structure-wide'
);
reset role;

update property_modules set enabled = true
where property_id = '00000073-0000-0000-0000-000000000011'
  and module_id = (select id from modules where slug = 'dining');

set local role authenticated;
set local request.jwt.claim.sub = '00000073-0000-0000-0000-000000000a02';
select ok(
  has_permission('00000073-0000-0000-0000-000000000011', 'dining.manage'),
  'dining.manage works again once the structure-wide module entitlement is restored, with no change to the member''s own access row'
);
reset role;

select * from finish();
rollback;
