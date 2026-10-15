-- Platform Admin organization/property/module management (Fase B, PR B4):
-- create/update organizations and properties, toggle property_modules, audit
-- logging for every write, and isolation from both ordinary users and
-- partially-permissioned platform admins.
begin;
create extension if not exists pgtap;
select plan(29);

insert into auth.users (id) values
  ('00000077-0000-0000-0000-000000000001'), -- full manage (orgs+properties), MFA verified
  ('00000077-0000-0000-0000-000000000002'), -- read-only platform admin (no manage)
  ('00000077-0000-0000-0000-000000000003'), -- full manage, MFA NOT verified
  ('00000077-0000-0000-0000-000000000004'), -- organizations.manage ONLY (no properties.manage)
  ('00000077-0000-0000-0000-000000000005'); -- real client organization_admin

insert into profiles (id, full_name) values
  ('00000077-0000-0000-0000-000000000001', 'PA — full manage'),
  ('00000077-0000-0000-0000-000000000002', 'PA — read only'),
  ('00000077-0000-0000-0000-000000000003', 'PA — manage, no MFA'),
  ('00000077-0000-0000-0000-000000000004', 'PA — orgs manage only'),
  ('00000077-0000-0000-0000-000000000005', 'Client org admin');

insert into platform_admins (id, profile_id, status) values
  ('00000077-0000-0000-0000-00000000a001', '00000077-0000-0000-0000-000000000001', 'active'),
  ('00000077-0000-0000-0000-00000000a002', '00000077-0000-0000-0000-000000000002', 'active'),
  ('00000077-0000-0000-0000-00000000a003', '00000077-0000-0000-0000-000000000003', 'active'),
  ('00000077-0000-0000-0000-00000000a004', '00000077-0000-0000-0000-000000000004', 'active');

insert into platform_admin_permissions (platform_admin_id, permission_slug) values
  ('00000077-0000-0000-0000-00000000a001', 'platform.organizations.manage'),
  ('00000077-0000-0000-0000-00000000a001', 'platform.properties.manage'),
  ('00000077-0000-0000-0000-00000000a001', 'platform.audit.read'),
  ('00000077-0000-0000-0000-00000000a002', 'platform.organizations.read'),
  ('00000077-0000-0000-0000-00000000a003', 'platform.organizations.manage'),
  ('00000077-0000-0000-0000-00000000a003', 'platform.properties.manage'),
  ('00000077-0000-0000-0000-00000000a004', 'platform.organizations.manage');

-- Fixture organization/property this test's updates/toggles operate on
-- (distinct from anything platform_create_organization creates below).
insert into organizations (id, name, slug) values
  ('00000077-0000-0000-0000-000000000011', 'Fixture Org 077', 'test-077-org');
insert into properties (id, organization_id, name, slug, status, timezone) values
  ('00000077-0000-0000-0000-000000000021', '00000077-0000-0000-0000-000000000011', 'Fixture Property 077', 'test-077-prop', 'active', 'Europe/Rome');
insert into modules (id, slug, display_name) values
  ('00000077-0000-0000-0000-000000000031', 'test_077_module', 'Test Module 077');

insert into memberships (profile_id, organization_id, role_id, status) values
  ('00000077-0000-0000-0000-000000000005', '00000077-0000-0000-0000-000000000011',
   (select id from roles where slug = 'organization_admin'), 'active');

-- === isolation: a real client org admin gets nothing here ===================

set local role authenticated;
set local request.jwt.claim.sub = '00000077-0000-0000-0000-000000000005';
set local request.jwt.claims = '{"aal":"aal2"}';
select throws_like(
  $$ select platform_create_organization('Should Fail', 'should-fail') $$,
  '%insufficient_privilege%',
  'a real client organization_admin cannot create an organization'
);
select throws_like(
  $$ select platform_set_property_module('00000077-0000-0000-0000-000000000021', 'test_077_module', true) $$,
  '%insufficient_privilege%',
  'a real client organization_admin cannot toggle a property module'
);

set local role anon;
select throws_ok(
  $$ select platform_create_organization('Should Fail', 'should-fail') $$,
  '42501', null, 'anon cannot execute platform_create_organization'
);

