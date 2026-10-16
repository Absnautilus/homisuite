-- Platform Admin operational context — Fase C, PR C1.
--
-- Corrects a framing mistake from the original "support session" draft: the
-- Platform Admin (Admin Master) is the platform owner, not a support
-- operator borrowing exceptional access. Her read authorization over every
-- organization/property/module is a PERMANENT, STANDING fact of her
-- identity — governed entirely by is_platform_admin() + platform_has_
-- permission() + platform_mfa_satisfied(), exactly the same primitives B1
-- already built. It never depends on a session, a client's consent, or any
-- fixed-term grant.
--
-- What a session IS for: scoping (which single property is "in view" right
-- now), safety (an open tab can't silently stay authorized forever), and
-- audit (a clear, queryable record of when and where she looked). It is a
-- technical control on top of a standing right, not the source of the
-- right. Concretely:
--   - Opening one never asks anyone's permission (no client approval, no
--     workflow) — it's instant and self-service, gated only on her own
--     platform.support.read permission + a verified MFA session, exactly
--     like every other privileged Platform Admin action since B1.
--   - Its expiry never revokes her underlying privileges — it just means
--     the "current property in view" lapses and she opens a new one.
--   - Suspending her platform_admins row (set_platform_admin_status, B1)
--     revokes everything immediately regardless of any session row's
--     state, because every function below re-checks is_platform_admin()
--     live, every time — a session is never a cached credential.
--
-- This migration is schema + lifecycle only. It does NOT touch any
-- operational table's RLS (guest_requests, stays, dining_*, shift_*, or
-- any other module-owned table) — that is PR C2's job, module by module,
-- with its own isolation tests. No existing RLS policy or RPC is modified
-- here. `platform.support.read` was already seeded in B1 for exactly this
-- purpose (see that migration's own comment) and the bootstrapped admin
-- already holds it — no new permission slug is needed for C1.

begin;

-- ---------------------------------------------------------------------------
-- platform_operational_sessions — one row per opened operational context.
-- Same lockdown as every other Platform Admin table since B1: RLS enabled,
-- zero grants to authenticated/anon. The only way in is the SECURITY
-- DEFINER functions below.
--
-- A session only ever narrows *which property* reads will be scoped to once
-- C2 wires it into operational RLS — it never grants a permission or an MFA
-- state it doesn't already have. `status` is updated in place (closed/
-- expired/revoked) rather than deleting rows, so the table doubles as its
-- own history for C4's diagnostics.
-- ---------------------------------------------------------------------------
create table platform_operational_sessions (
  id uuid primary key default gen_random_uuid(),
  platform_admin_id uuid not null references platform_admins(id) on delete cascade,
  property_id uuid not null references properties(id) on delete cascade,
  status text not null default 'active' check (status in ('active', 'closed', 'expired', 'revoked')),
  reason text,
  opened_at timestamptz not null default now(),
  expires_at timestamptz not null,
  closed_at timestamptz,
  closed_by uuid references profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

alter table platform_operational_sessions enable row level security;
revoke all on platform_operational_sessions from public, authenticated, anon;

create index platform_operational_sessions_admin_status_idx
  on platform_operational_sessions (platform_admin_id, status);

-- ---------------------------------------------------------------------------
-- platform_open_operational_session — the only insert path. Standing
-- permission + MFA check first (same two-check pattern as every privileged
-- RPC since B1); only after that does it touch the sessions table at all.
--
-- At most one 'active' session per admin: opening a new one on a different
-- property auto-closes (never deletes) any other still-active session for
-- the same admin, so "which property is in view" stays singular — matches
-- the one-banner, one-context UX. Auto-closing is itself audited, same as
-- an explicit close.
--
-- Fixed 60-minute duration for this PR — not a parameter. Configurable
-- duration is a legitimate future need, not a requirement anyone has stated
-- yet (see Fase A's "don't build ahead of real need").
-- ---------------------------------------------------------------------------
create function platform_open_operational_session(
  p_property_id uuid,
  p_reason text default null
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_admin_id uuid;
  v_session_id uuid;
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

  if not exists (select 1 from properties where id = p_property_id) then
    raise exception 'property_not_found' using errcode = '22023';
  end if;

  select id into v_admin_id from platform_admins where profile_id = auth.uid() and status = 'active';

  update platform_operational_sessions
     set status = 'closed', closed_at = now(), closed_by = auth.uid()
   where platform_admin_id = v_admin_id
     and status = 'active';

  insert into platform_operational_sessions (platform_admin_id, property_id, reason, expires_at)
  values (v_admin_id, p_property_id, p_reason, now() + interval '60 minutes')
  returning id into v_session_id;

  perform log_platform_action(
    'platform.operational_session_opened',
    'property',
    p_property_id,
    jsonb_build_object('session_id', v_session_id, 'reason', p_reason)
  );

  return v_session_id;
end;
$$;

revoke all on function platform_open_operational_session(uuid, text) from public, anon;
grant execute on function platform_open_operational_session(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- platform_close_operational_session — self-service exit. An admin can only
-- close her own session (never another admin's — that's what revoke, with
-- its own stricter permission check, is for below).
-- ---------------------------------------------------------------------------
create function platform_close_operational_session(p_session_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_admin_id uuid;
  v_property_id uuid;
begin
  if not is_platform_admin() then
    raise exception 'not_platform_admin' using errcode = '42501';
  end if;

  select id into v_admin_id from platform_admins where profile_id = auth.uid() and status = 'active';

  update platform_operational_sessions
     set status = 'closed', closed_at = now(), closed_by = auth.uid()
   where id = p_session_id
     and platform_admin_id = v_admin_id
     and status = 'active'
  returning property_id into v_property_id;

  if not found then
    raise exception 'session_not_found_or_not_active' using errcode = '22023';
  end if;

  perform log_platform_action(
    'platform.operational_session_closed',
    'property',
    v_property_id,
    jsonb_build_object('session_id', p_session_id)
  );
end;
$$;

revoke all on function platform_close_operational_session(uuid) from public, anon;
grant execute on function platform_close_operational_session(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- platform_revoke_operational_session — the "revoca immediata di una
-- sessione compromessa" path: deliberately a *different, stricter*
-- permission (platform.admins.manage, the same one set_platform_admin_status
-- already requires in B1) than opening one, since revoking can target any
-- admin's session, not just the caller's own.
-- ---------------------------------------------------------------------------
create function platform_revoke_operational_session(p_session_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_property_id uuid;
  v_target_admin_id uuid;
begin
  if not is_platform_admin() then
    raise exception 'not_platform_admin' using errcode = '42501';
  end if;

  if not platform_has_permission('platform.admins.manage') then
    raise exception 'insufficient_privilege' using errcode = '42501';
  end if;

  if not platform_mfa_satisfied() then
    raise exception 'mfa_required' using errcode = '42501';
  end if;

  update platform_operational_sessions
     set status = 'revoked', closed_at = now(), closed_by = auth.uid()
   where id = p_session_id
     and status = 'active'
  returning property_id, platform_admin_id into v_property_id, v_target_admin_id;

  if not found then
    raise exception 'session_not_found_or_not_active' using errcode = '22023';
  end if;

  perform log_platform_action(
    'platform.operational_session_revoked',
    'property',
    v_property_id,
    jsonb_build_object('session_id', p_session_id, 'target_admin_id', v_target_admin_id)
  );
end;
$$;

revoke all on function platform_revoke_operational_session(uuid) from public, anon;
grant execute on function platform_revoke_operational_session(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- platform_my_operational_session — what the console banner reads. Scoped
-- unconditionally to the caller's own auth.uid() (no parameter to spoof),
-- same reasoning as platform_admin_self_status() in B1: safe to expose
-- without a permission/MFA gate because it only ever answers "what is MY
-- own current context", never another admin's.
--
-- Lazily flips an expired-but-still-'active' row to 'expired' on read,
-- rather than requiring a cron job — correct because the only consumer of
-- `status` is this function and (from C2 onward) the read-authorization
-- helper, both of which call this same expiry check live.
-- ---------------------------------------------------------------------------
create function platform_my_operational_session() returns table(
  id uuid,
  property_id uuid,
  status text,
  reason text,
  opened_at timestamptz,
  expires_at timestamptz
)
language plpgsql security definer set search_path = public as $$
declare
  v_admin_id uuid;
begin
  select pa.id into v_admin_id from platform_admins pa where pa.profile_id = auth.uid() and pa.status = 'active';

  if v_admin_id is null then
    return;
  end if;

  update platform_operational_sessions s
     set status = 'expired'
   where s.platform_admin_id = v_admin_id
     and s.status = 'active'
     and s.expires_at <= now();

  return query
    select s.id, s.property_id, s.status, s.reason, s.opened_at, s.expires_at
    from platform_operational_sessions s
    where s.platform_admin_id = v_admin_id
      and s.status = 'active'
    order by s.opened_at desc
    limit 1;
end;
$$;

revoke all on function platform_my_operational_session() from public, anon;
grant execute on function platform_my_operational_session() to authenticated;

commit;
