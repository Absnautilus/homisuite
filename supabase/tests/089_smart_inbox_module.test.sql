begin;
create extension if not exists pgtap;
select plan(49);

-- ---------------------------------------------------------------------------
-- Fixtures: A and B are entitled properties in different organizations;
-- C belongs to org A but does NOT have Smart Inbox switched on.
-- ---------------------------------------------------------------------------
insert into organizations (id, name, slug) values
  ('00000089-0000-0000-0000-000000000001', 'Inbox Org A', 'test-089-org-a'),
  ('00000089-0000-0000-0000-000000000002', 'Inbox Org B', 'test-089-org-b');

insert into properties (id, organization_id, name, slug) values
  ('00000089-0000-0000-0000-000000000011', '00000089-0000-0000-0000-000000000001', 'Inbox Property A', 'inbox-a'),
  ('00000089-0000-0000-0000-000000000012', '00000089-0000-0000-0000-000000000002', 'Inbox Property B', 'inbox-b'),
  ('00000089-0000-0000-0000-000000000013', '00000089-0000-0000-0000-000000000001', 'Inbox Property C', 'inbox-c');

insert into property_modules (property_id, module_id, enabled)
select property_id, module.id, true
from (values
  ('00000089-0000-0000-0000-000000000011'::uuid),
  ('00000089-0000-0000-0000-000000000012'::uuid)
) as entitled(property_id)
cross join modules module
where module.slug = 'smart_inbox';

insert into auth.users (id, email) values
  ('00000089-0000-0000-0000-000000000041', 'reception-a-089@example.com'),
  ('00000089-0000-0000-0000-000000000042', 'manager-a-089@example.com'),
  ('00000089-0000-0000-0000-000000000043', 'manager-b-089@example.com'),
  ('00000089-0000-0000-0000-000000000044', 'manager-c-089@example.com');

insert into profiles (id, full_name) values
  ('00000089-0000-0000-0000-000000000041', 'Reception A'),
  ('00000089-0000-0000-0000-000000000042', 'Manager A'),
  ('00000089-0000-0000-0000-000000000043', 'Manager B'),
  ('00000089-0000-0000-0000-000000000044', 'Manager C');

insert into memberships (profile_id, property_id, organization_id, role_id, status)
select fixture.profile_id, fixture.property_id, null, role.id, 'active'
from (values
  ('00000089-0000-0000-0000-000000000041'::uuid, '00000089-0000-0000-0000-000000000011'::uuid, 'receptionist'),
  ('00000089-0000-0000-0000-000000000042'::uuid, '00000089-0000-0000-0000-000000000011'::uuid, 'manager'),
  ('00000089-0000-0000-0000-000000000043'::uuid, '00000089-0000-0000-0000-000000000012'::uuid, 'manager'),
  ('00000089-0000-0000-0000-000000000044'::uuid, '00000089-0000-0000-0000-000000000013'::uuid, 'manager')
) as fixture(profile_id, property_id, role_slug)
join roles role on role.slug = fixture.role_slug;

insert into smart_inbox_settings (property_id, reply_signature) values
  ('00000089-0000-0000-0000-000000000011', 'Front Office A');

insert into smart_inbox_knowledge_entries (id, property_id, title, content) values
  ('00000089-0000-0000-0000-000000000051', '00000089-0000-0000-0000-000000000011', 'Colazione', '7:00-10:30'),
  ('00000089-0000-0000-0000-000000000052', '00000089-0000-0000-0000-000000000012', 'Parcheggio', '25 euro al giorno');

insert into smart_inbox_mailboxes (id, property_id, email_address) values
  ('00000089-0000-0000-0000-000000000061', '00000089-0000-0000-0000-000000000011', 'info@a.example'),
  ('00000089-0000-0000-0000-000000000062', '00000089-0000-0000-0000-000000000012', 'info@b.example');

insert into smart_inbox_mailbox_secrets (mailbox_id, refresh_token_ciphertext, graph_subscription_id) values
  ('00000089-0000-0000-0000-000000000061', 'ciphertext-a', 'sub-a');

insert into smart_inbox_conversations (id, property_id, guest_address, guest_name) values
  ('00000089-0000-0000-0000-000000000091', '00000089-0000-0000-0000-000000000011', 'mario@guest.example', 'Mario'),
  ('00000089-0000-0000-0000-000000000092', '00000089-0000-0000-0000-000000000012', 'anna@guest.example', 'Anna');