-- === read-only platform admin: holding .read does not imply .manage ========

set local role authenticated;
set local request.jwt.claim.sub = '00000077-0000-0000-0000-000000000002';
set local request.jwt.claims = '{"aal":"aal2"}';
select throws_like(
  $$ select platform_create_organization('Should Fail', 'should-fail') $$,
  '%insufficient_privilege%',
  'a platform admin holding only platform.organizations.read cannot create an organization'
);

-- === manage permission held, but MFA not verified this session =============

set local request.jwt.claim.sub = '00000077-0000-0000-0000-000000000003';
set local request.jwt.claims = '{"aal":"aal1"}';
select throws_like(
  $$ select platform_create_organization('Should Fail', 'should-fail') $$,
  '%mfa_required%',
  'platform.organizations.manage without a verified MFA session still cannot create an organization'
);
select throws_like(
  $$ select platform_set_property_module('00000077-0000-0000-0000-000000000021', 'test_077_module', true) $$,
  '%mfa_required%',
  'the MFA gate applies to the module-toggle RPC too'
);

-- === organizations.manage only -- cannot touch properties ===================

set local request.jwt.claim.sub = '00000077-0000-0000-0000-000000000004';
set local request.jwt.claims = '{"aal":"aal2"}';
select lives_ok(
  $$ select platform_update_organization('00000077-0000-0000-0000-000000000011', 'Renamed By Orgs-Only Admin') $$,
  'an admin with only platform.organizations.manage CAN rename an organization'
);
select throws_like(
  $$ select platform_create_property('00000077-0000-0000-0000-000000000011', 'Should Fail', 'should-fail') $$,
  '%insufficient_privilege%',
  'the same admin, holding only organizations.manage, cannot create a property -- separate permission'
);
select throws_like(
  $$ select platform_set_property_module('00000077-0000-0000-0000-000000000021', 'test_077_module', true) $$,
  '%insufficient_privilege%',
  'nor can they toggle a property module'
);

-- === fully authorized path ===================================================

set local request.jwt.claim.sub = '00000077-0000-0000-0000-000000000001';
set local request.jwt.claims = '{"aal":"aal2"}';

select lives_ok(
  $$ select platform_create_organization('New Org 077', 'new-org-077') $$,
  'a fully-permissioned, MFA-verified admin can create an organization'
);

-- Verification selects below run with the lockdown lifted (`reset role`):
-- confirming a row actually changed is test introspection against tables
-- that carry their own client-facing RLS (organizations/properties/
-- property_modules), not something these admin profiles (holding no
-- membership at all) could read back directly -- that isolation is covered
-- elsewhere, not the point of these assertions.
reset role;
select results_eq(
  $$ select name, slug from organizations where slug = 'new-org-077' $$,
  $$ values ('New Org 077'::text, 'new-org-077'::text) $$,
  'the new organization row has the expected name and slug'
);

set local role authenticated;
set local request.jwt.claim.sub = '00000077-0000-0000-0000-000000000001';
set local request.jwt.claims = '{"aal":"aal2"}';
select throws_like(
  $$ select platform_create_organization('', 'blank-name') $$,
  '%invalid_input%',
  'an empty name is rejected explicitly'
);

select lives_ok(
  $$ select platform_update_organization('00000077-0000-0000-0000-000000000011', 'Fixture Org 077 Renamed') $$,
  'the fixture organization can be renamed'
);
reset role;
select results_eq(
  $$ select name from organizations where id = '00000077-0000-0000-0000-000000000011' $$,
  $$ values ('Fixture Org 077 Renamed'::text) $$,
  'the rename actually took effect'
);

set local role authenticated;
set local request.jwt.claim.sub = '00000077-0000-0000-0000-000000000001';
set local request.jwt.claims = '{"aal":"aal2"}';
select throws_like(
  $$ select platform_update_organization('00000000-0000-0000-0000-000000000000', 'Nobody') $$,
  '%organization_not_found%',
  'updating a nonexistent organization is rejected explicitly'
);

