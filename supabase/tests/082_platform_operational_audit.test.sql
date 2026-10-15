-- Platform Admin operational audit + session history (Fase C, PR C4):
-- platform_log_operational_view()'s own authorization/ownership checks and
-- the audit entry it produces, and platform_list_operational_sessions()'s
-- permission gating, cross-admin visibility, and lazy expiry. Session
-- open/close/revoke themselves are already fully covered by 078 -- this
-- file only proves the two new functions this PR adds.
begin;
create extension if not exists pgtap;
select plan(17);

insert into auth.users (id) values
  ('00000082-0000-0000-0000-000000000001'), -- support.read + audit.read, MFA verified
  ('00000082-0000-0000-0000-000000000002'), -- support.read ONLY (no audit.read), MFA verified
  ('00000082-0000-0000-0000-000000000003'), -- audit.read ONLY (no support.read), MFA verified
  ('00000082-0000-0000-0000-000000000004'), -- support.read, MFA NOT verified
  ('00000082-0000-0000-0000-000000000005'); -- audit.read, MFA NOT verified

insert into profiles (id, full_name) values
  ('00000082-0000-0000-0000-000000000001', 'PA — support.read + audit.read'),
  ('00000082-0000-0000-0000-000000000002', 'PA — support.read only'),
  ('00000082-0000-0000-0000-000000000003', 'PA — audit.read only'),
  ('00000082-0000-0000-0000-000000000004', 'PA — support.read, no MFA'),
  ('00000082-0000-0000-0000-000000000005', 'PA — audit.read, no MFA');

insert into platform_admins (id, profile_id, status) values
  ('00000082-0000-0000-0000-00000000a001', '00000082-0000-0000-0000-000000000001', 'active'),
  ('00000082-0000-0000-0000-00000000a002', '00000082-0000-0000-0000-000000000002', 'active'),
  ('00000082-0000-0000-0000-00000000a003', '00000082-0000-0000-0000-000000000003', 'active'),
  ('00000082-0000-0000-0000-00000000a004', '00000082-0000-0000-0000-000000000004', 'active'),
  ('00000082-0000-0000-0000-00000000a005', '00000082-0000-0000-0000-000000000005', 'active');

insert into platform_admin_permissions (platform_admin_id, permission_slug) values
  ('00000082-0000-0000-0000-00000000a001', 'platform.support.read'),
  ('00000082-0000-0000-0000-00000000a001', 'platform.audit.read'),
  ('00000082-0000-0000-0000-00000000a002', 'platform.support.read'),
  ('00000082-0000-0000-0000-00000000a003', 'platform.audit.read'),
  ('00000082-0000-0000-0000-00000000a004', 'platform.support.read'),
  ('00000082-0000-0000-0000-00000000a005', 'platform.audit.read');

insert into organizations (id, name, slug) values
  ('00000082-0000-0000-0000-000000000011', 'Fixture Org 082', 'test-082-org');
insert into properties (id, organization_id, name, slug, status, timezone) values
  ('00000082-0000-0000-0000-000000000021', '00000082-0000-0000-0000-000000000011', 'Fixture Property 082', 'test-082-p1', 'active', 'Europe/Rome');

-- === platform_log_operational_view: authorization gating ===================

set local role authenticated;
set local request.jwt.claim.sub = '00000082-0000-0000-0000-000000000003';
set local request.jwt.claims = '{"aal":"aal2"}';
select throws_like(
  $$ select platform_log_operational_view('00000000-0000-0000-0000-000000000000', 'turni') $$,
  '%insufficient_privilege%',
  'an admin holding only audit.read (no support.read) cannot log an operational view'
);

set local request.jwt.claim.sub = '00000082-0000-0000-0000-000000000004';
set local request.jwt.claims = '{"aal":"aal1"}';
select throws_like(
  $$ select platform_log_operational_view('00000000-0000-0000-0000-000000000000', 'turni') $$,
  '%mfa_required%',
  'an admin holding support.read without verified MFA cannot log an operational view'
);

-- === a real session is required, and it must be this admin's own ===========

set local request.jwt.claim.sub = '00000082-0000-0000-0000-000000000001';
set local request.jwt.claims = '{"aal":"aal2"}';
select throws_like(
  $$ select platform_log_operational_view('00000000-0000-0000-0000-000000000000', 'turni') $$,
  '%session_not_found_or_not_active%',
  'logging a view against a nonexistent session fails closed'
);

select lives_ok(
  $$ select platform_open_operational_session('00000082-0000-0000-0000-000000000021', null) $$,
  'admin #1 opens a session on the fixture property'
);

reset role;
select id as admin1_session_id from platform_operational_sessions
  where platform_admin_id = '00000082-0000-0000-0000-00000000a001' and status = 'active' \gset

