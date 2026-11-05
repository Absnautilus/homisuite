-- resolve_staff_login_identifier (20260911100000) resolved a bare username
-- to a login email by RECONSTRUCTING the string
-- `username@property-slug.org-slug.staff.hotsflow.internal` -- correct only
-- for accounts created by create-team-member-credentials, which is the only
-- creation path that existed at the time. platform-create-team-member
-- (20261015210000, Admin Master's own Team management) creates the exact
-- same shape of credentials-based account, but synthesizes a DIFFERENT
-- domain: `...platform-admin.hotsflow.internal`, not `...staff.hotsflow.internal`.
-- The resolver never knew about that second scheme, so it always
-- reconstructed the wrong email for any member Admin Master created
-- herself -- signInWithPassword then failed against an email nothing
-- actually used, indistinguishable from a real wrong-password attempt
-- ("Email o password non corretti."). That team member's username and
-- password were both correct the whole time; only the resolver's guess
-- at their email was wrong.
--
-- Fixed by not guessing at all: memberships.profile_id is always the same
-- id as the auth.users row created alongside it (both creation functions
-- insert profiles with `id: created.user.id`), so this reads the real
-- email straight off auth.users instead of reconstructing one from a
-- domain-suffix convention that only one of two creation paths actually
-- followed. Whichever suffix (or none at all, for a future creation path)
-- was used at account-creation time no longer matters here.

begin;

create or replace function resolve_staff_login_identifier(p_username text, p_ip inet default null)
returns text[]
language plpgsql security definer set search_path = public as $$
declare
  v_recent_attempts int;
  v_identifiers text[];
begin
  select count(*) into v_recent_attempts
  from staff_login_lookup_attempts
  where created_at > now() - interval '15 minutes'
    and (ip_address = p_ip or username_attempted = p_username);

  if v_recent_attempts >= 20 then
    return array[]::text[];
  end if;

  insert into staff_login_lookup_attempts (ip_address, username_attempted)
  values (p_ip, p_username);

  select array_agg(u.email order by m.id)
  into v_identifiers
  from memberships m
  join auth.users u on u.id = m.profile_id
  where m.username = p_username;

  return coalesce(v_identifiers, array[]::text[]);
end;
$$;

commit;
