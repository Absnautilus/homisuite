-- Platform Admin operational read access -- Shifts module (Fase C, PR C2).
-- Exercises platform_operational_read_allowed() wired into the Shifts
-- module's own SELECT-only helpers (can_view_shift_planning_unit,
-- can_view_shift_staff_profile) and into the separately-named SELECT
-- policies of shift_vacation_periods / shift_absence_requests /
-- property_job_titles (one representative table per pattern this PR
-- touches -- the remaining tables in each pattern share the identical
-- mechanism). Every assertion here is about READ access; write denial is
-- checked explicitly at the end so a reviewer never has to take "it's
-- read-only" on faith.
begin;
create extension if not exists pgtap;
select plan(22);

insert into organizations (id, name, slug) values
  ('00000079-0000-0000-0000-000000000001', 'Shifts Admin Org 079', 'test-079-org');

insert into properties (id, organization_id, name, slug) values
  ('00000079-0000-0000-0000-000000000011', '00000079-0000-0000-0000-000000000001', 'Property A 079', 'test-079-a'),
  ('00000079-0000-0000-0000-000000000012', '00000079-0000-0000-0000-000000000001', 'Property B 079', 'test-079-b');

insert into property_modules (property_id, module_id, enabled)
select '00000079-0000-0000-0000-000000000011', id, true from modules where slug = 'shifts';

-- Real tenant staff -- confirms this PR never changes their own access.
insert into auth.users (id, email) values
  ('00000079-0000-0000-0000-000000000041', 'manager-079@example.com');
insert into profiles (id, full_name) values
  ('00000079-0000-0000-0000-000000000041', 'Manager 079');
insert into memberships (profile_id, property_id, role_id, status) values
  ('00000079-0000-0000-0000-000000000041', '00000079-0000-0000-0000-000000000011',
   (select id from roles where slug = 'manager'), 'active');
insert into property_staff_details (property_id, profile_id) values
  ('00000079-0000-0000-0000-000000000011', '00000079-0000-0000-0000-000000000041');

-- Platform Admins: #201 full (support.read + MFA), #202 same but whose
-- permission is revoked mid-session, #203 same but suspended mid-session.
insert into auth.users (id, email) values
  ('00000079-0000-0000-0000-000000000201', 'pa-full-079@example.com'),
  ('00000079-0000-0000-0000-000000000202', 'pa-revoked-079@example.com'),
  ('00000079-0000-0000-0000-000000000203', 'pa-suspend-079@example.com');
insert into profiles (id, full_name) values
  ('00000079-0000-0000-0000-000000000201', 'PA — full'),
  ('00000079-0000-0000-0000-000000000202', 'PA — revoked mid-session'),
  ('00000079-0000-0000-0000-000000000203', 'PA — suspended mid-session');
insert into platform_admins (id, profile_id, status) values
  ('00000079-0000-0000-0000-00000000a201', '00000079-0000-0000-0000-000000000201', 'active'),
  ('00000079-0000-0000-0000-00000000a202', '00000079-0000-0000-0000-000000000202', 'active'),
  ('00000079-0000-0000-0000-00000000a203', '00000079-0000-0000-0000-000000000203', 'active');
insert into platform_admin_permissions (platform_admin_id, permission_slug) values
  ('00000079-0000-0000-0000-00000000a201', 'platform.support.read'),
  ('00000079-0000-0000-0000-00000000a202', 'platform.support.read'),
  ('00000079-0000-0000-0000-00000000a203', 'platform.support.read');

-- Shifts data on property A (what Admin Master should be able to see).
insert into shift_planning_units (id, property_id, name, slug) values
  ('00000079-0000-0000-0000-000000000071', '00000079-0000-0000-0000-000000000011', 'Reception 079-A', 'reception');
insert into shift_staff_profiles (id, property_id, profile_id, shift_type) values
  ('00000079-0000-0000-0000-000000000081', '00000079-0000-0000-0000-000000000011', '00000079-0000-0000-0000-000000000041', 'day');
insert into shift_unit_members (id, property_id, planning_unit_id, staff_profile_id) values
  ('00000079-0000-0000-0000-000000000091', '00000079-0000-0000-0000-000000000011', '00000079-0000-0000-0000-000000000071', '00000079-0000-0000-0000-000000000081');
insert into shift_codes (id, property_id, planning_unit_id, code, label, kind, starts_at, ends_at, color) values
  ('00000079-0000-0000-0000-000000000101', '00000079-0000-0000-0000-000000000011', '00000079-0000-0000-0000-000000000071', 'A1', 'Apertura', 'work', '07:00', '15:00', '#2E9F43');
