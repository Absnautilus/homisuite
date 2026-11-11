begin;
create extension if not exists pgtap;
select plan(8);

insert into organizations (id, name, slug) values
  ('00000094-0000-0000-0000-000000000001', 'WA Org', 'test-094-org');
insert into properties (id, organization_id, name, slug) values
  ('00000094-0000-0000-0000-000000000011', '00000094-0000-0000-0000-000000000001', 'Hotel Chat', 'wa-a'),
  ('00000094-0000-0000-0000-000000000012', '00000094-0000-0000-0000-000000000001', 'Hotel Altro', 'wa-b');
insert into property_modules (property_id, module_id, enabled)
select p, id, true from modules, (values ('00000094-0000-0000-0000-000000000011'::uuid), ('00000094-0000-0000-0000-000000000012'::uuid)) v(p) where slug = 'smart_inbox';

insert into auth.users (id, email) values
  ('00000094-0000-0000-0000-000000000041', 'reception-094@example.com'),
  ('00000094-0000-0000-0000-000000000042', 'reception-b-094@example.com');
insert into profiles (id, full_name) values
  ('00000094-0000-0000-0000-000000000041', 'Luca'),
  ('00000094-0000-0000-0000-000000000042', 'Marta');
insert into memberships (profile_id, property_id, organization_id, role_id, status)
select fixture.profile_id, fixture.property_id, null, role.id, 'active'
from (values
  ('00000094-0000-0000-0000-000000000041'::uuid, '00000094-0000-0000-0000-000000000011'::uuid),
  ('00000094-0000-0000-0000-000000000042'::uuid, '00000094-0000-0000-0000-000000000012'::uuid)
) as fixture(profile_id, property_id)
join roles role on role.slug = 'receptionist';

insert into smart_inbox_whatsapp_accounts (id, property_id, phone_number_id, waba_id, display_phone_number)
values ('00000094-0000-0000-0000-000000000021', '00000094-0000-0000-0000-000000000011', '109876543210', '20000000001', '+39 041 000000');
insert into smart_inbox_whatsapp_secrets (account_id, access_token_ciphertext)
values ('00000094-0000-0000-0000-000000000021', 'ciphertext');

select lives_ok(
  $$insert into smart_inbox_messages (property_id, whatsapp_account_id, graph_message_id, source, from_address, body_text)
    values ('00000094-0000-0000-0000-000000000011', '00000094-0000-0000-0000-000000000021', 'wamid.A', 'whatsapp', '4915112345678', 'Hallo')$$,
  'a WhatsApp message is recorded with its number'
);
select throws_ok(
  $$insert into smart_inbox_messages (property_id, whatsapp_account_id, graph_message_id, source, body_text)
    values ('00000094-0000-0000-0000-000000000011', '00000094-0000-0000-0000-000000000021', 'wamid.A', 'whatsapp', 'again')$$,
  '23505', null,
  'Meta retries do not create the same message twice'
);
select throws_ok(
  $$insert into smart_inbox_messages (property_id, whatsapp_account_id, graph_message_id, source, body_text)
    values ('00000094-0000-0000-0000-000000000012', '00000094-0000-0000-0000-000000000021', 'wamid.X', 'whatsapp', 'x')$$,
  '23503', null,
  'a message cannot point at another property''s number'
);
select throws_ok(
  $$insert into smart_inbox_whatsapp_accounts (property_id, phone_number_id, waba_id)
    values ('00000094-0000-0000-0000-000000000012', '109876543210', '20000000002')$$,
  '23505', null,
  'a number is linked to one property only'
);
select ok(
  not has_table_privilege('authenticated', 'public.smart_inbox_whatsapp_secrets', 'select')
  and not has_table_privilege('authenticated', 'public.smart_inbox_whatsapp_accounts', 'insert')
  and not has_table_privilege('authenticated', 'public.smart_inbox_whatsapp_accounts', 'update'),
  'tokens are out of reach and links are made only through the Edge Function'
);

set local role authenticated;
set local request.jwt.claim.sub = '00000094-0000-0000-0000-000000000041';
select is(
  (select display_phone_number from smart_inbox_whatsapp_accounts),
  '+39 041 000000',
  'agents see their property''s linked number'
);
set local request.jwt.claim.sub = '00000094-0000-0000-0000-000000000042';
select is((select count(*)::int from smart_inbox_whatsapp_accounts), 0, 'agents of another property do not');
reset role;

select is(
  (select count(*)::int from smart_inbox_messages where whatsapp_account_id is not null),
  1,
  'one message for the number so far'
);

select * from finish();
rollback;
