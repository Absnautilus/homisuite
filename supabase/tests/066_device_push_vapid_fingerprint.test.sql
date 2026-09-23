begin;
create extension if not exists pgtap;
select plan(6);

select has_column(
  'public',
  'device_push_subscriptions',
  'vapid_key_fingerprint',
  'device push subscriptions track the VAPID key generation'
);

insert into auth.users (id) values ('00000066-0000-0000-0000-000000000001');
insert into profiles (id, full_name) values ('00000066-0000-0000-0000-000000000001', 'Push Fingerprint User');

set local role authenticated;
set local request.jwt.claim.sub = '00000066-0000-0000-0000-000000000001';

select lives_ok(
  $$ select claim_device_push_subscription(
    'https://push.example/ep-066',
    'p256dh-066-long-enough',
    'auth-066-long',
    'fingerprint-066'
  ) $$,
  '4-argument claim succeeds for the authenticated profile'
);

select is(
  (select vapid_key_fingerprint from device_push_subscriptions where endpoint = 'https://push.example/ep-066'),
  'fingerprint-066',
  'claim stores the VAPID fingerprint'
);

select lives_ok(
  $$ select claim_device_push_subscription(
    'https://push.example/ep-066',
    'p256dh-066-updated-long',
    'auth-066-updated',
    'fingerprint-067'
  ) $$,
  'reclaim updates an existing endpoint'
);

select is(
  (select vapid_key_fingerprint from device_push_subscriptions where endpoint = 'https://push.example/ep-066'),
  'fingerprint-067',
  'reclaim updates the VAPID fingerprint'
);

select throws_ok(
  $$ select claim_device_push_subscription('short', 'short', 'short', 'fingerprint') $$,
  null,
  'invalid_endpoint',
  'claim rejects obviously invalid subscription input'
);

reset role;
select * from finish();
rollback;
