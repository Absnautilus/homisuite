-- 20261008090000_member_permission_overrides: has_permission() extended with
-- a per-membership override, plus the grant_member_permission /
-- revoke_member_permission / member_permission_status RPCs that manage it.
-- Generic across any module-scoped permission -- exercised here against the
-- real seeded 'dining.manage' and 'shifts.manage' slugs, since the whole
-- point is that Dining/Turni need no changes of their own to honor it.
--
-- Also covers 20261011122857_restrict_member_permission_delegation's own
-- intent (core.* and non-module slugs are not delegable) and its corrected
-- form (org-wide memberships can still be delegated to -- the original
-- hardening mistakenly required property_id to be set, which broke this
-- exact org-wide case; tests 14-15 below are what caught that regression).
begin;
create extension if not exists pgtap;
select plan(23);

insert into organizations (id, name, slug) values
  ('00000072-0000-0000-0000-000000000001', 'Org Settantadue X', 'test-072-org-x'),
  ('00000072-0000-0000-0000-000000000002', 'Org Settantadue Y', 'test-072-org-y');

insert into properties (id, organization_id, name, slug) values
  ('00000072-0000-0000-0000-000000000011', '00000072-0000-0000-0000-000000000001', 'Property X', 'test-072-x'),
  ('00000072-0000-0000-0000-000000000012', '00000072-0000-0000-0000-000000000002', 'Property Y', 'test-072-y'),
  -- Second property under org Y -- org-wide overrides must take effect on
  -- every property of the organization, not just the first one seeded.
  ('00000072-0000-0000-0000-000000000013', '00000072-0000-0000-0000-000000000002', 'Property Z', 'test-072-z');

insert into property_modules (property_id, module_id, enabled)
select '00000072-0000-0000-0000-000000000011', id, true from modules where slug = 'dining';
insert into property_modules (property_id, module_id, enabled)
select '00000072-0000-0000-0000-000000000012', id, true from modules where slug = 'shifts';
insert into property_modules (property_id, module_id, enabled)
select '00000072-0000-0000-0000-000000000013', id, true from modules where slug = 'shifts';

-- No seeded org-scoped role has zero permissions (organization_admin already
-- holds core.staff.manage and the module .manage grants outright), so an
-- org-wide member with nothing yet to override needs a fresh, deliberately
-- empty org-scoped role -- membership_validate_role_scope (0008) requires a
-- membership's own scope (property_id vs organization_id) to match its
-- role's scope, so this can't just reuse 'receptionist' (property-scoped).
insert into roles (id, slug, display_name, scope) values
  ('00000072-0000-0000-0000-0000000ff001', 'test_072_org_member', 'Org Member (no permissions)', 'organization');

insert into auth.users (id) values
  ('00000072-0000-0000-0000-000000000a01'), -- property_admin on property X
  ('00000072-0000-0000-0000-000000000a02'), -- receptionist on property X (member_a -- gets dining.manage override)
  ('00000072-0000-0000-0000-000000000a03'), -- organization_admin, org-wide on org Y
  ('00000072-0000-0000-0000-000000000a04'); -- no-permission role, org-wide on org Y (member_b -- gets shifts.manage override)

insert into profiles (id, full_name) values
  ('00000072-0000-0000-0000-000000000a01', 'Admin 72 X'),
  ('00000072-0000-0000-0000-000000000a02', 'Member 72 A'),
  ('00000072-0000-0000-0000-000000000a03', 'Org Admin 72 Y'),
  ('00000072-0000-0000-0000-000000000a04', 'Member 72 B');

insert into memberships (id, profile_id, property_id, role_id, status)
select '00000072-0000-0000-0000-000000000101', '00000072-0000-0000-0000-000000000a01', '00000072-0000-0000-0000-000000000011', id, 'active'
from roles where slug = 'property_admin';
insert into memberships (id, profile_id, property_id, role_id, status)
select '00000072-0000-0000-0000-000000000102', '00000072-0000-0000-0000-000000000a02', '00000072-0000-0000-0000-000000000011', id, 'active'
from roles where slug = 'receptionist';
insert into memberships (id, profile_id, organization_id, role_id, status)
select '00000072-0000-0000-0000-000000000103', '00000072-0000-0000-0000-000000000a03', '00000072-0000-0000-0000-000000000002', id, 'active'
from roles where slug = 'organization_admin';
insert into memberships (id, profile_id, organization_id, role_id, status) values
  ('00000072-0000-0000-0000-000000000104', '00000072-0000-0000-0000-000000000a04', '00000072-0000-0000-0000-000000000002', '00000072-0000-0000-0000-0000000ff001', 'active');

