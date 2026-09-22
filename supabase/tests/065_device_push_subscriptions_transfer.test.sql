-- 20260922210000_device_push_subscriptions_transfer_fix.sql:
-- claim_device_push_subscription() must let a device be reassigned to
-- whoever is currently authenticated on it (the shared front-desk device
-- scenario), even when the row currently belongs to a different profile,
-- while device_push_subscriptions' own SELECT/INSERT/UPDATE/DELETE RLS
-- policies stay exactly as strict as 043_device_push_subscriptions.test.sql
-- already covers -- this file only adds coverage for the function.
begin;
create extension if not exists pgtap;
select plan(8);

insert into auth.users (id) values
  ('00000065-0000-0000-0000-000000000001'),
  ('00000065-0000-0000-0000-000000000002');
insert into profiles (id, full_name) values
  ('00000065-0000-0000-0000-000000000001', 'Reception Device Owner'),
  ('00000065-0000-0000-0000-000000000002', 'Facchino Next Login');

-- Reception subscribes first on the shared device, via the same function
-- the client always calls (there is no other sanctioned write path).
set local role authenticated;
set local request.jwt.claim.sub = '00000065-0000-0000-0000-000000000001';

select lives_ok(
  $$ select claim_device_push_subscription('https://push.example/ep-065-shared', 'p256dh-065-a', 'auth-065-a') $$,
  'reception can create its own subscription via the function'
);

select is(
  (select profile_id from device_push_subscriptions where endpoint = 'https://push.example/ep-065-shared'),
  '00000065-0000-0000-0000-000000000001'::uuid,
  'reception owns the subscription it just created'
);

reset role;

-- Facchino logs in on the same physical device/browser and re-subscribes --
-- the client always calls the same function with its own (facchino's) auth.
set local role authenticated;
set local request.jwt.claim.sub = '00000065-0000-0000-0000-000000000002';

select lives_ok(
  $$ select claim_device_push_subscription('https://push.example/ep-065-shared', 'p256dh-065-b', 'auth-065-b') $$,
  'a different authenticated profile can claim the same device/endpoint (transfer, not a 403)'
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

-- The function takes no profile_id argument at all -- it always writes
-- auth.uid() -- so there is no way for a caller to claim a row on someone
-- else's behalf, unlike a raw client-supplied upsert would allow.
select function_returns('claim_device_push_subscription', array['text', 'text', 'text'], 'void', 'the function has no profile_id parameter to forge');

reset role;

-- The table's own RLS policies (043's guarantee) are completely untouched
-- by this migration: reception can no longer see the row once it belongs
-- to facchino, and cannot bypass the function to write it back directly.
set local role authenticated;
set local request.jwt.claim.sub = '00000065-0000-0000-0000-000000000001';

select is(
  (select count(*)::int from device_push_subscriptions where endpoint = 'https://push.example/ep-065-shared'),
  0,
  'reception can no longer see the row now that it belongs to facchino'
);

select throws_ok(
  $$
    insert into device_push_subscriptions (profile_id, endpoint, p256dh, auth)
    values ('00000065-0000-0000-0000-000000000001', 'https://push.example/ep-065-shared', 'p256dh-065-c', 'auth-065-c')
    on conflict (endpoint) do update
    set profile_id = excluded.profile_id, p256dh = excluded.p256dh, auth = excluded.auth
  $$,
  '42501', null,
  'a raw client upsert (bypassing the function) still cannot reassign someone else''s row'
);

reset role;

select * from finish();
rollback;
