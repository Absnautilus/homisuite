-- Platform Admin operational context (Fase C, PR C1): opening/closing/
-- revoking an operational session, the lazy-expiry self-status read, and
-- the complete absence of any client-writable path into
-- platform_operational_sessions. This PR touches NO operational RLS -- it
-- only proves the session lifecycle itself is sound in isolation.
begin;
create extension if not exists pgtap;
select plan(29);

insert into auth.users (id) values
  ('00000078-0000-0000-0000-000000000001'), -- support.read + admins.manage, MFA verified
  ('00000078-0000-0000-0000-000000000002'), -- support.read ONLY, MFA verified
  ('00000078-0000-0000-0000-000000000003'), -- support.read, MFA NOT verified
  ('00000078-0000-0000-0000-000000000004'), -- admins.manage only (no support.read)
  ('00000078-0000-0000-0000-000000000005'), -- suspended platform admin (holds support.read)
  ('00000078-0000-0000-0000-000000000006'); -- ordinary client organization_admin, not a platform admin

insert into profiles (id, full_name) values
  ('00000078-0000-0000-0000-000000000001', 'PA — support.read + admins.manage'),
  ('00000078-0000-0000-0000-000000000002', 'PA — support.read only'),
  ('00000078-0000-0000-0000-000000000003', 'PA — support.read, no MFA'),
  ('00000078-0000-0000-0000-000000000004', 'PA — admins.manage only'),
  ('00000078-0000-0000-0000-000000000005', 'PA — suspended'),
  ('00000078-0000-0000-0000-000000000006', 'Client org admin');

insert into platform_admins (id, profile_id, status) values
  ('00000078-0000-0000-0000-00000000a001', '00000078-0000-0000-0000-000000000001', 'active'),
  ('00000078-0000-0000-0000-00000000a002', '00000078-0000-0000-0000-000000000002', 'active'),
  ('00000078-0000-0000-0000-00000000a003', '00000078-0000-0000-0000-000000000003', 'active'),
  ('00000078-0000-0000-0000-00000000a004', '00000078-0000-0000-0000-000000000004', 'active'),
  ('00000078-0000-0000-0000-00000000a005', '00000078-0000-0000-0000-000000000005', 'suspended');

insert into platform_admin_permissions (platform_admin_id, permission_slug) values
  ('00000078-0000-0000-0000-00000000a001', 'platform.support.read'),
  ('00000078-0000-0000-0000-00000000a001', 'platform.admins.manage'),
  ('00000078-0000-0000-0000-00000000a002', 'platform.support.read'),
  ('00000078-0000-0000-0000-00000000a003', 'platform.support.read'),
  ('00000078-0000-0000-0000-00000000a004', 'platform.admins.manage'),
  ('00000078-0000-0000-0000-00000000a005', 'platform.support.read');

insert into organizations (id, name, slug) values
  ('00000078-0000-0000-0000-000000000011', 'Fixture Org 078', 'test-078-org');
insert into properties (id, organization_id, name, slug, status, timezone) values
  ('00000078-0000-0000-0000-000000000021', '00000078-0000-0000-0000-000000000011', 'Fixture Property P1', 'test-078-p1', 'active', 'Europe/Rome'),
  ('00000078-0000-0000-0000-000000000022', '00000078-0000-0000-0000-000000000011', 'Fixture Property P2', 'test-078-p2', 'active', 'Europe/Rome');

insert into memberships (profile_id, organization_id, role_id, status) values
  ('00000078-0000-0000-0000-000000000006', '00000078-0000-0000-0000-000000000011',
   (select id from roles where slug = 'organization_admin'), 'active');

-- === authorization gating on open ===========================================

set local role authenticated;
set local request.jwt.claim.sub = '00000078-0000-0000-0000-000000000006';
set local request.jwt.claims = '{"aal":"aal2"}';
select throws_like(
  $$ select platform_open_operational_session('00000078-0000-0000-0000-000000000021', null) $$,
  '%not_platform_admin%',
  'an ordinary client organization_admin cannot open an operational session'
);

set local request.jwt.claim.sub = '00000078-0000-0000-0000-000000000004';
select throws_like(
  $$ select platform_open_operational_session('00000078-0000-0000-0000-000000000021', null) $$,
  '%insufficient_privilege%',
  'an admin without platform.support.read cannot open a session even if admins.manage'
);

