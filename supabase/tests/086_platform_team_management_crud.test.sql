-- Platform Admin team management -- edit, archive, reset password (Fase C
-- follow-up, PR C6). Exercises platform_update_team_membership,
-- platform_archive_team_member and platform_reset_team_member_password,
-- all gated the same way platform_list_property_team/platform_insert_
-- team_membership already are: platform_operational_action_allowed(
-- property_id, 'platform.team.manage').
begin;
create extension if not exists pgtap;
select plan(14);

insert into organizations (id, name, slug) values
  ('00000086-0000-0000-0000-000000000001', 'Team CRUD Org 086', 'test-086-org');
insert into properties (id, organization_id, name, slug) values
  ('00000086-0000-0000-0000-000000000011', '00000086-0000-0000-0000-000000000001', 'Property 086', 'test-086-a');

insert into property_job_titles (id, property_id, name, active) values
  ('00000086-0000-0000-0000-000000000061', '00000086-0000-0000-0000-000000000011', 'Reception 086', true),
  ('00000086-0000-0000-0000-000000000062', '00000086-0000-0000-0000-000000000011', 'Inactive Job 086', false);

-- Member 1: a credentials-based account (username set) -- the password
-- reset path.
insert into auth.users (id) values ('00000086-0000-0000-0000-000000000041');
insert into profiles (id, full_name) values ('00000086-0000-0000-0000-000000000041', 'Staff One 086');
insert into memberships (id, profile_id, property_id, role_id, status, username) values
  ('00000086-0000-0000-0000-0000000d0401', '00000086-0000-0000-0000-000000000041', '00000086-0000-0000-0000-000000000011',
   (select id from roles where slug = 'receptionist'), 'active', 'staffone086');

-- Member 2: an email-invited account (no username) -- "not a credentials
-- account" for password reset, and the archive target.
insert into auth.users (id) values ('00000086-0000-0000-0000-000000000042');
insert into profiles (id, full_name) values ('00000086-0000-0000-0000-000000000042', 'Staff Two 086');
insert into memberships (id, profile_id, property_id, role_id, status) values
  ('00000086-0000-0000-0000-0000000d0402', '00000086-0000-0000-0000-000000000042', '00000086-0000-0000-0000-000000000011',
   (select id from roles where slug = 'receptionist'), 'active');

-- Platform Admin A: platform.team.manage + support.read + MFA.
insert into auth.users (id) values ('00000086-0000-0000-0000-000000000201');
insert into profiles (id, full_name) values ('00000086-0000-0000-0000-000000000201', 'PA — team crud 086');
insert into platform_admins (id, profile_id, status) values
  ('00000086-0000-0000-0000-00000000a201', '00000086-0000-0000-0000-000000000201', 'active');
insert into platform_admin_permissions (platform_admin_id, permission_slug) values
  ('00000086-0000-0000-0000-00000000a201', 'platform.support.read'),
  ('00000086-0000-0000-0000-00000000a201', 'platform.team.manage');

-- Platform Admin B: support.read only -- never granted team.manage.
insert into auth.users (id) values ('00000086-0000-0000-0000-000000000202');
insert into profiles (id, full_name) values ('00000086-0000-0000-0000-000000000202', 'PA — no team crud 086');
insert into platform_admins (id, profile_id, status) values
  ('00000086-0000-0000-0000-00000000a202', '00000086-0000-0000-0000-000000000202', 'active');
insert into platform_admin_permissions (platform_admin_id, permission_slug) values
  ('00000086-0000-0000-0000-00000000a202', 'platform.support.read');

set local role authenticated;
set local request.jwt.claim.sub = '00000086-0000-0000-0000-000000000201';
set local request.jwt.claims = '{"aal":"aal2"}';

-- === before any session: standing permission alone is not enough ========
select throws_ok(
  $$ select platform_update_team_membership('00000086-0000-0000-0000-0000000d0401'::uuid, null, null, null, null) $$,
  '42501', null, 'Admin A cannot update a membership before opening a session'
);

-- === Admin A opens a session, then the real writes work =================
select lives_ok(
  $$ select platform_open_operational_session('00000086-0000-0000-0000-000000000011', null) $$,
  'Admin A opens an operational session on the fixture property'
);

