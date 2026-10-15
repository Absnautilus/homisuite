-- Platform Admin read-only APIs (Fase B, PR B2): organizations/properties/
-- modules listing, console-access + view auditing, and isolation from both
-- ordinary users and client org admins.
begin;
create extension if not exists pgtap;
select plan(19);

-- Fixtures: one organization admin of a REAL client org (to prove holding a
-- client role grants nothing here), one platform admin with every read
-- permission, one platform admin with none, one suspended platform admin,
-- and a dedicated org/property/module set isolated from any other test or
-- seed data.
insert into organizations (id, name, slug) values
  ('00000076-0000-0000-0000-000000000001', 'Test Org 076', 'test-076-org');

insert into properties (id, organization_id, name, slug, settings) values
  ('00000076-0000-0000-0000-000000000011', '00000076-0000-0000-0000-000000000001', 'Test Property 076', 'test-076-prop', '{"secret_internal_note": "never return this"}'::jsonb);

insert into modules (id, slug, display_name) values
  ('00000076-0000-0000-0000-000000000021', 'test_076_module', 'Test Module 076');

insert into property_modules (property_id, module_id, enabled) values
  ('00000076-0000-0000-0000-000000000011', '00000076-0000-0000-0000-000000000021', true);

insert into auth.users (id) values
  ('00000076-0000-0000-0000-000000000031'), -- client organization_admin of Test Org 076 (NOT a platform admin)
  ('00000076-0000-0000-0000-000000000032'), -- platform admin, full read permissions, MFA verified in tests below
  ('00000076-0000-0000-0000-000000000033'), -- platform admin, NO permissions granted
  ('00000076-0000-0000-0000-000000000034'); -- SUSPENDED platform admin, otherwise fully permissioned

insert into profiles (id, full_name) values
  ('00000076-0000-0000-0000-000000000031', 'Client Org Admin 076'),
  ('00000076-0000-0000-0000-000000000032', 'Platform Admin — full read'),
  ('00000076-0000-0000-0000-000000000033', 'Platform Admin — no permissions'),
  ('00000076-0000-0000-0000-000000000034', 'Platform Admin — suspended');

insert into memberships (profile_id, organization_id, role_id, status) values
  ('00000076-0000-0000-0000-000000000031', '00000076-0000-0000-0000-000000000001',
   (select id from roles where slug = 'organization_admin'), 'active');

insert into platform_admins (id, profile_id, status) values
  ('00000076-0000-0000-0000-00000000a032', '00000076-0000-0000-0000-000000000032', 'active'),
  ('00000076-0000-0000-0000-00000000a033', '00000076-0000-0000-0000-000000000033', 'active'),
  ('00000076-0000-0000-0000-00000000a034', '00000076-0000-0000-0000-000000000034', 'suspended');

insert into platform_admin_permissions (platform_admin_id, permission_slug) values
  ('00000076-0000-0000-0000-00000000a032', 'platform.organizations.read'),
  ('00000076-0000-0000-0000-00000000a032', 'platform.properties.read'),
  ('00000076-0000-0000-0000-00000000a032', 'platform.audit.read'),
  ('00000076-0000-0000-0000-00000000a034', 'platform.organizations.read'),
  ('00000076-0000-0000-0000-00000000a034', 'platform.properties.read'),
  ('00000076-0000-0000-0000-00000000a034', 'platform.audit.read');

-- === client organization_admin: a real client role grants nothing here ====

set local role authenticated;
set local request.jwt.claim.sub = '00000076-0000-0000-0000-000000000031';
set local request.jwt.claims = '{"aal":"aal2"}';

select throws_like(
  $$ select * from platform_list_organizations() $$,
  '%insufficient_privilege%',
  'a real client organization_admin (not a platform admin) cannot list organizations -- holding a client role grants nothing on the platform surface'
);
select throws_like(
  $$ select * from platform_list_properties('00000076-0000-0000-0000-000000000001') $$,
  '%insufficient_privilege%',
  'a client organization_admin of Test Org 076 itself still cannot drill into its own org through the platform API'
);

-- === platform admin with NO permissions granted ============================

set local request.jwt.claim.sub = '00000076-0000-0000-0000-000000000033';
set local request.jwt.claims = '{"aal":"aal2"}';
select throws_like(
  $$ select * from platform_list_organizations() $$,
  '%insufficient_privilege%',
  'an active platform admin with no platform.organizations.read grant is still denied -- being a platform admin is not itself a permission'
);

-- === suspended platform admin, otherwise fully permissioned ================

set local request.jwt.claim.sub = '00000076-0000-0000-0000-000000000034';
set local request.jwt.claims = '{"aal":"aal2"}';
select throws_like(
  $$ select * from platform_list_organizations() $$,
  '%insufficient_privilege%',
  'a SUSPENDED platform admin is denied even with permission rows still attached and a verified MFA session'
);