set local request.jwt.claim.sub = '00000078-0000-0000-0000-000000000003';
set local request.jwt.claims = '{"aal":"aal1"}';
select throws_like(
  $$ select platform_open_operational_session('00000078-0000-0000-0000-000000000021', null) $$,
  '%mfa_required%',
  'an admin holding platform.support.read without a verified MFA session cannot open one'
);

set local request.jwt.claim.sub = '00000078-0000-0000-0000-000000000005';
set local request.jwt.claims = '{"aal":"aal2"}';
select throws_like(
  $$ select platform_open_operational_session('00000078-0000-0000-0000-000000000021', null) $$,
  '%not_platform_admin%',
  'a SUSPENDED platform admin cannot open a session even though a permission grant row exists'
);

set local request.jwt.claim.sub = '00000078-0000-0000-0000-000000000001';
select throws_like(
  $$ select platform_open_operational_session('ffffffff-ffff-ffff-ffff-ffffffffffff', null) $$,
  '%property_not_found%',
  'opening a session against a nonexistent property fails closed'
);

-- === open + self-status ======================================================

select lives_ok(
  $$ select platform_open_operational_session('00000078-0000-0000-0000-000000000021', 'diagnosi stato richieste') $$,
  'a fully-permissioned, MFA-verified admin can open a session on property P1'
);

select results_eq(
  $$ select property_id, status from platform_my_operational_session() $$,
  $$ values ('00000078-0000-0000-0000-000000000021'::uuid, 'active'::text) $$,
  'platform_my_operational_session() reports the just-opened P1 context as active'
);

reset role;
select is(
  (select count(*)::int from platform_operational_sessions
    where platform_admin_id = '00000078-0000-0000-0000-00000000a001' and property_id = '00000078-0000-0000-0000-000000000021' and status = 'active'),
  1,
  'exactly one active P1 session row exists for this admin'
);
select ok(
  (select expires_at - opened_at from platform_operational_sessions
    where platform_admin_id = '00000078-0000-0000-0000-00000000a001' and property_id = '00000078-0000-0000-0000-000000000021')
    between interval '59 minutes' and interval '61 minutes',
  'the session expires approximately 60 minutes after opening'
);

-- === opening a second session auto-closes the first (singular context) =====

set local role authenticated;
set local request.jwt.claim.sub = '00000078-0000-0000-0000-000000000001';
set local request.jwt.claims = '{"aal":"aal2"}';
select lives_ok(
  $$ select platform_open_operational_session('00000078-0000-0000-0000-000000000022', 'switching to P2') $$,
  'the same admin can open a session on a different property (P2)'
);

select results_eq(
  $$ select property_id, status from platform_my_operational_session() $$,
  $$ values ('00000078-0000-0000-0000-000000000022'::uuid, 'active'::text) $$,
  'platform_my_operational_session() now reports P2 as the single active context'
);

reset role;
select is(
  (select status from platform_operational_sessions
    where platform_admin_id = '00000078-0000-0000-0000-00000000a001' and property_id = '00000078-0000-0000-0000-000000000021'),
  'closed',
  'opening a session on P2 auto-closed the earlier P1 session rather than leaving two active'
);

-- === close =====================================================================

-- psql does not substitute :'var' inside a $$ ... $$ block (same note as
-- 027's own test file) -- capture the session id as superuser (the table
-- has zero grants for `authenticated`, so even a correlated subquery
-- naming it would fail permission-denied under that role) and build the
-- call with format() instead, so substitution happens in a plain,
-- non-dollar-quoted argument position.
reset role;
select id as admin1_p2_session_id from platform_operational_sessions
  where platform_admin_id = '00000078-0000-0000-0000-00000000a001' and status = 'active' \gset

set local role authenticated;
set local request.jwt.claim.sub = '00000078-0000-0000-0000-000000000001';
set local request.jwt.claims = '{"aal":"aal2"}';
select lives_ok(
  format('select platform_close_operational_session(%L)', :'admin1_p2_session_id'),
  'an admin can close her own active session'
);

select is_empty(
  $$ select * from platform_my_operational_session() $$,
  'after closing, platform_my_operational_session() reports no active context'
);

select throws_like(
  format('select platform_close_operational_session(%L)', :'admin1_p2_session_id'),
  '%session_not_found_or_not_active%',
  'closing an already-closed session fails closed rather than silently no-op-ing'
);

-- === revoke (distinct, stricter permission) ==================================

