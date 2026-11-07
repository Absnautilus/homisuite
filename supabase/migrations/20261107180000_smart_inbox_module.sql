-- Smart Inbox — schema, capabilities and RLS.
--
-- Smart Inbox reads a property's Outlook mailbox (Microsoft Graph), drafts a
-- reply to each guest email with Claude using the property's own knowledge
-- base, and lets front-desk staff review, edit and send that draft from
-- homisuite. See docs/smart-inbox.md for the end-to-end flow.
--
-- Core-native from day one, the same shape as Turni
-- (20260918160000_shifts_property_scoped_schema.sql): every table carries
-- `property_id not null references properties(id)`, RLS calls
-- has_permission() directly, and no legacy hotel_id bridge is involved.
-- Like Turni and Dining this migration creates NO property_modules rows:
-- every property starts without Smart Inbox, so every module permission
-- below fails closed through has_permission() until the module is switched
-- on for a property as a commercial decision.
--
-- Write ownership is split deliberately:
--   * staff (authenticated, through RLS) own configuration (settings,
--     knowledge base) and the human decisions on a message (edit the draft
--     text, dismiss/reopen a message);
--   * the Edge Functions (service_role) own everything that comes from or
--     goes to Microsoft/Anthropic: mailbox connection state, inbound
--     messages, AI output, sending, usage accounting.
-- OAuth refresh tokens live in smart_inbox_mailbox_secrets, which no
-- client role can read or write at all, and are stored encrypted by the
-- Edge Functions (AES-GCM, key in the SMART_INBOX_TOKEN_KEY secret) so a
-- database dump alone never yields a usable Microsoft credential.

begin;

-- ---------------------------------------------------------------------------
-- Module and capabilities
-- ---------------------------------------------------------------------------
insert into modules (slug, display_name, status)
values ('smart_inbox', 'Smart Inbox', 'beta')
on conflict (slug) do update set display_name = excluded.display_name;

insert into permissions (slug, module_id)
select capability.slug, module.id
from modules module
cross join (values
  -- read the inbox, work on drafts (edit, send, dismiss)
  ('smart_inbox.view'),
  -- connect/disconnect the mailbox, edit settings and knowledge base,
  -- read AI usage
  ('smart_inbox.manage')
) as capability(slug)
where module.slug = 'smart_inbox'
on conflict (slug) do update set module_id = excluded.module_id;

insert into role_permissions (role_id, permission_id)
select role.id, permission.id
from roles role
join permissions permission on true
where (role.slug, permission.slug) in (
  ('receptionist', 'smart_inbox.view'),
  ('manager', 'smart_inbox.view'),
  ('manager', 'smart_inbox.manage'),
  ('property_admin', 'smart_inbox.view'),
  ('property_admin', 'smart_inbox.manage'),
  ('organization_admin', 'smart_inbox.view'),
  ('organization_admin', 'smart_inbox.manage')
)
on conflict (role_id, permission_id) do nothing;

