begin;
create extension if not exists pgtap;
select plan(6);

insert into organizations (id, name, slug) values
  ('00000093-0000-0000-0000-000000000001', 'Gmail Org', 'test-093-org');
insert into properties (id, organization_id, name, slug) values
  ('00000093-0000-0000-0000-000000000011', '00000093-0000-0000-0000-000000000001', 'Hotel Posta', 'gmail-a');

select lives_ok(
  $$insert into smart_inbox_mailboxes (id, property_id, provider, email_address)
    values ('00000093-0000-0000-0000-000000000021', '00000093-0000-0000-0000-000000000011', 'google', 'hotel@gmail.com')$$,
  'a property can connect a Gmail mailbox'
);
select throws_ok(
  $$insert into smart_inbox_mailboxes (property_id, provider, email_address)
    values ('00000093-0000-0000-0000-000000000011', 'yahoo', 'x@yahoo.com')$$,
  '23514', null,
  'only Microsoft and Google mailboxes are accepted'
);
select lives_ok(
  $$insert into smart_inbox_mailbox_secrets (mailbox_id, refresh_token_ciphertext, history_id)
    values ('00000093-0000-0000-0000-000000000021', 'ciphertext', '12345')$$,
  'the Gmail history position is stored with the mailbox secrets'
);
select lives_ok(
  $$insert into smart_inbox_messages (property_id, mailbox_id, graph_message_id, source)
    values ('00000093-0000-0000-0000-000000000011', '00000093-0000-0000-0000-000000000021', '18c2f0', 'gmail')$$,
  'a Gmail message is recorded with its mailbox and Gmail id'
);
select throws_ok(
  $$insert into smart_inbox_messages (property_id, source, body_text) values ('00000093-0000-0000-0000-000000000011', 'gmail', 'x')$$,
  '23514', null,
  'a Gmail message must come from a mailbox'
);
select ok(
  not has_table_privilege('authenticated', 'public.smart_inbox_mailbox_secrets', 'select'),
  'the Gmail history position stays out of reach of the app, like the tokens'
);

select * from finish();
rollback;
