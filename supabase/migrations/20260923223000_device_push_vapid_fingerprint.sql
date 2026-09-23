begin;

alter table public.device_push_subscriptions
  add column if not exists vapid_key_fingerprint text;

comment on column public.device_push_subscriptions.vapid_key_fingerprint is
  'SHA-256 hex fingerprint of the VAPID public key generation used when the browser subscription was created. Null means legacy/unknown.';

create or replace function public.claim_device_push_subscription(
  p_endpoint text,
  p_p256dh text,
  p_auth text,
  p_vapid_key_fingerprint text
) returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'not_authenticated';
  end if;

  if p_endpoint is null or length(trim(p_endpoint)) < 16 then
    raise exception 'invalid_endpoint';
  end if;
  if p_p256dh is null or length(trim(p_p256dh)) < 16 then
    raise exception 'invalid_p256dh';
  end if;
  if p_auth is null or length(trim(p_auth)) < 8 then
    raise exception 'invalid_auth';
  end if;

  insert into public.device_push_subscriptions (
    profile_id,
    endpoint,
    p256dh,
    auth,
    vapid_key_fingerprint
  )
  values (
    auth.uid(),
    p_endpoint,
    p_p256dh,
    p_auth,
    nullif(trim(p_vapid_key_fingerprint), '')
  )
  on conflict (endpoint) do update
  set profile_id = excluded.profile_id,
      p256dh = excluded.p256dh,
      auth = excluded.auth,
      vapid_key_fingerprint = excluded.vapid_key_fingerprint;
end;
$$;

revoke all on function public.claim_device_push_subscription(text, text, text, text) from public;
grant execute on function public.claim_device_push_subscription(text, text, text, text) to authenticated;

-- Transitional compatibility for already-deployed clients. New clients call
-- the 4-argument version and persist the fingerprint; legacy clients can
-- still claim a row until all deployments have rolled forward.
create or replace function public.claim_device_push_subscription(
  p_endpoint text,
  p_p256dh text,
  p_auth text
) returns void
language sql
security definer
set search_path = public
as $$
  select public.claim_device_push_subscription(p_endpoint, p_p256dh, p_auth, null);
$$;

revoke all on function public.claim_device_push_subscription(text, text, text) from public;
grant execute on function public.claim_device_push_subscription(text, text, text) to authenticated;

commit;
