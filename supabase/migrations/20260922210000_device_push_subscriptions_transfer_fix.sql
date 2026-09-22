-- device_push_subscriptions_owner (20260912100000_device_push_subscriptions.sql)
-- is a single `for all using (profile_id = auth.uid()) with check (...)`
-- policy that blocks the table's own documented "shared device" behavior:
-- saveDevicePushSubscription()'s on_conflict=endpoint upsert is supposed to
-- transfer an existing subscription row to whoever is currently signed in
-- on that device (see that function's own comment). Confirmed live: a
-- facchino account got a 403 re-subscribing a device that a reception
-- account had already registered notifications on.
--
-- A first attempt just split the policy per command with a permissive
-- UPDATE `using (true)` -- that alone is NOT enough. Verified locally: for
-- INSERT ... ON CONFLICT DO UPDATE, PostgreSQL requires the pre-existing
-- conflicting row to be visible under the table's SELECT policy before it
-- will even attempt the UPDATE path at all, regardless of how permissive
-- the UPDATE policy's own USING clause is -- otherwise it raises exactly
-- this same "violates row-level security policy (USING expression)" error.
-- Broadening SELECT to fix that would let any authenticated user read every
-- other profile's subscription (their push endpoint + encryption keys) --
-- a real privacy regression this table's original design deliberately
-- avoided.
--
-- Fix: leave every existing RLS policy on device_push_subscriptions
-- completely untouched -- SELECT/INSERT/UPDATE/DELETE all stay scoped to
-- profile_id = auth.uid(), exactly as strict as before, still covered by
-- 043_device_push_subscriptions.test.sql. Add one narrow `security definer`
-- function that performs the claim/transfer directly, bypassing per-row RLS
-- the same way other resolver functions in this schema do (e.g.
-- housekeeping_push_recipient_profiles), but hardcoding the write to
-- auth.uid() itself -- a caller can never write a row under anyone else's
-- profile through it. This is the only sanctioned way to reassign an
-- existing endpoint row; the table's RLS otherwise stays exactly as private
-- as it was.

begin;

create or replace function claim_device_push_subscription(
  p_endpoint text,
  p_p256dh text,
  p_auth text
) returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'not_authenticated';
  end if;
  insert into device_push_subscriptions (profile_id, endpoint, p256dh, auth)
  values (auth.uid(), p_endpoint, p_p256dh, p_auth)
  on conflict (endpoint) do update
  set profile_id = excluded.profile_id, p256dh = excluded.p256dh, auth = excluded.auth;
end;
$$;

revoke all on function claim_device_push_subscription(text, text, text) from public;
grant execute on function claim_device_push_subscription(text, text, text) to authenticated;

comment on function claim_device_push_subscription(text, text, text) is
  'Creates or transfers a device_push_subscriptions row to the calling profile. Bypasses per-row RLS (security definer) but always writes auth.uid() as the owner regardless of any other input -- the sanctioned way to support "re-subscribing a shared device transfers it to whoever is signed in now" without broadening the table''s own SELECT/UPDATE policies.';

commit;