select lives_ok(
  format(
    $$ select platform_update_team_membership('00000086-0000-0000-0000-0000000d0401'::uuid, %L::uuid, null, null, null) $$,
    (select id from roles where slug = 'manager')
  ),
  'Admin A changes member 1''s role to manager'
);

reset role;
select is(
  (select role_id from memberships where id = '00000086-0000-0000-0000-0000000d0401'),
  (select id from roles where slug = 'manager'),
  'the role change was genuinely applied'
);
set local role authenticated;
set local request.jwt.claim.sub = '00000086-0000-0000-0000-000000000201';
set local request.jwt.claims = '{"aal":"aal2"}';

select lives_ok(
  $$ select platform_update_team_membership('00000086-0000-0000-0000-0000000d0401'::uuid, null, '00000086-0000-0000-0000-000000000061'::uuid, 'inactive', null) $$,
  'Admin A updates member 1''s job title and employment status'
);

reset role;
select results_eq(
  $$ select job_title_id, employment_status from property_staff_details where property_id = '00000086-0000-0000-0000-000000000011' and profile_id = '00000086-0000-0000-0000-000000000041' $$,
  $$ values ('00000086-0000-0000-0000-000000000061'::uuid, 'inactive'::text) $$,
  'the job title and employment status were genuinely applied'
);
set local role authenticated;
set local request.jwt.claim.sub = '00000086-0000-0000-0000-000000000201';
set local request.jwt.claims = '{"aal":"aal2"}';

-- === invalid inputs are rejected, same as the tenant-side RPCs ===========
select throws_ok(
  format(
    $$ select platform_update_team_membership('00000086-0000-0000-0000-0000000d0401'::uuid, %L::uuid, null, null, null) $$,
    (select id from roles where slug = 'organization_admin')
  ),
  '22023', 'invalid_role', 'an organization-scoped role is rejected'
);

select throws_ok(
  $$ select platform_update_team_membership('00000086-0000-0000-0000-0000000d0401'::uuid, null, '00000086-0000-0000-0000-000000000062'::uuid, null, null) $$,
  '22023', 'invalid_job_title', 'an inactive job title on the same property is rejected'
);

-- === archive ==============================================================
select lives_ok(
  $$ select platform_archive_team_member('00000086-0000-0000-0000-0000000d0402'::uuid) $$,
  'Admin A archives member 2'
);

reset role;
select results_eq(
  $$ select status, (archived_at is not null) from memberships where id = '00000086-0000-0000-0000-0000000d0402' $$,
  $$ values ('suspended'::text, true) $$,
  'member 2 is archived: status suspended, archived_at stamped'
);
set local role authenticated;
set local request.jwt.claim.sub = '00000086-0000-0000-0000-000000000201';
set local request.jwt.claims = '{"aal":"aal2"}';

-- === password reset =======================================================
select is(
  (select platform_reset_team_member_password('00000086-0000-0000-0000-0000000d0401'::uuid)),
  '00000086-0000-0000-0000-000000000041'::uuid,
  'resetting member 1''s (credentials-based) password returns their profile id'
);

select throws_ok(
  $$ select platform_reset_team_member_password('00000086-0000-0000-0000-0000000d0402'::uuid) $$,
  '22023', 'not_a_credentials_account', 'member 2 has no username -- there is no admin-facing password to reset'
);

-- === Admin B, without platform.team.manage, is denied despite a session ==
set local request.jwt.claim.sub = '00000086-0000-0000-0000-000000000202';
select lives_ok(
  $$ select platform_open_operational_session('00000086-0000-0000-0000-000000000011', null) $$,
  'Admin B can still open a plain operational session (support.read alone)'
);
select throws_ok(
  format(
    $$ select platform_update_team_membership('00000086-0000-0000-0000-0000000d0401'::uuid, %L::uuid, null, null, null) $$,
    (select id from roles where slug = 'receptionist')
  ),
  '42501', null, 'Admin B, despite an active session, is denied without platform.team.manage'
);

select * from finish();
rollback;