set local request.jwt.claim.sub = '00000078-0000-0000-0000-000000000002';
select lives_ok(
  $$ select platform_open_operational_session('00000078-0000-0000-0000-000000000021', null) $$,
  'a support.read-only admin (no admins.manage) can open her own session'
);

reset role;
select id as admin2_session_id from platform_operational_sessions
  where platform_admin_id = '00000078-0000-0000-0000-00000000a002' and status = 'active' \gset

set local role authenticated;
set local request.jwt.claim.sub = '00000078-0000-0000-0000-000000000002';
set local request.jwt.claims = '{"aal":"aal2"}';
select throws_like(
  format('select platform_revoke_operational_session(%L)', :'admin2_session_id'),
  '%insufficient_privilege%',
  'opening a session does not itself grant the right to revoke it -- admins.manage is required even for your own'
);

set local request.jwt.claim.sub = '00000078-0000-0000-0000-000000000001';
select lives_ok(
  format('select platform_revoke_operational_session(%L)', :'admin2_session_id'),
  'an admin holding platform.admins.manage + verified MFA can revoke another admin''s active session'
);

reset role;
select is(
  (select status from platform_operational_sessions where platform_admin_id = '00000078-0000-0000-0000-00000000a002'),
  'revoked',
  'the revoked session is marked revoked, not deleted'
);

set local role authenticated;
set local request.jwt.claim.sub = '00000078-0000-0000-0000-000000000001';
set local request.jwt.claims = '{"aal":"aal2"}';
select throws_like(
  format('select platform_revoke_operational_session(%L)', :'admin2_session_id'),
  '%session_not_found_or_not_active%',
  'revoking an already-revoked session fails closed'
);

-- === lazy expiry ==============================================================

select lives_ok(
  $$ select platform_open_operational_session('00000078-0000-0000-0000-000000000021', null) $$,
  'admin #1 opens a fresh session on P1 to test lazy expiry'
);

reset role;
update platform_operational_sessions
   set expires_at = now() - interval '1 minute'
 where platform_admin_id = '00000078-0000-0000-0000-00000000a001' and status = 'active'
returning id as expiring_session_id \gset

set local role authenticated;
set local request.jwt.claim.sub = '00000078-0000-0000-0000-000000000001';
set local request.jwt.claims = '{"aal":"aal2"}';
select is_empty(
  $$ select * from platform_my_operational_session() $$,
  'a session whose expires_at has passed is reported as no-longer-active on next read'
);

reset role;
select status as expiring_session_status from platform_operational_sessions
  where id = :'expiring_session_id' \gset
select is(
  :'expiring_session_status'::text,
  'expired'::text,
  'the lazily-read expired session is flipped to status=expired, not left active'
);

-- === suspension cuts off access regardless of any session state ============

set local role authenticated;
set local request.jwt.claim.sub = '00000078-0000-0000-0000-000000000005';
set local request.jwt.claims = '{"aal":"aal2"}';
select is_empty(
  $$ select * from platform_my_operational_session() $$,
  'a suspended admin''s self-status shows no active context, independent of any session row'
);

-- === no client-writable path into the table =================================

reset role;
set local role authenticated;
set local request.jwt.claim.sub = '00000078-0000-0000-0000-000000000001';
select throws_like(
  $$ select 1 from platform_operational_sessions limit 1 $$,
  '%permission denied%',
  'authenticated has no direct SELECT grant on platform_operational_sessions -- every read goes through a function'
);

select throws_like(
  $$ insert into platform_operational_sessions (platform_admin_id, property_id, expires_at)
     values ('00000078-0000-0000-0000-00000000a001', '00000078-0000-0000-0000-000000000021', now()) $$,
  '%permission denied%',
  'authenticated has no direct INSERT grant on platform_operational_sessions'
);

-- === audit trail ==============================================================

reset role;
select ok(
  exists(select 1 from platform_audit_log where action = 'platform.operational_session_opened' and target_id = '00000078-0000-0000-0000-000000000021'),
  'opening a session logs platform.operational_session_opened against the property'
);
select ok(
  exists(select 1 from platform_audit_log where action = 'platform.operational_session_closed'),
  'closing a session logs platform.operational_session_closed'
);
select ok(
  exists(select 1 from platform_audit_log where action = 'platform.operational_session_revoked'),
  'revoking a session logs platform.operational_session_revoked'
);

select * from finish();
rollback;