insert into smart_inbox_messages (id, property_id, mailbox_id, graph_message_id, subject, status) values
  ('00000089-0000-0000-0000-000000000071', '00000089-0000-0000-0000-000000000011', '00000089-0000-0000-0000-000000000061', 'graph-a-1', 'Orari colazione?', 'draft_ready'),
  ('00000089-0000-0000-0000-000000000072', '00000089-0000-0000-0000-000000000011', '00000089-0000-0000-0000-000000000061', 'graph-a-2', 'Transfer', 'draft_ready'),
  ('00000089-0000-0000-0000-000000000073', '00000089-0000-0000-0000-000000000012', '00000089-0000-0000-0000-000000000062', 'graph-b-1', 'Parcheggio?', 'draft_ready'),
  ('00000089-0000-0000-0000-000000000074', '00000089-0000-0000-0000-000000000012', '00000089-0000-0000-0000-000000000062', 'graph-b-2', 'Newsletter', 'ignored');

insert into smart_inbox_drafts (id, property_id, message_id, body, ai_body, status) values
  ('00000089-0000-0000-0000-000000000081', '00000089-0000-0000-0000-000000000011', '00000089-0000-0000-0000-000000000071', 'Buongiorno', 'Buongiorno', 'pending'),
  ('00000089-0000-0000-0000-000000000082', '00000089-0000-0000-0000-000000000011', '00000089-0000-0000-0000-000000000072', 'Gentile ospite', 'Gentile ospite', 'sent'),
  ('00000089-0000-0000-0000-000000000083', '00000089-0000-0000-0000-000000000012', '00000089-0000-0000-0000-000000000073', 'Hello', 'Hello', 'pending');

insert into smart_inbox_ai_usage (property_id, message_id, model, input_tokens, output_tokens) values
  ('00000089-0000-0000-0000-000000000011', '00000089-0000-0000-0000-000000000071', 'claude-opus-5-5', 1200, 300);

-- ---------------------------------------------------------------------------
-- Registration and privilege surface
-- ---------------------------------------------------------------------------
select is((select status from modules where slug = 'smart_inbox'), 'beta', 'smart_inbox is registered as a beta module');
select is(
  (select count(*)::int from permissions where slug in ('smart_inbox.view', 'smart_inbox.manage')),
  2,
  'smart_inbox exposes view and manage capabilities'
);
select ok(
  not exists (
    select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname like 'smart\_inbox\_%' and c.relkind = 'r'
      and has_table_privilege('anon', c.oid, 'select,insert,update,delete')
  ),
  'anon has no privilege on any Smart Inbox table'
);
select ok(
  not has_table_privilege('authenticated', 'public.smart_inbox_mailbox_secrets', 'select,insert,update,delete'),
  'authenticated has no privilege on mailbox secrets'
);
select ok(
  not has_table_privilege('authenticated', 'public.smart_inbox_mailboxes', 'insert,update,delete'),
  'mailbox connection state is written only by the Edge Functions'
);
select ok(
  not has_table_privilege('authenticated', 'public.smart_inbox_messages', 'insert,delete'),
  'messages are inserted only by the Edge Functions'
);
select ok(
  has_column_privilege('authenticated', 'public.smart_inbox_messages', 'status', 'update')
  and not has_column_privilege('authenticated', 'public.smart_inbox_messages', 'subject', 'update'),
  'staff can change a message status but not rewrite its content'
);
select ok(
  has_column_privilege('authenticated', 'public.smart_inbox_drafts', 'body', 'update')
  and not has_column_privilege('authenticated', 'public.smart_inbox_drafts', 'ai_body', 'update')
  and not has_column_privilege('authenticated', 'public.smart_inbox_drafts', 'status', 'update')
  and not has_column_privilege('authenticated', 'public.smart_inbox_drafts', 'edited_by', 'update'),
  'staff can edit a draft body only'
);
select ok(
  not has_column_privilege('authenticated', 'public.smart_inbox_settings', 'updated_by', 'update'),
  'settings updated_by is server-stamped, not client-writable'
);

update smart_inbox_messages set thread_id = '00000089-0000-0000-0000-000000000091'
where id in ('00000089-0000-0000-0000-000000000071', '00000089-0000-0000-0000-000000000072');

select ok(
  has_column_privilege('authenticated', 'public.smart_inbox_conversations', 'assigned_to', 'update')
  and not has_column_privilege('authenticated', 'public.smart_inbox_conversations', 'guest_address', 'update')
  and not has_column_privilege('authenticated', 'public.smart_inbox_conversations', 'assigned_by', 'update')
  and not has_table_privilege('authenticated', 'public.smart_inbox_conversations', 'insert,delete'),
  'staff can only change who a conversation is assigned to'
);