-- ---------------------------------------------------------------------------
-- Configuration
-- ---------------------------------------------------------------------------
create table smart_inbox_settings (
  property_id uuid primary key references properties(id) on delete cascade,
  -- Appended by the AI to every draft (e.g. "Front Office — Hotel X").
  reply_signature text not null default '' check (char_length(reply_signature) <= 2000),
  tone text not null default 'cordiale' check (tone in ('cordiale', 'formale', 'essenziale')),
  -- false = messages are still collected and classified, but no draft is
  -- generated until a staff member asks for one.
  auto_draft boolean not null default true,
  -- Lower-case addresses ("noreply@x.com") or domains ("booking.com") that
  -- are never sent to the AI. Built-in OTA/no-reply filters apply on top.
  ignored_senders text[] not null default '{}' check (cardinality(ignored_senders) <= 200),
  updated_by uuid references profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger smart_inbox_settings_set_updated_at
  before update on smart_inbox_settings
  for each row execute function set_updated_at();

-- updated_by is stamped server-side, never taken from the client payload.
create function smart_inbox_settings_stamp_updater() returns trigger
language plpgsql security invoker set search_path = public as $$
begin
  if auth.uid() is not null then
    new.updated_by := auth.uid();
  end if;
  return new;
end;
$$;

create trigger smart_inbox_settings_stamp_updater
  before insert or update on smart_inbox_settings
  for each row execute function smart_inbox_settings_stamp_updater();

-- What the hotel wants the assistant to know: services, opening hours,
-- policies, FAQs. Sent to the model as one cached block per request.
create table smart_inbox_knowledge_entries (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references properties(id) on delete cascade,
  title text not null check (char_length(btrim(title)) between 1 and 200),
  content text not null check (char_length(btrim(content)) between 1 and 20000),
  active boolean not null default true,
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index smart_inbox_knowledge_entries_property_idx
  on smart_inbox_knowledge_entries(property_id, sort_order);

create trigger smart_inbox_knowledge_entries_set_updated_at
  before update on smart_inbox_knowledge_entries
  for each row execute function set_updated_at();

-- ---------------------------------------------------------------------------
-- Mailbox connection (one per property)
-- ---------------------------------------------------------------------------
create table smart_inbox_mailboxes (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null unique references properties(id) on delete cascade,
  provider text not null default 'microsoft' check (provider in ('microsoft')),
  email_address text not null,
  display_name text,
  status text not null default 'connected' check (status in ('connected', 'error', 'disconnected')),
  last_error text,
  subscription_expires_at timestamptz,
  connected_by uuid references profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint smart_inbox_mailboxes_property_id_id_key unique (property_id, id)
);

create trigger smart_inbox_mailboxes_set_updated_at
  before update on smart_inbox_mailboxes
  for each row execute function set_updated_at();

-- Service-role only. No policy is ever created on this table and every
-- client grant is revoked below: RLS enabled + zero policies + zero grants.
create table smart_inbox_mailbox_secrets (
  mailbox_id uuid primary key references smart_inbox_mailboxes(id) on delete cascade,
  -- AES-GCM ciphertext produced by the Edge Functions, never plaintext.
  refresh_token_ciphertext text not null,
  graph_subscription_id text unique,
  -- SHA-256 of the Graph subscription clientState; the webhook compares
  -- hashes so the raw value is only ever held by Microsoft and in memory.
  client_state_hash text,
  updated_at timestamptz not null default now()
);

create trigger smart_inbox_mailbox_secrets_set_updated_at
  before update on smart_inbox_mailbox_secrets
  for each row execute function set_updated_at();

-- ---------------------------------------------------------------------------
-- Messages and drafts
-- ---------------------------------------------------------------------------
create table smart_inbox_messages (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references properties(id) on delete cascade,
  mailbox_id uuid not null,
  graph_message_id text not null,
  conversation_id text,
  from_address text,
  from_name text,
  subject text,
  body_preview text,
  body_text text,
  received_at timestamptz not null default now(),
  language text,
  category text check (category in ('information', 'request', 'booking', 'complaint', 'other')),
  urgency text check (urgency in ('low', 'normal', 'high')),
  summary text,
  -- pending          collected, not yet read from Graph / sent to the AI
  -- processing       claimed by a worker
  -- draft_ready      a draft is waiting for a human
  -- needs_attention  no draft on purpose (complaint, sensitive, low
  --                  confidence) or a staff member reopened it
  -- ignored          filtered before the AI (OTA notification, no-reply,
  --                  newsletter, ignored sender)
  -- replied          sent from homisuite
  -- dismissed        a staff member decided no reply is needed
  -- failed           processing failed; `error` says why, retried later
  status text not null default 'pending' check (status in (
    'pending', 'processing', 'draft_ready', 'needs_attention',
    'ignored', 'replied', 'dismissed', 'failed'
  )),
  ignore_reason text,
  error text,
  attempts int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint smart_inbox_messages_mailbox_graph_id_key unique (mailbox_id, graph_message_id),
  constraint smart_inbox_messages_property_id_id_key unique (property_id, id),
  constraint smart_inbox_messages_mailbox_fkey foreign key (property_id, mailbox_id)
    references smart_inbox_mailboxes(property_id, id) on delete cascade
);

create index smart_inbox_messages_property_received_idx
  on smart_inbox_messages(property_id, received_at desc);
create index smart_inbox_messages_status_idx
  on smart_inbox_messages(status) where status in ('pending', 'failed', 'processing');

create trigger smart_inbox_messages_set_updated_at
  before update on smart_inbox_messages
  for each row execute function set_updated_at();

create table smart_inbox_drafts (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null,
  message_id uuid not null unique,
  -- What will be sent: starts as the AI text, staff may edit it.
  body text not null check (char_length(body) <= 20000),
  -- The AI's original text, kept for comparison and quality review.
  ai_body text not null,
  -- Operational follow-ups the AI noticed (transfer, restaurant booking,
  -- guest request...). Informational only in this version: nothing here
  -- writes into another module's tables (docs/module-integration.md).
  suggested_actions jsonb not null default '[]'::jsonb check (jsonb_typeof(suggested_actions) = 'array'),
  model text,
  status text not null default 'pending' check (status in ('pending', 'sent', 'discarded')),
  -- Id of the matching reply draft created in Outlook, when there is one.
  graph_draft_id text,
  edited_by uuid references profiles(id) on delete set null,
  sent_by uuid references profiles(id) on delete set null,
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint smart_inbox_drafts_message_fkey foreign key (property_id, message_id)
    references smart_inbox_messages(property_id, id) on delete cascade
);

create index smart_inbox_drafts_property_idx on smart_inbox_drafts(property_id);

create trigger smart_inbox_drafts_set_updated_at
  before update on smart_inbox_drafts
  for each row execute function set_updated_at();

-- Stamp who edited a draft from the client, so it can't be forged through
-- the Data API (the column itself isn't client-writable, see grants below).
create function smart_inbox_drafts_stamp_editor() returns trigger
language plpgsql security invoker set search_path = public as $$
begin
  if new.body is distinct from old.body and auth.uid() is not null then
    new.edited_by := auth.uid();
  end if;
  return new;
end;
$$;

create trigger smart_inbox_drafts_stamp_editor
  before update on smart_inbox_drafts
  for each row execute function smart_inbox_drafts_stamp_editor();

-- ---------------------------------------------------------------------------
-- AI usage accounting (one row per model call)
-- ---------------------------------------------------------------------------
create table smart_inbox_ai_usage (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references properties(id) on delete cascade,
  message_id uuid references smart_inbox_messages(id) on delete set null,
  model text not null,
  input_tokens int not null default 0,
  output_tokens int not null default 0,
  cache_read_input_tokens int not null default 0,
  cache_creation_input_tokens int not null default 0,
  created_at timestamptz not null default now()
);

create index smart_inbox_ai_usage_property_idx on smart_inbox_ai_usage(property_id, created_at desc);

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
alter table smart_inbox_settings enable row level security;
alter table smart_inbox_knowledge_entries enable row level security;
alter table smart_inbox_mailboxes enable row level security;
alter table smart_inbox_mailbox_secrets enable row level security;
alter table smart_inbox_messages enable row level security;
alter table smart_inbox_drafts enable row level security;
alter table smart_inbox_ai_usage enable row level security;

create policy smart_inbox_settings_select on smart_inbox_settings for select to authenticated
  using (has_permission(property_id, 'smart_inbox.view'));
create policy smart_inbox_settings_insert on smart_inbox_settings for insert to authenticated
  with check (has_permission(property_id, 'smart_inbox.manage'));
create policy smart_inbox_settings_update on smart_inbox_settings for update to authenticated
  using (has_permission(property_id, 'smart_inbox.manage'))
  with check (has_permission(property_id, 'smart_inbox.manage'));

create policy smart_inbox_knowledge_entries_select on smart_inbox_knowledge_entries for select to authenticated
  using (has_permission(property_id, 'smart_inbox.view'));
create policy smart_inbox_knowledge_entries_insert on smart_inbox_knowledge_entries for insert to authenticated
  with check (has_permission(property_id, 'smart_inbox.manage'));
create policy smart_inbox_knowledge_entries_update on smart_inbox_knowledge_entries for update to authenticated
  using (has_permission(property_id, 'smart_inbox.manage'))
  with check (has_permission(property_id, 'smart_inbox.manage'));
create policy smart_inbox_knowledge_entries_delete on smart_inbox_knowledge_entries for delete to authenticated
  using (has_permission(property_id, 'smart_inbox.manage'));

create policy smart_inbox_mailboxes_select on smart_inbox_mailboxes for select to authenticated
  using (has_permission(property_id, 'smart_inbox.view'));

-- smart_inbox_mailbox_secrets: intentionally no policy at all.

create policy smart_inbox_messages_select on smart_inbox_messages for select to authenticated
  using (has_permission(property_id, 'smart_inbox.view'));
-- Staff decide whether a message still needs work: dismiss it, or reopen a
-- dismissed/failed/ignored one for manual handling. Only the `status`
-- column is client-writable (grants below), and never into a state that
-- belongs to the pipeline (pending/processing/replied...).
create policy smart_inbox_messages_update on smart_inbox_messages for update to authenticated
  using (
    has_permission(property_id, 'smart_inbox.view')
    and status in ('draft_ready', 'needs_attention', 'dismissed', 'failed', 'ignored')
  )
  with check (
    has_permission(property_id, 'smart_inbox.view')
    and status in ('dismissed', 'needs_attention')
  );

create policy smart_inbox_drafts_select on smart_inbox_drafts for select to authenticated
  using (has_permission(property_id, 'smart_inbox.view'));
create policy smart_inbox_drafts_update on smart_inbox_drafts for update to authenticated
  using (has_permission(property_id, 'smart_inbox.view') and status = 'pending')
  with check (has_permission(property_id, 'smart_inbox.view') and status = 'pending');

create policy smart_inbox_ai_usage_select on smart_inbox_ai_usage for select to authenticated
  using (has_permission(property_id, 'smart_inbox.manage'));

-- ---------------------------------------------------------------------------
-- Grants — make the operation surface match the policies instead of
-- relying on policy absence alone as the denial mechanism.
-- ---------------------------------------------------------------------------
revoke all on table
  smart_inbox_settings, smart_inbox_knowledge_entries, smart_inbox_mailboxes,
  smart_inbox_mailbox_secrets, smart_inbox_messages, smart_inbox_drafts,
  smart_inbox_ai_usage
from public, anon, authenticated;

grant select on table
  smart_inbox_settings, smart_inbox_knowledge_entries, smart_inbox_mailboxes,
  smart_inbox_messages, smart_inbox_drafts, smart_inbox_ai_usage
to authenticated;

grant insert (property_id, reply_signature, tone, auto_draft, ignored_senders)
  on table smart_inbox_settings to authenticated;
grant update (reply_signature, tone, auto_draft, ignored_senders)
  on table smart_inbox_settings to authenticated;

grant insert (property_id, title, content, active, sort_order)
  on table smart_inbox_knowledge_entries to authenticated;
grant update (title, content, active, sort_order)
  on table smart_inbox_knowledge_entries to authenticated;
grant delete on table smart_inbox_knowledge_entries to authenticated;

grant update (status) on table smart_inbox_messages to authenticated;
grant update (body) on table smart_inbox_drafts to authenticated;

revoke all on function smart_inbox_drafts_stamp_editor() from public, anon, authenticated;
revoke all on function smart_inbox_settings_stamp_updater() from public, anon, authenticated;

comment on table smart_inbox_mailbox_secrets is
  'Service-role only: encrypted Microsoft refresh token and Graph subscription state for a Smart Inbox mailbox. No client policy or grant, ever.';
comment on table smart_inbox_drafts is
  'AI-generated reply drafts. Staff may edit body while pending; sending happens only through the smart-inbox-send Edge Function.';
comment on column smart_inbox_drafts.suggested_actions is
  'Follow-ups the AI noticed (transfer, dining, guest request). Informational: Smart Inbox never writes into another module''s tables.';

commit;