select lives_ok(
  $$ select platform_create_property('00000077-0000-0000-0000-000000000011', 'New Property 077', 'new-prop-077') $$,
  'a property can be created under the organization, using the default timezone'
);
reset role;
select results_eq(
  $$ select name, timezone, status from properties where slug = 'new-prop-077' $$,
  $$ values ('New Property 077'::text, 'Europe/Rome'::text, 'active'::text) $$,
  'the new property defaults to Europe/Rome and status active'
);

set local role authenticated;
set local request.jwt.claim.sub = '00000077-0000-0000-0000-000000000001';
set local request.jwt.claims = '{"aal":"aal2"}';
select throws_like(
  $$ select platform_create_property('00000000-0000-0000-0000-000000000000', 'Orphan', 'orphan-prop') $$,
  '%organization_not_found%',
  'creating a property under a nonexistent organization is rejected'
);

select lives_ok(
  $$ select platform_update_property('00000077-0000-0000-0000-000000000021', 'Fixture Property Renamed', 'America/New_York', 'suspended') $$,
  'the fixture property can be renamed, re-timezoned, and suspended'
);
reset role;
select results_eq(
  $$ select name, timezone, status from properties where id = '00000077-0000-0000-0000-000000000021' $$,
  $$ values ('Fixture Property Renamed'::text, 'America/New_York'::text, 'suspended'::text) $$,
  'the property update actually took effect'
);

set local role authenticated;
set local request.jwt.claim.sub = '00000077-0000-0000-0000-000000000001';
set local request.jwt.claims = '{"aal":"aal2"}';
select throws_like(
  $$ select platform_update_property('00000077-0000-0000-0000-000000000021', 'X', 'Europe/Rome', 'not-a-real-status') $$,
  '%invalid_status%',
  'an invalid status value is rejected explicitly, not left to the raw DB constraint'
);

-- Module toggle: enable, verify, disable, verify -- same row updated (upsert).
select lives_ok(
  $$ select platform_set_property_module('00000077-0000-0000-0000-000000000021', 'test_077_module', true) $$,
  'the module can be enabled for the property'
);
reset role;
select results_eq(
  $$ select enabled from property_modules where property_id = '00000077-0000-0000-0000-000000000021'
       and module_id = '00000077-0000-0000-0000-000000000031' $$,
  $$ values (true) $$,
  'the module shows enabled=true'
);

set local role authenticated;
set local request.jwt.claim.sub = '00000077-0000-0000-0000-000000000001';
set local request.jwt.claims = '{"aal":"aal2"}';
select lives_ok(
  $$ select platform_set_property_module('00000077-0000-0000-0000-000000000021', 'test_077_module', false) $$,
  'the same module can be disabled again'
);
reset role;
select results_eq(
  $$ select count(*) from property_modules where property_id = '00000077-0000-0000-0000-000000000021'
       and module_id = '00000077-0000-0000-0000-000000000031' $$,
  $$ values (1::bigint) $$,
  'toggling twice still leaves exactly one row -- an upsert, not a new insert'
);

set local role authenticated;
set local request.jwt.claim.sub = '00000077-0000-0000-0000-000000000001';
set local request.jwt.claims = '{"aal":"aal2"}';
select throws_like(
  $$ select platform_set_property_module('00000077-0000-0000-0000-000000000021', 'nonexistent_module_slug', true) $$,
  '%unknown_module%',
  'an unknown module slug is rejected explicitly'
);
select throws_like(
  $$ select platform_set_property_module('00000000-0000-0000-0000-000000000000', 'test_077_module', true) $$,
  '%property_not_found%',
  'a nonexistent property id is rejected explicitly'
);

-- === audit trail =============================================================

select results_eq(
  $$ select count(*) from platform_list_audit_log(200, 0)
     where action = 'platform.organization_created' and metadata ->> 'slug' = 'new-org-077' $$,
  $$ values (1::bigint) $$,
  'organization creation was audited, with the new org''s slug in the audit metadata'
);
select results_eq(
  $$ select count(*) from platform_list_audit_log(200, 0)
     where action = 'platform.property_module_toggled' and target_id = '00000077-0000-0000-0000-000000000021' $$,
  $$ values (2::bigint) $$,
  'both module toggles (enable + disable) were audited'
);

select * from finish();
rollback;