-- ---------------------------------------------------------------------------
-- Tenant integrity
-- ---------------------------------------------------------------------------
select throws_ok(
  $$update smart_inbox_messages set thread_id = '00000089-0000-0000-0000-000000000092'
    where id = '00000089-0000-0000-0000-000000000071'$$,
  '23503', null,
  'a message cannot join another property guest conversation'
);
select throws_ok(
  $$insert into smart_inbox_conversations (property_id, guest_address) values ('00000089-0000-0000-0000-000000000011', 'Mario@Guest.example')$$,
  '23514', null,
  'guest addresses are stored lower-cased'
);
select throws_ok(
  $$insert into smart_inbox_messages (property_id, mailbox_id, graph_message_id)
    values ('00000089-0000-0000-0000-000000000011', '00000089-0000-0000-0000-000000000062', 'cross')$$,
  '23503', null,
  'a message cannot reference a mailbox from another property'
);
select throws_ok(
  $$insert into smart_inbox_drafts (property_id, message_id, body, ai_body)
    values ('00000089-0000-0000-0000-000000000011', '00000089-0000-0000-0000-000000000074', 'x', 'x')$$,
  '23503', null,
  'a draft cannot reference a message from another property'
);
select throws_ok(
  $$insert into smart_inbox_messages (property_id, mailbox_id, graph_message_id)
    values ('00000089-0000-0000-0000-000000000011', '00000089-0000-0000-0000-000000000061', 'graph-a-1')$$,
  '23505', null,
  'the same Graph message is stored at most once per mailbox'
);

-- ---------------------------------------------------------------------------
-- Receptionist A: works the inbox, cannot configure
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claim.sub = '00000089-0000-0000-0000-000000000041';

select is((select count(*)::int from smart_inbox_messages), 2, 'receptionist sees only their property messages');
select is((select count(*)::int from smart_inbox_drafts), 2, 'receptionist sees only their property drafts');
select is((select count(*)::int from smart_inbox_knowledge_entries), 1, 'receptionist reads only their property knowledge base');
select is((select count(*)::int from smart_inbox_mailboxes), 1, 'receptionist sees only their property mailbox');
select is((select count(*)::int from smart_inbox_ai_usage), 0, 'receptionist cannot read AI usage');
select throws_ok(
  $$select * from smart_inbox_mailbox_secrets$$,
  '42501', null,
  'receptionist cannot read mailbox secrets'
);
select throws_ok(
  $$insert into smart_inbox_knowledge_entries (property_id, title, content)
    values ('00000089-0000-0000-0000-000000000011', 'Spa', 'Aperta 10-20')$$,
  '42501', null,
  'receptionist cannot edit the knowledge base'
);

update smart_inbox_drafts set body = 'Buongiorno, la colazione è servita dalle 7.'
where id = '00000089-0000-0000-0000-000000000081';
select is(
  (select edited_by from smart_inbox_drafts where id = '00000089-0000-0000-0000-000000000081'),
  '00000089-0000-0000-0000-000000000041'::uuid,
  'editing a pending draft stamps the editor server-side'
);

update smart_inbox_drafts set body = 'rewrite after send'
where id = '00000089-0000-0000-0000-000000000082';
select is(
  (select body from smart_inbox_drafts where id = '00000089-0000-0000-0000-000000000082'),
  'Gentile ospite',
  'a sent draft can no longer be edited'
);

update smart_inbox_drafts set body = 'cross-tenant'
where id = '00000089-0000-0000-0000-000000000083';
reset role;
select is(
  (select body from smart_inbox_drafts where id = '00000089-0000-0000-0000-000000000083'),
  'Hello',
  'receptionist cannot edit another property draft'
);
set local role authenticated;
set local request.jwt.claim.sub = '00000089-0000-0000-0000-000000000041';

-- Agents and conversations
select is((select count(*)::int from smart_inbox_conversations), 1, 'receptionist sees only their property conversations');
select is(
  (select array_agg(full_name order by full_name) from smart_inbox_agents('00000089-0000-0000-0000-000000000011')),
  array['Manager A', 'Reception A'],
  'the agents of a property are its staff with smart_inbox.view'
);
select is(
  (select count(*)::int from smart_inbox_agents('00000089-0000-0000-0000-000000000012')),
  0,
  'another property agents are not listed'
);
update smart_inbox_conversations set assigned_to = '00000089-0000-0000-0000-000000000041'
where id = '00000089-0000-0000-0000-000000000091';
select is(
  (select row(assigned_to, assigned_by, assigned_at is not null)::text from smart_inbox_conversations where id = '00000089-0000-0000-0000-000000000091'),
  row('00000089-0000-0000-0000-000000000041'::uuid, '00000089-0000-0000-0000-000000000041'::uuid, true)::text,
  'an agent can take a conversation; who and when are stamped server-side'
);
select lives_ok(
  $$update smart_inbox_conversations set assigned_to = '00000089-0000-0000-0000-000000000042'
    where id = '00000089-0000-0000-0000-000000000091'$$,
  'an agent can hand a conversation to a colleague'
);
select throws_ok(
  $$update smart_inbox_conversations set assigned_to = '00000089-0000-0000-0000-000000000043'
    where id = '00000089-0000-0000-0000-000000000091'$$,
  '42501', null,
  'a conversation cannot be assigned to staff of another property'
);
select throws_ok(
  $$update smart_inbox_conversations set assigned_to = '00000089-0000-0000-0000-000000000044'
    where id = '00000089-0000-0000-0000-000000000091'$$,
  '42501', null,
  'a conversation cannot be assigned to a colleague who is not a Smart Inbox agent'
);
update smart_inbox_conversations set assigned_to = '00000089-0000-0000-0000-000000000041'
where id = '00000089-0000-0000-0000-000000000092';
reset role;
select is(
  (select assigned_to from smart_inbox_conversations where id = '00000089-0000-0000-0000-000000000092'),
  null,
  'an agent cannot take another property conversation'
);
set local role authenticated;
set local request.jwt.claim.sub = '00000089-0000-0000-0000-000000000041';

