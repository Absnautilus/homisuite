-- Platform Admin identity (Fase B, PR B1): is_platform_admin,
-- platform_has_permission, platform_mfa_satisfied, platform_admin_self_status,
-- set_platform_admin_status, and the complete absence of any client-writable
-- path into platform_admins / platform_admin_permissions.
begin;
create extension if not exists pgtap;
select plan(25);

-- All fixture setup runs as the unrestricted test-session role, BEFORE any
-- `set local role` below narrows what the rest of this transaction can do.
insert into auth.users (id) values
  ('00000075-0000-0000-0000-000000000001'), -- active platform admin, no permissions
  ('00000075-0000-0000-0000-000000000002'), -- suspended platform admin
  ('00000075-0000-0000-0000-000000000003'), -- ordinary profile, not a platform admin at all
  ('00000075-0000-0000-0000-000000000004'), -- active platform admin WITH platform.admins.manage
  ('00000075-0000-0000-0000-000000000005'); -- target admin to suspend/reactivate

insert into profiles (id, full_name) values
  ('00000075-0000-0000-0000-000000000001', 'PA — bare'),
  ('00000075-0000-0000-0000-000000000002', 'PA — suspended'),
  ('00000075-0000-0000-0000-000000000003', 'Ordinary profile'),
  ('00000075-0000-0000-0000-000000000004', 'PA — manages admins'),
  ('00000075-0000-0000-0000-000000000005', 'PA — target');

insert into platform_admins (id, profile_id, status) values
  ('00000075-0000-0000-0000-00000000a001', '00000075-0000-0000-0000-000000000001', 'active'),
  ('00000075-0000-0000-0000-00000000a002', '00000075-0000-0000-0000-000000000002', 'suspended'),
  ('00000075-0000-0000-0000-00000000a004', '00000075-0000-0000-0000-000000000004', 'active'),
  ('00000075-0000-0000-0000-00000000a005', '00000075-0000-0000-0000-000000000005', 'active');

insert into platform_admin_permissions (platform_admin_id, permission_slug) values
  ('00000075-0000-0000-0000-00000000a004', 'platform.admins.manage'),
  -- suspended admin #2 is given a grant row directly too, to prove status
  -- gates it even when the join would otherwise match.
  ('00000075-0000-0000-0000-00000000a002', 'platform.admins.manage');

-- === is_platform_admin() ====================================================

set local role authenticated;
set local request.jwt.claim.sub = '00000075-0000-0000-0000-000000000001';
select ok(is_platform_admin(), 'an active platform admin is recognized by is_platform_admin()');

set local request.jwt.claim.sub = '00000075-0000-0000-0000-000000000002';
select ok(not is_platform_admin(), 'a SUSPENDED platform admin is not recognized as active');

set local request.jwt.claim.sub = '00000075-0000-0000-0000-000000000003';
select ok(not is_platform_admin(), 'an ordinary profile with no platform_admins row is never a platform admin');

-- === platform_has_permission() ==============================================

set local request.jwt.claim.sub = '00000075-0000-0000-0000-000000000001';
select ok(not platform_has_permission('platform.admins.manage'), 'an active admin with no granted permissions holds none');

set local request.jwt.claim.sub = '00000075-0000-0000-0000-000000000004';
select ok(platform_has_permission('platform.admins.manage'), 'an admin actually granted the slug holds it');
select ok(not platform_has_permission('platform.audit.read'), 'holding one permission does not imply holding another');

set local request.jwt.claim.sub = '00000075-0000-0000-0000-000000000002';
select ok(not platform_has_permission('platform.admins.manage'), 'a suspended admin holds no permission even if a grant row exists');
select ok(not platform_has_permission('platform.admins.manage'), 'a suspended admin''s existing permission grant stays inert while suspended');

set local request.jwt.claim.sub = '00000075-0000-0000-0000-000000000003';
select ok(not platform_has_permission('platform.admins.manage'), 'an ordinary profile holds no platform permission under any slug');

-- === platform_mfa_satisfied() ================================================

set local request.jwt.claims = '{"aal":"aal2"}';
select ok(platform_mfa_satisfied(), 'aal2 in the session JWT satisfies the MFA gate');

set local request.jwt.claims = '{"aal":"aal1"}';
select ok(not platform_mfa_satisfied(), 'aal1 does not satisfy the MFA gate');

set local request.jwt.claims = '{}';
select ok(not platform_mfa_satisfied(), 'a session with no aal claim at all does not satisfy the MFA gate (fails closed)');