-- ### before any override: member_a's receptionist role doesn't include dining.manage ###
set local role authenticated;
set local request.jwt.claim.sub = '00000072-0000-0000-0000-000000000a02';
select ok(
  not has_permission('00000072-0000-0000-0000-000000000011', 'dining.manage'),
  'member_a has no dining.manage before any override'
);
reset role;

-- member_permission_status is admin-only (same gate as grant/revoke), so
-- it's checked as property_admin, not as member_a themselves.
set local role authenticated;
set local request.jwt.claim.sub = '00000072-0000-0000-0000-000000000a01';
select is(
  (select row(granted_by_role, granted_by_override) from member_permission_status('00000072-0000-0000-0000-000000000102', 'dining.manage')),
  row(false, false),
  'member_permission_status shows neither path granted yet'
);
reset role;

-- ### property_admin grants the override ###
set local role authenticated;
set local request.jwt.claim.sub = '00000072-0000-0000-0000-000000000a01';
select lives_ok(
  $$ select grant_member_permission('00000072-0000-0000-0000-000000000102', 'dining.manage') $$,
  'property_admin can grant dining.manage to member_a'
);
reset role;

set local role authenticated;
set local request.jwt.claim.sub = '00000072-0000-0000-0000-000000000a02';
select ok(
  has_permission('00000072-0000-0000-0000-000000000011', 'dining.manage'),
  'member_a now has dining.manage via the override'
);
reset role;

set local role authenticated;
set local request.jwt.claim.sub = '00000072-0000-0000-0000-000000000a01';
select is(
  (select row(granted_by_role, granted_by_override) from member_permission_status('00000072-0000-0000-0000-000000000102', 'dining.manage')),
  row(false, true),
  'member_permission_status reflects the override, not the role'
);
reset role;

-- ### idempotent grant: calling it again does not duplicate the row ###
set local role authenticated;
set local request.jwt.claim.sub = '00000072-0000-0000-0000-000000000a01';
select lives_ok(
  $$ select grant_member_permission('00000072-0000-0000-0000-000000000102', 'dining.manage') $$,
  'granting the same override twice does not error'
);
reset role;
select is(
  (select count(*)::int from membership_permission_grants g join permissions p on p.id = g.permission_id
     where g.membership_id = '00000072-0000-0000-0000-000000000102' and p.slug = 'dining.manage'),
  1,
  'exactly one override row exists after the duplicate grant'
);

-- ### unknown permission slug ###
set local role authenticated;
set local request.jwt.claim.sub = '00000072-0000-0000-0000-000000000a01';
select throws_ok(
  $$ select grant_member_permission('00000072-0000-0000-0000-000000000102', 'does.not.exist') $$,
  '22023',
  null,
  'granting an unknown permission slug is rejected'
);
reset role;

-- ### structural core.* permissions are never delegable, even to an admin
--     who already holds core.staff.manage themselves ###
set local role authenticated;
set local request.jwt.claim.sub = '00000072-0000-0000-0000-000000000a01';
select throws_ok(
  $$ select grant_member_permission('00000072-0000-0000-0000-000000000102', 'core.staff.manage') $$,
  '22023',
  null,
  'core.staff.manage cannot be delegated via an individual override'
);
reset role;

-- ### a member with no core.staff.manage cannot grant to anyone -- security
--     definer finds the membership regardless, so the explicit
--     has_permission check is what actually denies it ###
set local role authenticated;
set local request.jwt.claim.sub = '00000072-0000-0000-0000-000000000a02';
select throws_ok(
  $$ select grant_member_permission('00000072-0000-0000-0000-000000000104', 'shifts.manage') $$,
  '42501',
  null,
  'a receptionist (no core.staff.manage) cannot grant permissions to anyone'
);
reset role;

