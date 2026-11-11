-- Smart Inbox — WhatsApp Business Platform (Cloud API).
--
-- A property links one WhatsApp Business number. Guest messages reach the
-- smart-inbox-whatsapp webhook (signed by Meta with the app secret), become
-- Smart Inbox messages with channel 'whatsapp', get a draft like any other
-- message, and the approved reply is sent back through the Cloud API --
-- within WhatsApp's 24-hour customer service window.
--
-- * smart_inbox_whatsapp_accounts: the number (one per property), readable
--   by agents for the settings screen.
-- * smart_inbox_whatsapp_secrets: the access token, encrypted by the Edge
--   Functions (same key as mailbox tokens); service role only.
-- * smart_inbox_messages.whatsapp_account_id: set on messages that arrived
--   through it (graph_message_id holds the WhatsApp message id).

begin;

create table smart_inbox_whatsapp_accounts (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null unique references properties(id) on delete cascade,
  phone_number_id text not null unique check (phone_number_id ~ '^[0-9]{5,32}$'),
  waba_id text not null check (waba_id ~ '^[0-9]{5,32}$'),
  display_phone_number text,
  verified_name text,
  status text not null default 'connected' check (status in ('connected', 'error', 'disconnected')),
  last_error text,
  connected_by uuid references profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint smart_inbox_whatsapp_accounts_property_id_id_key unique (property_id, id)
);

create trigger smart_inbox_whatsapp_accounts_set_updated_at
  before update on smart_inbox_whatsapp_accounts
  for each row execute function set_updated_at();

create table smart_inbox_whatsapp_secrets (
  account_id uuid primary key references smart_inbox_whatsapp_accounts(id) on delete cascade,
  access_token_ciphertext text not null,
  updated_at timestamptz not null default now()
);

create trigger smart_inbox_whatsapp_secrets_set_updated_at
  before update on smart_inbox_whatsapp_secrets
  for each row execute function set_updated_at();

alter table smart_inbox_whatsapp_accounts enable row level security;
alter table smart_inbox_whatsapp_secrets enable row level security;

create policy smart_inbox_whatsapp_accounts_select on smart_inbox_whatsapp_accounts for select to authenticated
  using (has_permission(property_id, 'smart_inbox.view'));
-- smart_inbox_whatsapp_secrets: intentionally no policy at all.

revoke all on table smart_inbox_whatsapp_accounts, smart_inbox_whatsapp_secrets from public, anon, authenticated;
grant select on table smart_inbox_whatsapp_accounts to authenticated;

alter table smart_inbox_messages
  add column whatsapp_account_id uuid,
  add constraint smart_inbox_messages_whatsapp_account_fkey foreign key (property_id, whatsapp_account_id)
    references smart_inbox_whatsapp_accounts(property_id, id) on delete set null (whatsapp_account_id),
  add constraint smart_inbox_messages_whatsapp_id_key unique (whatsapp_account_id, graph_message_id),
  add constraint smart_inbox_messages_one_channel check (mailbox_id is null or whatsapp_account_id is null);

comment on table smart_inbox_whatsapp_secrets is
  'Service-role only: encrypted WhatsApp Cloud API access token of a property''s number. No client policy or grant, ever.';
comment on column smart_inbox_messages.whatsapp_account_id is
  'Set when the message arrived through the property''s WhatsApp Business number; the reply is sent back through it.';

commit;