-- === platform_admin_self_status() — must work WITHOUT mfa_satisfied ==========

set local request.jwt.claim.sub = '00000075-0000-0000-0000-000000000001';
set local request.jwt.claims = '{"aal":"aal1"}';
select results_eq(
  $$ select is_admin, status, mfa_satisfied from platform_admin_self_status() $$,
  $$ values (true, 'active'::text, false) $$,
  'self-status is reachable before MFA is verified -- no lockout for an unverified admin'
);

set local request.jwt.claim.sub = '00000075-0000-0000-0000-000000000003';
select results_eq(
  $$ select is_admin, status from platform_admin_self_status() $$,
  $$ values (false, null::text) $$,
  'an ordinary profile''s self-status correctly reports is_admin=false, status=null'
);

-- === no client-writable path into platform_admins / *_permissions ==========

set local request.jwt.claim.sub = '00000075-0000-0000-0000-000000000003';
select throws_ok(
  $$ insert into platform_admins (profile_id) values ('00000075-0000-0000-0000-000000000003') $$,
  '42501',
  null,
  'an ordinary authenticated user cannot INSERT into platform_admins -- no self-promotion path exists'
);

select throws_ok(
  $$ insert into platform_admin_permissions (platform_admin_id, permission_slug)
     values ('00000075-0000-0000-0000-00000000a001', 'platform.admins.manage') $$,
  '42501',
  null,
  'an ordinary authenticated user cannot grant themselves (or anyone) a platform permission directly'
);

select throws_ok(
  $$ update platform_admins set status = 'active' where id = '00000075-0000-0000-0000-00000000a002' $$,
  '42501',
  null,
  'no authenticated role, not even a platform admin, can UPDATE platform_admins directly -- only via set_platform_admin_status'
);

set local role anon;
select throws_ok(
  $$ select is_platform_admin() $$,
  '42501',
  null,
  'anon cannot execute is_platform_admin'
);
select throws_ok(
  $$ select platform_has_permission('platform.admins.manage') $$,
  '42501',
  null,
  'anon cannot execute platform_has_permission'
);

-- === set_platform_admin_status() ============================================

set local role authenticated;

-- holds the permission but has NOT verified MFA this session
set local request.jwt.claim.sub = '00000075-0000-0000-0000-000000000004';
set local request.jwt.claims = '{"aal":"aal1"}';
select throws_like(
  $$ select set_platform_admin_status('00000075-0000-0000-0000-00000000a005', 'suspended') $$,
  '%mfa_required%',
  'an admin holding platform.admins.manage but without a verified MFA session cannot suspend another admin'
);

-- a different active admin, verified MFA, but WITHOUT the permission
set local request.jwt.claim.sub = '00000075-0000-0000-0000-000000000001';
set local request.jwt.claims = '{"aal":"aal2"}';
select throws_like(
  $$ select set_platform_admin_status('00000075-0000-0000-0000-00000000a005', 'suspended') $$,
  '%insufficient_privilege%',
  'MFA alone is not enough -- platform.admins.manage is still required'
);

-- the authorized admin, with MFA verified: suspends, then reactivates the
-- SAME row (never a new one).
set local request.jwt.claim.sub = '00000075-0000-0000-0000-000000000004';
set local request.jwt.claims = '{"aal":"aal2"}';
select lives_ok(
  $$ select set_platform_admin_status('00000075-0000-0000-0000-00000000a005', 'suspended') $$,
  'an admin with platform.admins.manage and verified MFA can suspend another admin'
);

-- Verification queries below run with the lockdown lifted (`reset role`):
-- confirming the row actually changed is test introspection, not something
-- an authenticated client could do directly -- that denial is already
-- covered above ("no authenticated role ... can UPDATE platform_admins
-- directly").
reset role;
select results_eq(
  $$ select status from platform_admins where id = '00000075-0000-0000-0000-00000000a005' $$,
  $$ values ('suspended'::text) $$,
  'the target row''s status actually flipped to suspended'
);

set local role authenticated;
set local request.jwt.claim.sub = '00000075-0000-0000-0000-000000000004';
set local request.jwt.claims = '{"aal":"aal2"}';
select lives_ok(
  $$ select set_platform_admin_status('00000075-0000-0000-0000-00000000a005', 'active') $$,
  'the same authorized admin can reactivate the target'
);

reset role;
select is(
  (select count(*) from platform_admins where profile_id = '00000075-0000-0000-0000-000000000005'),
  1::bigint,
  'suspend+reactivate updated the SAME row throughout -- never inserted a second one'
);

select * from finish();
rollback;