-- === authorized platform admin, but MFA not verified this session ==========

set local request.jwt.claim.sub = '00000076-0000-0000-0000-000000000032';
set local request.jwt.claims = '{"aal":"aal1"}';
select throws_like(
  $$ select * from platform_list_organizations() $$,
  '%mfa_required%',
  'a fully-permissioned platform admin without a verified MFA session is still denied -- permission alone is not enough'
);
select throws_like(
  $$ select * from platform_list_property_modules('00000076-0000-0000-0000-000000000011') $$,
  '%mfa_required%',
  'the MFA gate applies to the module-listing RPC too, not only the organization one'
);

-- === authorized + MFA-verified: the real, successful path ==================

set local request.jwt.claims = '{"aal":"aal2"}';

select results_eq(
  $$ select name from platform_list_organizations() where id = '00000076-0000-0000-0000-000000000001' $$,
  $$ values ('Test Org 076'::text) $$,
  'an authorized, MFA-verified platform admin can list organizations and sees the test org'
);

select results_eq(
  $$ select name from platform_list_properties('00000076-0000-0000-0000-000000000001') $$,
  $$ values ('Test Property 076'::text) $$,
  'platform_list_properties returns the organization''s property'
);

select is_empty(
  $$ select 1 from (
       select * from platform_list_properties('00000076-0000-0000-0000-000000000001')
     ) row_data
     where row_data::text ilike '%secret_internal_note%'
  $$,
  'platform_list_properties never leaks properties.settings -- no unnecessary sensitive data'
);

select results_eq(
  $$ select slug, enabled from platform_list_property_modules('00000076-0000-0000-0000-000000000011') where slug = 'test_076_module' $$,
  $$ values ('test_076_module'::text, true) $$,
  'platform_list_property_modules reports the enabled test module correctly'
);

select throws_like(
  $$ select * from platform_list_property_modules('00000000-0000-0000-0000-000000000000') $$,
  '%property_not_found%',
  'a nonexistent property id is rejected explicitly, not silently returning zero rows'
);

-- === console access + audit logging =========================================

select lives_ok(
  $$ select platform_log_console_access() $$,
  'an active platform admin (even one with no read permissions) can log a console-access event'
);

set local request.jwt.claim.sub = '00000076-0000-0000-0000-000000000033';
set local request.jwt.claims = '{"aal":"aal1"}';
select lives_ok(
  $$ select platform_log_console_access() $$,
  'console access logging itself needs no permission grant and no verified MFA -- reaching the console pre-MFA must still be loggable'
);

set local request.jwt.claim.sub = '00000076-0000-0000-0000-000000000031';
set local request.jwt.claims = '{"aal":"aal2"}';
select throws_like(
  $$ select platform_log_console_access() $$,
  '%insufficient_privilege%',
  'an ordinary client org admin cannot log a console-access event either -- is_platform_admin() still gates it'
);

set local request.jwt.claim.sub = '00000076-0000-0000-0000-000000000032';
set local request.jwt.claims = '{"aal":"aal2"}';
-- platform_list_properties was called twice above (the name check and the
-- settings-leak check), so two real 'platform.organization_viewed' entries
-- are expected -- the point here is that the view was audited at all, with
-- the right target, not a specific call count.
select results_eq(
  $$ select count(*) from platform_list_audit_log(50, 0)
     where action = 'platform.organization_viewed' and target_id = '00000076-0000-0000-0000-000000000001' $$,
  $$ values (2::bigint) $$,
  'the earlier platform_list_properties calls were actually audited'
);
select results_eq(
  $$ select count(*) from platform_list_audit_log(50, 0) where action = 'platform.console_accessed' $$,
  $$ values (2::bigint) $$,
  'both console-access calls above (permissioned and un-permissioned admin) were recorded'
);

set local request.jwt.claim.sub = '00000076-0000-0000-0000-000000000033';
select throws_like(
  $$ select * from platform_list_audit_log(50, 0) $$,
  '%insufficient_privilege%',
  'a platform admin without platform.audit.read cannot read the audit log, even though they can trigger entries in it'
);

-- === the log itself is not directly reachable ===============================

set local request.jwt.claim.sub = '00000076-0000-0000-0000-000000000032';
set local request.jwt.claims = '{"aal":"aal2"}';
select throws_ok(
  $$ insert into platform_audit_log (action) values ('platform.console_accessed') $$,
  '42501',
  null,
  'no authenticated role, not even a fully-permissioned platform admin, can INSERT into platform_audit_log directly -- only log_platform_action (uncallable itself) can, from inside an already-verified RPC'
);
select throws_ok(
  $$ select log_platform_action('platform.console_accessed') $$,
  '42501',
  null,
  'log_platform_action itself has no grant to any client role -- it is reachable only from inside another SECURITY DEFINER function''s body'
);

select * from finish();
rollback;