-- ### revoke ###
set local role authenticated;
set local request.jwt.claim.sub = '00000072-0000-0000-0000-000000000a01';
select lives_ok(
  $$ select revoke_member_permission('00000072-0000-0000-0000-000000000102', 'dining.manage') $$,
  'property_admin can revoke the override'
);
reset role;

set local role authenticated;
set local request.jwt.claim.sub = '00000072-0000-0000-0000-000000000a02';
select ok(
  not has_permission('00000072-0000-0000-0000-000000000011', 'dining.manage'),
  'member_a no longer has dining.manage after the revoke'
);
reset role;

set local role authenticated;
set local request.jwt.claim.sub = '00000072-0000-0000-0000-000000000a01';
select is(
  (select row(granted_by_role, granted_by_override) from member_permission_status('00000072-0000-0000-0000-000000000102', 'dining.manage')),
  row(false, false),
  'member_permission_status shows neither path granted after the revoke'
);
reset role;

-- ### idempotent revoke: nothing to remove, still succeeds ###
set local role authenticated;
set local request.jwt.claim.sub = '00000072-0000-0000-0000-000000000a01';
select lives_ok(
  $$ select revoke_member_permission('00000072-0000-0000-0000-000000000102', 'dining.manage') $$,
  'revoking an override that no longer exists does not error'
);
reset role;

-- ### org-wide target membership: the organization_id branch ###
set local role authenticated;
set local request.jwt.claim.sub = '00000072-0000-0000-0000-000000000a03';
select lives_ok(
  $$ select grant_member_permission('00000072-0000-0000-0000-000000000104', 'shifts.manage') $$,
  'organization_admin can grant shifts.manage to an org-wide member'
);
reset role;

set local role authenticated;
set local request.jwt.claim.sub = '00000072-0000-0000-0000-000000000a04';
select ok(
  has_permission('00000072-0000-0000-0000-000000000012', 'shifts.manage'),
  'member_b now has shifts.manage on property Y via the org-wide override'
);
reset role;

-- An org-wide override must take effect on every property of the
-- organization, not just the first one -- this is what the hardening
-- migration's property_membership_required check broke: it didn't just
-- reject the grant, it also would have meant has_permission's own
-- organization_id branch was never actually exercised across more than one
-- property in this suite.
set local role authenticated;
set local request.jwt.claim.sub = '00000072-0000-0000-0000-000000000a04';
select ok(
  has_permission('00000072-0000-0000-0000-000000000013', 'shifts.manage'),
  'member_b also has shifts.manage on property Z (same org, different property) via the org-wide override'
);
reset role;

set local role authenticated;
set local request.jwt.claim.sub = '00000072-0000-0000-0000-000000000a03';
select lives_ok(
  $$ select revoke_member_permission('00000072-0000-0000-0000-000000000104', 'shifts.manage') $$,
  'organization_admin can revoke the org-wide override'
);
reset role;

set local role authenticated;
set local request.jwt.claim.sub = '00000072-0000-0000-0000-000000000a04';
select ok(
  not has_permission('00000072-0000-0000-0000-000000000012', 'shifts.manage'),
  'member_b no longer has shifts.manage after the revoke'
);
select ok(
  not has_permission('00000072-0000-0000-0000-000000000013', 'shifts.manage'),
  'member_b no longer has shifts.manage on property Z either, after the revoke'
);
reset role;

-- ### cross-tenant: property X's admin cannot reach into org Y at all ###
set local role authenticated;
set local request.jwt.claim.sub = '00000072-0000-0000-0000-000000000a01';
select throws_ok(
  $$ select grant_member_permission('00000072-0000-0000-0000-000000000104', 'shifts.manage') $$,
  '42501',
  null,
  'property X''s admin cannot grant permissions to a membership in an unrelated organization'
);
reset role;

-- ### anon cannot call either RPC at all ###
set local role anon;
select throws_ok(
  $$ select grant_member_permission('00000072-0000-0000-0000-000000000102', 'dining.manage') $$,
  '42501',
  null,
  'anon cannot call grant_member_permission at all'
);
select throws_ok(
  $$ select revoke_member_permission('00000072-0000-0000-0000-000000000102', 'dining.manage') $$,
  '42501',
  null,
  'anon cannot call revoke_member_permission at all'
);
reset role;

select * from finish();
rollback;
