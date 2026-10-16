-- Platform Admin team management -- list + create (Fase C, PR C5). The
-- first write capability for Admin Master past Fase C's original read-only
-- boundary. Exercises platform_operational_action_allowed() as the shared
-- gate for both platform_list_property_team and
-- platform_insert_team_membership -- opening a session alone is not
-- enough, platform.team.manage must be held independently of
-- platform.support.read (which only ever controls opening the session
-- itself).
begin;
create extension if not exists pgtap;
select plan(11);

insert into organizations (id, name, slug) values
  ('00000084-0000-0000-0000-000000000001', 'Team Mgmt Org 084', 'test-084-org');
insert into properties (id, organization_id, name, slug) values
  ('00000084-0000-0000-0000-000000000011', '00000084-0000-0000-0000-000000000001', 'Property 084', 'test-084-a');

insert into property_job_titles (id, property_id, name, active) values
  ('00000084-0000-0000-0000-000000000061', '00000084-0000-0000-0000-000000000011', 'Reception 084', true),
  ('00000084-0000-0000-0000-000000000062', '00000084-0000-0000-0000-000000000011', 'Inactive Job 084', false);

-- Real tenant staff already on the property -- proves the list RPC surfaces
-- genuine rows, not just ones Admin Master creates herself.
insert into auth.users (id, email) values
  ('00000084-0000-0000-0000-000000000041', 'staff-084@example.com');
insert into profiles (id, full_name) values
  ('00000084-0000-0000-0000-000000000041', 'Staff 084');
insert into memberships (profile_id, property_id, role_id, status) values
  ('00000084-0000-0000-0000-000000000041', '00000084-0000-0000-0000-000000000011',
   (select id from roles where slug = 'receptionist'), 'active');
insert into property_staff_details (property_id, profile_id, job_title_id) values
  ('00000084-0000-0000-0000-000000000011', '00000084-0000-0000-0000-000000000041', '00000084-0000-0000-0000-000000000061');

