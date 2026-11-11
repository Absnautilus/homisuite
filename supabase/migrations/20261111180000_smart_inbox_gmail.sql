-- Smart Inbox — Gmail mailboxes, alongside Outlook.
--
-- A property connects one mailbox, from Microsoft 365 or Google. Gmail has
-- no webhook without Google Cloud Pub/Sub, so new mail is collected by a
-- short poll (smart-inbox-maintenance?task=poll, every 1-2 minutes) that
-- reads the mailbox history since the last seen history id.
--
-- * smart_inbox_mailboxes.provider accepts 'google'.
-- * smart_inbox_mailbox_secrets.history_id: Gmail's position in the
--   mailbox history (service-role only, like the rest of that table).
-- * smart_inbox_messages.source accepts 'gmail'; graph_message_id holds
--   the provider's message id for either provider.

begin;

alter table smart_inbox_mailboxes drop constraint smart_inbox_mailboxes_provider_check;
alter table smart_inbox_mailboxes add constraint smart_inbox_mailboxes_provider_check
  check (provider in ('microsoft', 'google'));

alter table smart_inbox_mailbox_secrets add column history_id text;

alter table smart_inbox_messages drop constraint smart_inbox_messages_source_check;
alter table smart_inbox_messages add constraint smart_inbox_messages_source_check
  check (source in ('outlook', 'gmail', 'booking', 'expedia', 'airbnb', 'whatsapp', 'phone', 'other'));

alter table smart_inbox_messages drop constraint smart_inbox_messages_outlook_has_mailbox;
alter table smart_inbox_messages add constraint smart_inbox_messages_email_has_mailbox check (
  source not in ('outlook', 'gmail') or (mailbox_id is not null and graph_message_id is not null)
);

comment on column smart_inbox_messages.graph_message_id is
  'Id of the message in the connected mailbox (Microsoft Graph or Gmail), null for pasted messages.';
comment on column smart_inbox_mailbox_secrets.history_id is
  'Gmail only: last mailbox history id read by the poll.';

commit;