insert into shifts (id, property_id, planning_unit_id, staff_profile_id, shift_code_id, shift_date) values
  ('00000079-0000-0000-0000-000000000111', '00000079-0000-0000-0000-000000000011', '00000079-0000-0000-0000-000000000071', '00000079-0000-0000-0000-000000000081', '00000079-0000-0000-0000-000000000101', '2026-10-20');
insert into shift_vacation_periods (property_id, staff_profile_id, period_index, start_date, end_date, status) values
  ('00000079-0000-0000-0000-000000000011', '00000079-0000-0000-0000-000000000081', 0, '2026-11-01', '2026-11-05', 'confirmed');
insert into shift_absence_requests (property_id, planning_unit_id, staff_profile_id, starts_on, ends_on, absence_kind, status) values
  ('00000079-0000-0000-0000-000000000011', '00000079-0000-0000-0000-000000000071', '00000079-0000-0000-0000-000000000081', '2026-12-01', '2026-12-02', 'illness', 'pending');
insert into property_job_titles (id, property_id, name) values
  ('00000079-0000-0000-0000-000000000061', '00000079-0000-0000-0000-000000000011', 'Reception 079');

-- Same shapes on property B, to prove isolation (A's session never leaks B's rows).
insert into auth.users (id, email) values
  ('00000079-0000-0000-0000-000000000042', 'staff-b-079@example.com');
insert into profiles (id, full_name) values
  ('00000079-0000-0000-0000-000000000042', 'Staff B 079');
insert into memberships (profile_id, property_id, role_id, status) values
  ('00000079-0000-0000-0000-000000000042', '00000079-0000-0000-0000-000000000012',
   (select id from roles where slug = 'receptionist'), 'active');
insert into property_staff_details (property_id, profile_id) values
  ('00000079-0000-0000-0000-000000000012', '00000079-0000-0000-0000-000000000042');
insert into shift_planning_units (id, property_id, name, slug) values
  ('00000079-0000-0000-0000-000000000072', '00000079-0000-0000-0000-000000000012', 'Reception 079-B', 'reception');
insert into shift_staff_profiles (id, property_id, profile_id, shift_type) values
  ('00000079-0000-0000-0000-000000000082', '00000079-0000-0000-0000-000000000012', '00000079-0000-0000-0000-000000000042', 'day');

-- === no session yet: permission + MFA alone are not enough ==================

set local role authenticated;
set local request.jwt.claim.sub = '00000079-0000-0000-0000-000000000201';
set local request.jwt.claims = '{"aal":"aal2"}';
select is(
  (select count(*)::int from shift_planning_units where property_id = '00000079-0000-0000-0000-000000000011'),
  0,
  'a fully-permissioned, MFA-verified admin with NO open operational session sees nothing -- a session is required, not just permission+MFA'
);

-- === open a session, then read across every touched table/pattern ==========

select lives_ok(
  $$ select platform_open_operational_session('00000079-0000-0000-0000-000000000011', 'diagnosi turni') $$,
  'admin #201 opens an operational session on property A'
);

select is(
  (select name from shift_planning_units where id = '00000079-0000-0000-0000-000000000071'),
  'Reception 079-A',
  'with an active session, the admin reads the real shift_planning_units row (can_view_shift_planning_unit extension)'
);
select is(
  (select shift_date::text from shifts where id = '00000079-0000-0000-0000-000000000111'),
  '2026-10-20',
  'the admin reads the real shifts row for property A'
);
select is(
  (select shift_type from shift_staff_profiles where id = '00000079-0000-0000-0000-000000000081'),
  'day',
  'the admin reads the real shift_staff_profiles row (can_view_shift_staff_profile extension)'
);
select is(
  (select status from shift_vacation_periods where property_id = '00000079-0000-0000-0000-000000000011' and staff_profile_id = '00000079-0000-0000-0000-000000000081'),
  'confirmed',
  'the admin reads shift_vacation_periods (separately-named SELECT policy extension)'
);
select is(
  (select status from shift_absence_requests where property_id = '00000079-0000-0000-0000-000000000011' and staff_profile_id = '00000079-0000-0000-0000-000000000081'),
  'pending',
  'the admin reads shift_absence_requests despite owning no shift_staff_profiles row herself'
);
select is(
  (select name from property_job_titles where id = '00000079-0000-0000-0000-000000000061'),
  'Reception 079',
  'the admin reads property_job_titles (shared-table SELECT policy extension)'
);

-- === isolation: the same session never leaks property B's rows =============

select is(
  (select count(*)::int from shift_planning_units where property_id = '00000079-0000-0000-0000-000000000012'),
  0,
  'a session scoped to property A grants no visibility into property B''s shift_planning_units'
);
select is(
  (select count(*)::int from shift_staff_profiles where property_id = '00000079-0000-0000-0000-000000000012'),
  0,
  'a session scoped to property A grants no visibility into property B''s shift_staff_profiles'
);