-- A profile with no membership anywhere yet -- the "new hire" Admin Master
-- creates a membership for below (auth.users/profiles creation itself is
-- the Edge Function's job, done here directly to isolate the RPC).
insert into auth.users (id, email) values
  ('00000084-0000-0000-0000-000000000051', 'new-hire-084@example.com');
insert into profiles (id, full_name) values
  ('00000084-0000-0000-0000-000000000051', 'New Hire 084');

-- A second such profile, for the invalid-role/invalid-job-title negative cases.
insert into auth.users (id, email) values
  ('00000084-0000-0000-0000-000000000052', 'rejected-hire-084@example.com');
insert into profiles (id, full_name) values
  ('00000084-0000-0000-0000-000000000052', 'Rejected Hire 084');

-- Platform Admin A: support.read (to open a session) + team.manage + MFA.
insert into auth.users (id, email) values
  ('00000084-0000-0000-0000-000000000201', 'pa-team-084@example.com');
insert into profiles (id, full_name) values
  ('00000084-0000-0000-0000-000000000201', 'PA — team manage');
insert into platform_admins (id, profile_id, status) values
  ('00000084-0000-0000-0000-00000000a201', '00000084-0000-0000-0000-000000000201', 'active');
insert into platform_admin_permissions (platform_admin_id, permission_slug) values
  ('00000084-0000-0000-0000-00000000a201', 'platform.support.read'),
  ('00000084-0000-0000-0000-00000000a201', 'platform.team.manage');

-- Platform Admin B: support.read + MFA, but no platform.team.manage -- can
-- open a session like any admin, but must still be denied the team RPCs.
insert into auth.users (id, email) values
  ('00000084-0000-0000-0000-000000000202', 'pa-noteam-084@example.com');
insert into profiles (id, full_name) values
  ('00000084-0000-0000-0000-000000000202', 'PA — no team manage');
insert into platform_admins (id, profile_id, status) values
  ('00000084-0000-0000-0000-00000000a202', '00000084-0000-0000-0000-000000000202', 'active');
insert into platform_admin_permissions (platform_admin_id, permission_slug) values
  ('00000084-0000-0000-0000-00000000a202', 'platform.support.read');

set local role authenticated;

-- === before any session: standing permission alone is not enough =========
set local request.jwt.claim.sub = '00000084-0000-0000-0000-000000000201';
set local request.jwt.claims = '{"aal":"aal2"}';
select throws_ok(
  $$ select * from platform_list_property_team('00000084-0000-0000-0000-000000000011') $$,
  '42501', null, 'Admin A cannot list the team before opening a session'
);

-- === Admin A opens a session, then the real write/read pair works ========
select lives_ok(
  $$ select platform_open_operational_session('00000084-0000-0000-0000-000000000011', null) $$,
  'Admin A opens an operational session on the fixture property'
);

select results_eq(
  $$ select full_name::text from platform_list_property_team('00000084-0000-0000-0000-000000000011') order by full_name $$,
  $$ values ('Staff 084'::text) $$,
  'with an active session, Admin A sees the real tenant staff member'
);

select lives_ok(
  format(
    $$ select platform_insert_team_membership('00000084-0000-0000-0000-000000000011'::uuid, %L::uuid, %L::uuid, 'new-hire-084', '00000084-0000-0000-0000-000000000061'::uuid) $$,
    '00000084-0000-0000-0000-000000000051', (select id from roles where slug = 'receptionist')
  ),
  'Admin A creates a membership for the new hire -- the actual write this PR adds'
);

select results_eq(
  $$ select full_name::text from platform_list_property_team('00000084-0000-0000-0000-000000000011') order by full_name $$,
  $$ values ('New Hire 084'::text), ('Staff 084'::text) $$,
  'the new membership is now visible through the same list RPC'
);

select throws_ok(
  format(
    $$ select platform_insert_team_membership('00000084-0000-0000-0000-000000000011'::uuid, %L::uuid, %L::uuid, 'rejected-084') $$,
    '00000084-0000-0000-0000-000000000052', (select id from roles where slug = 'organization_admin')
  ),
  '22023', 'invalid_role', 'an organization-scoped role is rejected -- this RPC only ever creates property-scoped memberships'
);

select throws_ok(
  format(
    $$ select platform_insert_team_membership('00000084-0000-0000-0000-000000000011'::uuid, %L::uuid, %L::uuid, 'rejected-084b', '00000084-0000-0000-0000-000000000062'::uuid) $$,
    '00000084-0000-0000-0000-000000000052', (select id from roles where slug = 'receptionist')
  ),
  '22023', 'invalid_job_title', 'an inactive job title on the same property is rejected'
);

-- === Admin B: a session alone is never enough without team.manage ========
set local request.jwt.claim.sub = '00000084-0000-0000-0000-000000000202';
select lives_ok(
  $$ select platform_open_operational_session('00000084-0000-0000-0000-000000000011', null) $$,
  'Admin B (no platform.team.manage) can still open a session -- that right alone is support.read''s'
);

select throws_ok(
  $$ select * from platform_list_property_team('00000084-0000-0000-0000-000000000011') $$,
  '42501', null, 'Admin B, despite an active session, is denied the team list without platform.team.manage'
);

select throws_ok(
  format(
    $$ select platform_insert_team_membership('00000084-0000-0000-0000-000000000011'::uuid, %L::uuid, %L::uuid, 'should-not-exist-084') $$,
    '00000084-0000-0000-0000-000000000052', (select id from roles where slug = 'receptionist')
  ),
  '42501', null, 'Admin B, despite an active session, is denied the team create without platform.team.manage'
);

-- === a real tenant staff member (no platform_admins row at all) ==========
set local request.jwt.claim.sub = '00000084-0000-0000-0000-000000000041';
select throws_ok(
  $$ select * from platform_list_property_team('00000084-0000-0000-0000-000000000011') $$,
  '42501', null, 'an ordinary tenant staff member, not a platform admin at all, cannot reach this RPC either'
);

select * from finish();
rollback;
