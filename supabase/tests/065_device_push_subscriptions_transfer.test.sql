-- 20260922210000_device_push_subscriptions_transfer_fix.sql: an
-- on_conflict=endpoint upsert must be able to reassign an existing
-- subscription row to whoever is currently authenticated on that device,
-- even when the row currently belongs to a different profile (the shared
-- front-desk device scenario). Read/insert/delete isolation must stay
-- exactly as strict as 043_device_push_subscriptions.test.sql already
-- covers -- this file only adds coverage for the transfer-on-conflict path.
begin;
create extension if not exists pgtap;
select plan(6);

insert into auth.users (id) values
  ('00000065-0000-0000-0000-000000000001'),
  ('00000065-0000-0000-0000-000000000002');
insert into profiles (id, full_name) values
  ('00000065-0000-0000-0000-000000000001', 'Reception Device Owner'),
  ('00000065-0000-0000-0000-000000000002', 'Facchino Next Login');

-- Reception subscribes first on the shared device.
set local role authenticated;
set local request.jwt.claim.sub = '00000065-0000-0000-0000-000000000001';

insert into device_push_subscriptions (profile_id, endpoint, p256dh, auth) values
  ('00000065-0000-0000-0000-000000000001', 'https://push.example/ep-065-shared', 'p256dh-065-a', 'auth-065-a');

select is(
  (select profile_id from device_push_subscriptions where endpoint = 'https://push.example/ep-065-shared'),
  '00000065-0000-0000-0000-000000000001'::uuid,
  'reception owns the subscription it just created'
);

reset role;

-- Facchino logs in on the same physical device/browser and re-subscribes --
-- the client always upserts on_conflict=endpoint with its own profile_id.
set local role authenticated;
set local request.jwt.claim.sub = '00000065-0000-0000-0000-000000000002';

select lives_ok(
  $$
    insert into device_push_subscriptions (profile_id, endpoint, p256dh, auth)
    values ('00000065-0000-0000-0000-000000000002', 'https://push.example/ep-065-shared', 'p256dh-065-b', 'auth-065-b')
    on conflict (endpoint) do update
    set profile_id = excluded.profile_id, p256dh = excluded.p256dh, auth = excluded.auth
  $$,
  'a different authenticated profile can re-subscribe the same device/endpoint (transfer, not a 403)'
);

select is(
  (select profile_id from device_push_subscriptions where endpoint = 'https://push.example/ep-065-shared'),
  '00000065-0000-0000-0000-000000000002'::uuid,
  'the row now belongs to facchino, who is currently signed in on the device'
);

select is(
  (select p256dh from device_push_subscriptions where endpoint = 'https://push.example/ep-065-shared'),
  'p256dh-065-b',
  'the row''s keys were actually updated to the new subscription, not just left as reception''s'
);

-- A profile still cannot reassign a row to somebody else -- with check keeps
-- the row bound to whoever is actually authenticated.
select throws_ok(
  $$
    insert into device_push_subscriptions (profile_id, endpoint, p256dh, auth)
    values ('00000065-0000-0000-0000-000000000001', 'https://push.example/ep-065-shared', 'p256dh-065-c', 'auth-065-c')
    on conflict (endpoint) do update
    set profile_id = excluded.profile_id, p256dh = excluded.p256dh, auth = excluded.auth
  $$,
  '42501',
  null,
  'cannot upsert a row claiming a profile_id other than the caller''s own auth.uid()'
);

reset role;

-- Read isolation (043's own guarantee) is unaffected by this migration.
set local role authenticated;
set local request.jwt.claim.sub = '00000065-0000-0000-0000-000000000001';

select is(
  (select count(*)::int from device_push_subscriptions where endpoint = 'https://push.example/ep-065-shared'),
  0,
  'reception can no longer see the row now that it belongs to facchino'
);

reset role;

select * from finish();
rollback;