-- === writes remain denied throughout, even with full legitimate read access
-- (never touched by this PR) ================================================

select throws_ok(
  $$ insert into shift_planning_units (property_id, name, slug) values ('00000079-0000-0000-0000-000000000011', 'Should fail', 'should-fail') $$,
  '42501',
  null,
  'the admin, still mid-session with full read access, cannot INSERT into shift_planning_units (requires shifts.manage, which she never holds)'
);

-- RLS denial on UPDATE is silent (0 rows matched, no exception) rather than
-- a thrown error -- throws_ok would be the wrong tool here. Prove the same
-- denial the way it actually manifests: the row is untouched.
update shifts set shift_date = '2026-10-21' where id = '00000079-0000-0000-0000-000000000111';
select is(
  (select shift_date::text from shifts where id = '00000079-0000-0000-0000-000000000111'),
  '2026-10-20',
  'the admin''s UPDATE matches zero rows under RLS -- the shift_date is still the original value, not the attempted new one, even though she can read the row'
);

select throws_ok(
  $$ insert into property_job_titles (property_id, name) values ('00000079-0000-0000-0000-000000000011', 'Should fail') $$,
  '42501',
  null,
  'the admin cannot INSERT into property_job_titles (requires core.staff.manage)'
);

-- === permission revoked mid-session (not just session expiry) ==============

set local request.jwt.claim.sub = '00000079-0000-0000-0000-000000000202';
select lives_ok(
  $$ select platform_open_operational_session('00000079-0000-0000-0000-000000000011', null) $$,
  'admin #202 opens her own session on property A while she still holds platform.support.read'
);
select is(
  (select count(*)::int from shift_planning_units where property_id = '00000079-0000-0000-0000-000000000011'),
  1,
  'admin #202 can read property A while her permission and session are both intact'
);

reset role;
delete from platform_admin_permissions where platform_admin_id = '00000079-0000-0000-0000-00000000a202' and permission_slug = 'platform.support.read';

set local role authenticated;
set local request.jwt.claim.sub = '00000079-0000-0000-0000-000000000202';
set local request.jwt.claims = '{"aal":"aal2"}';
select is(
  (select count(*)::int from shift_planning_units where property_id = '00000079-0000-0000-0000-000000000011'),
  0,
  'revoking platform.support.read cuts off reads immediately even though her session row is still active and unexpired'
);

-- === MFA no longer satisfied on the current request =========================

set local request.jwt.claim.sub = '00000079-0000-0000-0000-000000000201';
set local request.jwt.claims = '{"aal":"aal1"}';
select is(
  (select count(*)::int from shift_planning_units where property_id = '00000079-0000-0000-0000-000000000011'),
  0,
  'a request whose current JWT no longer carries aal2 is denied even with an otherwise-valid open session'
);

-- === suspension revokes access regardless of session state =================

set local request.jwt.claim.sub = '00000079-0000-0000-0000-000000000203';
set local request.jwt.claims = '{"aal":"aal2"}';
select lives_ok(
  $$ select platform_open_operational_session('00000079-0000-0000-0000-000000000011', null) $$,
  'admin #203 opens a session on property A while still active'
);
select is(
  (select count(*)::int from shift_planning_units where property_id = '00000079-0000-0000-0000-000000000011'),
  1,
  'admin #203 can read property A immediately after opening her session'
);

reset role;
update platform_admins set status = 'suspended' where id = '00000079-0000-0000-0000-00000000a203';

set local role authenticated;
set local request.jwt.claim.sub = '00000079-0000-0000-0000-000000000203';
set local request.jwt.claims = '{"aal":"aal2"}';
select is(
  (select count(*)::int from shift_planning_units where property_id = '00000079-0000-0000-0000-000000000011'),
  0,
  'suspending the platform_admins row cuts off access immediately, even with a still-active, unexpired session'
);

-- === a session past its expires_at denies access even if still labeled active ===

set local request.jwt.claim.sub = '00000079-0000-0000-0000-000000000201';
reset role;
update platform_operational_sessions
   set expires_at = now() - interval '1 minute'
 where platform_admin_id = '00000079-0000-0000-0000-00000000a201' and status = 'active';

set local role authenticated;
set local request.jwt.claims = '{"aal":"aal2"}';
select is(
  (select count(*)::int from shift_planning_units where property_id = '00000079-0000-0000-0000-000000000011'),
  0,
  'a session past its expires_at denies access even though its status column still literally reads ''active'''
);

-- === regression: the real tenant manager's own access is unaffected ========

set local request.jwt.claim.sub = '00000079-0000-0000-0000-000000000041';
select is(
  (select name from shift_planning_units where id = '00000079-0000-0000-0000-000000000071'),
  'Reception 079-A',
  'the real tenant manager still reads her own property''s data exactly as before this PR'
);

select * from finish();
rollback;