set local role authenticated;
set local request.jwt.claim.sub = '00000082-0000-0000-0000-000000000002';
set local request.jwt.claims = '{"aal":"aal2"}';
select throws_like(
  format('select platform_log_operational_view(%L, %L)', :'admin1_session_id', 'turni'),
  '%session_not_found_or_not_active%',
  'another admin (even one holding support.read) cannot log a view against admin #1''s session'
);

set local request.jwt.claim.sub = '00000082-0000-0000-0000-000000000001';
select lives_ok(
  format('select platform_log_operational_view(%L, %L)', :'admin1_session_id', 'turni'),
  'admin #1 can log a view against her own active session'
);

select lives_ok(
  format('select platform_log_operational_view(%L, %L)', :'admin1_session_id', 'dining'),
  'the same session can log a view of a second module too (no one-view-per-session limit)'
);

reset role;
select is(
  (select count(*)::int from platform_audit_log
    where action = 'platform.operational_view_accessed' and target_id = '00000082-0000-0000-0000-000000000021'),
  2,
  'both logged views are recorded against the session''s property'
);
select ok(
  exists(
    select 1 from platform_audit_log
     where action = 'platform.operational_view_accessed'
       and metadata->>'session_id' = :'admin1_session_id'
       and metadata->>'module_slug' = 'turni'
  ),
  'the first entry carries the session id and module slug in its metadata'
);

-- a lapsed session can no longer log a view, same as it can no longer be
-- self-closed (078) -- the "live, never cached" check applies here too.
update platform_operational_sessions set expires_at = now() - interval '1 minute' where id = :'admin1_session_id';

set local role authenticated;
set local request.jwt.claim.sub = '00000082-0000-0000-0000-000000000001';
set local request.jwt.claims = '{"aal":"aal2"}';
select throws_like(
  format('select platform_log_operational_view(%L, %L)', :'admin1_session_id', 'turni'),
  '%session_not_found_or_not_active%',
  'a lapsed session cannot log a further view, regardless of its stored status column'
);

-- === platform_list_operational_sessions: authorization gating ==============

set local request.jwt.claim.sub = '00000082-0000-0000-0000-000000000002';
select throws_like(
  $$ select platform_list_operational_sessions() $$,
  '%insufficient_privilege%',
  'an admin holding only support.read (no audit.read) cannot list session history'
);

set local request.jwt.claim.sub = '00000082-0000-0000-0000-000000000005';
set local request.jwt.claims = '{"aal":"aal1"}';
select throws_like(
  $$ select platform_list_operational_sessions() $$,
  '%mfa_required%',
  'an admin holding audit.read without verified MFA cannot list session history'
);

set local request.jwt.claim.sub = '00000082-0000-0000-0000-000000000003';
set local request.jwt.claims = '{"aal":"aal2"}';
select throws_like(
  $$ select platform_list_operational_sessions(0, 0) $$,
  '%invalid_limit%',
  'a limit of zero is rejected'
);

-- === cross-admin visibility + readable names ================================

set local request.jwt.claim.sub = '00000082-0000-0000-0000-000000000003';
set local request.jwt.claims = '{"aal":"aal2"}';
select results_eq(
  format(
    $$ select admin_full_name, property_name, status
         from platform_list_operational_sessions()
        where id = %L::uuid $$,
    :'admin1_session_id'
  ),
  $$ values ('PA — support.read + audit.read'::text, 'Fixture Property 082'::text, 'expired'::text) $$,
  'an admin holding only audit.read (never opened a session herself) can see another admin''s session, lazily flipped to expired, with readable admin/property names'
);

-- === remote revocation reachability (backend path reused unchanged) =======

set local request.jwt.claim.sub = '00000082-0000-0000-0000-000000000002';
select lives_ok(
  $$ select platform_open_operational_session('00000082-0000-0000-0000-000000000021', 'second fixture session') $$,
  'admin #2 opens her own session, to be revoked via the history view''s path'
);

reset role;
select id as admin2_session_id from platform_operational_sessions
  where platform_admin_id = '00000082-0000-0000-0000-00000000a002' and status = 'active' \gset

set local role authenticated;
set local request.jwt.claim.sub = '00000082-0000-0000-0000-000000000003';
select throws_like(
  format('select platform_revoke_operational_session(%L)', :'admin2_session_id'),
  '%insufficient_privilege%',
  'audit.read alone (surfacing the session in history) does not itself grant the right to revoke it -- admins.manage is still required, exactly as 078 already established'
);

reset role;
select is(
  (select status from platform_operational_sessions where id = :'admin2_session_id'),
  'active',
  'the session surfaced in history is unaffected by the failed revoke attempt above'
);

select * from finish();
rollback;
