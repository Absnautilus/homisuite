-- Platform Admin operational audit + session history -- Fase C, PR C4.
--
-- Fase C so far logs session lifecycle (opened/closed/revoked, PR C1) but
-- nothing about what happened *inside* an open session -- an admin could
-- sit in one session and consult three different modules' data, and the
-- audit log would show only the single opening event. This PR adds:
--
--   1. platform_log_operational_view() -- one audit entry per module view
--      actually entered, logged by the console itself (OperationalViewLayout)
--      the moment a module screen mounts under an active session. This is
--      a logging call only -- it never gates the read itself (PR C2's RLS
--      already does that, independently, on every row) and a failure here
--      must never block an already-authorized read from rendering.
--   2. platform_list_operational_sessions() -- the session-history reader
--      the console's new "Sessioni operative" page lists, across every
--      admin (not just the caller's own), gated on platform.audit.read --
--      the same permission platform_list_audit_log() already requires,
--      since a session history is itself an audit view.
--
-- Remote revocation needs no new backend work: platform_revoke_operational_
-- session() already exists (PR C1, gated on platform.admins.manage) and is
-- already fully tested there. This PR only gives the console a UI path to
-- call it against a session surfaced by platform_list_operational_sessions,
-- instead of leaving it reachable only via direct RPC call.
--
-- No existing table, policy, or function is modified. No operational RLS
-- is touched.

begin;

-- ---------------------------------------------------------------------------
-- platform_log_operational_view -- requires the same standing permission +
-- MFA check every operational-read path already requires, PLUS ownership
-- of an active, unexpired session matching p_session_id (never another
-- admin's, and never a lapsed one quietly re-used for a stale audit entry).
-- Deliberately does not accept a property_id argument -- the property is
-- read from the session row itself, so the logged entry can never disagree
-- with which property the session actually scopes.
-- ---------------------------------------------------------------------------
create function platform_log_operational_view(
  p_session_id uuid,
  p_module_slug text
) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_admin_id uuid;
  v_property_id uuid;
begin
  if not is_platform_admin() then
    raise exception 'not_platform_admin' using errcode = '42501';
  end if;

  if not platform_has_permission('platform.support.read') then
    raise exception 'insufficient_privilege' using errcode = '42501';
  end if;

  if not platform_mfa_satisfied() then
    raise exception 'mfa_required' using errcode = '42501';
  end if;

  select id into v_admin_id from platform_admins where profile_id = auth.uid() and status = 'active';

  select property_id into v_property_id
    from platform_operational_sessions
   where id = p_session_id
     and platform_admin_id = v_admin_id
     and status = 'active'
     and expires_at > now();

  if v_property_id is null then
    raise exception 'session_not_found_or_not_active' using errcode = '22023';
  end if;

  perform log_platform_action(
    'platform.operational_view_accessed',
    'property',
    v_property_id,
    jsonb_build_object('session_id', p_session_id, 'module_slug', p_module_slug)
  );
end;
$$;

revoke all on function platform_log_operational_view(uuid, text) from public, anon;
grant execute on function platform_log_operational_view(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- platform_list_operational_sessions -- paginated, newest first, across
-- every admin. Same two-check pattern as platform_list_audit_log(): gated
-- on platform.audit.read, not platform.support.read -- reading OTHER
-- admins' session history is an audit capability, distinct from the
-- standing right to open one's own sessions.
--
-- Lazily expires stale 'active' rows platform-wide before reading, same
-- reasoning as platform_my_operational_session()'s own per-admin lazy
-- expiry (PR C1) -- a history view is worthless if it shows a session as
-- "active" purely because nobody has read it since it lapsed.
-- ---------------------------------------------------------------------------
create function platform_list_operational_sessions(p_limit int default 50, p_offset int default 0) returns table(
  id uuid,
  platform_admin_id uuid,
  admin_full_name text,
  property_id uuid,
  property_name text,
  status text,
  reason text,
  opened_at timestamptz,
  expires_at timestamptz,
  closed_at timestamptz,
  closed_by_full_name text
)
language plpgsql security definer set search_path = public as $$
begin
  if not platform_has_permission('platform.audit.read') then
    raise exception 'insufficient_privilege' using errcode = '42501';
  end if;
  if not platform_mfa_satisfied() then
    raise exception 'mfa_required' using errcode = '42501';
  end if;
  if p_limit < 1 or p_limit > 200 then
    raise exception 'invalid_limit' using errcode = '22023';
  end if;

  -- Table alias required: this function's own OUT parameter is also named
  -- `status` (the returns table(...) column), which makes a bare `status`
  -- reference ambiguous between the two inside plpgsql.
  update platform_operational_sessions s
     set status = 'expired'
   where s.status = 'active'
     and s.expires_at <= now();

  return query
    select s.id, s.platform_admin_id, pr.full_name, s.property_id, p.name, s.status, s.reason,
           s.opened_at, s.expires_at, s.closed_at, cpr.full_name
    from platform_operational_sessions s
    join platform_admins pa on pa.id = s.platform_admin_id
    join profiles pr on pr.id = pa.profile_id
    join properties p on p.id = s.property_id
    left join profiles cpr on cpr.id = s.closed_by
    order by s.opened_at desc
    limit p_limit offset p_offset;
end;
$$;

revoke all on function platform_list_operational_sessions(int, int) from public, anon;
grant execute on function platform_list_operational_sessions(int, int) to authenticated;

commit;