update smart_inbox_messages set status = 'dismissed'
where id = '00000089-0000-0000-0000-000000000071';
select is(
  (select status from smart_inbox_messages where id = '00000089-0000-0000-0000-000000000071'),
  'dismissed',
  'receptionist can dismiss a message'
);
select throws_ok(
  $$update smart_inbox_messages set status = 'replied' where id = '00000089-0000-0000-0000-000000000071'$$,
  '42501', null,
  'staff cannot mark a message replied without sending it'
);
update smart_inbox_messages set status = 'needs_attention'
where id = '00000089-0000-0000-0000-000000000071';
select is(
  (select status from smart_inbox_messages where id = '00000089-0000-0000-0000-000000000071'),
  'needs_attention',
  'receptionist can reopen a dismissed message'
);

-- ---------------------------------------------------------------------------
-- Manager A: configures their own property only
-- ---------------------------------------------------------------------------
set local request.jwt.claim.sub = '00000089-0000-0000-0000-000000000042';

select lives_ok(
  $$insert into smart_inbox_knowledge_entries (property_id, title, content)
    values ('00000089-0000-0000-0000-000000000011', 'Spa', 'Aperta 10-20')$$,
  'manager can add a knowledge base entry'
);
select lives_ok(
  $$update smart_inbox_settings set tone = 'formale' where property_id = '00000089-0000-0000-0000-000000000011'$$,
  'manager can change settings'
);
select is(
  (select updated_by from smart_inbox_settings where property_id = '00000089-0000-0000-0000-000000000011'),
  '00000089-0000-0000-0000-000000000042'::uuid,
  'settings record who changed them'
);
select is((select count(*)::int from smart_inbox_ai_usage), 1, 'manager reads their property AI usage');
select throws_ok(
  $$insert into smart_inbox_knowledge_entries (property_id, title, content)
    values ('00000089-0000-0000-0000-000000000012', 'Intruso', 'x')$$,
  '42501', null,
  'manager cannot write another property knowledge base'
);
select throws_ok(
  $$insert into smart_inbox_settings (property_id) values ('00000089-0000-0000-0000-000000000012')$$,
  '42501', null,
  'manager cannot create settings for another property'
);

-- ---------------------------------------------------------------------------
-- Manager B: isolated from A
-- ---------------------------------------------------------------------------
set local request.jwt.claim.sub = '00000089-0000-0000-0000-000000000043';

select is((select count(*)::int from smart_inbox_messages), 2, 'manager B sees only property B messages');
select is((select count(*)::int from smart_inbox_settings), 0, 'manager B cannot read property A settings');
select is(
  (select array_agg(guest_address) from smart_inbox_conversations),
  array['anna@guest.example'],
  'manager B sees only property B conversations'
);
select is(
  smart_inbox_is_agent('00000089-0000-0000-0000-000000000011', '00000089-0000-0000-0000-000000000041'),
  false,
  'smart_inbox_is_agent answers nothing about a property the caller does not work for'
);

-- ---------------------------------------------------------------------------
-- Manager C: property without the module fails closed
-- ---------------------------------------------------------------------------
set local request.jwt.claim.sub = '00000089-0000-0000-0000-000000000044';

select is((select count(*)::int from smart_inbox_knowledge_entries), 0, 'a property without Smart Inbox exposes no rows');
select throws_ok(
  $$insert into smart_inbox_settings (property_id) values ('00000089-0000-0000-0000-000000000013')$$,
  '42501', null,
  'a property without Smart Inbox cannot be configured'
);
select throws_ok(
  $$insert into smart_inbox_knowledge_entries (property_id, title, content)
    values ('00000089-0000-0000-0000-000000000013', 'x', 'y')$$,
  '42501', null,
  'a property without Smart Inbox cannot get a knowledge base'
);

reset role;

select * from finish();
rollback;
