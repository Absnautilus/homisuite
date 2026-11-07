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
--     text, dismiss/reopen a message, assign the guest conversation to an
--     agent);
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
-- Reply templates the staff insert with one click ({nome} becomes the
-- guest's first name). The AI also sees them as approved wording.
create table smart_inbox_templates (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references properties(id) on delete cascade,
  title text not null check (char_length(btrim(title)) between 1 and 120),
  body text not null check (char_length(btrim(body)) between 1 and 8000),
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index smart_inbox_templates_property_idx on smart_inbox_templates(property_id, sort_order);

create trigger smart_inbox_templates_set_updated_at
  before update on smart_inbox_templates
  for each row execute function set_updated_at();

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
-- Conversations: one per guest (sender address) per property, and the
-- staff member ("agent") currently looking after it
-- ---------------------------------------------------------------------------
create table smart_inbox_conversations (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references properties(id) on delete cascade,
  -- Lower-cased sender address; every email from it lands here.
  guest_address text not null check (guest_address = lower(btrim(guest_address)) and guest_address <> ''),
  guest_name text,
  -- The agent handling this guest. Any agent may take a conversation or
  -- hand it to a colleague; the assignee must themselves hold
  -- smart_inbox.view on the property (smart_inbox_is_agent below).
  assigned_to uuid references profiles(id) on delete set null,
  assigned_by uuid references profiles(id) on delete set null,
  assigned_at timestamptz,
  -- Staff-facing triage, all editable by any agent:
  --   is_urgent   set by the AI on an urgent email, cleared when the hotel
  --               replies; staff can flip it either way.
  --   stay_month  the month of the guest's stay (first day of that month),
  --               filled by the AI when the email mentions dates.
  --   notes       what colleagues should know about this guest (VIP,
  --               allergies, preferences); also given to the AI.
  is_urgent boolean not null default false,
  stay_month date check (stay_month is null or extract(day from stay_month) = 1),
  notes text not null default '' check (char_length(notes) <= 4000),
  last_message_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint smart_inbox_conversations_guest_key unique (property_id, guest_address),
  constraint smart_inbox_conversations_property_id_id_key unique (property_id, id)
);

create index smart_inbox_conversations_property_idx
  on smart_inbox_conversations(property_id, last_message_at desc);
create index smart_inbox_conversations_assignee_idx
  on smart_inbox_conversations(assigned_to) where assigned_to is not null;

create trigger smart_inbox_conversations_set_updated_at
  before update on smart_inbox_conversations
  for each row execute function set_updated_at();

-- Who assigned and when are stamped server-side whenever the assignee
-- changes, never taken from the client.
create function smart_inbox_conversations_stamp_assignment() returns trigger
language plpgsql security invoker set search_path = public as $$
begin
  if new.assigned_to is distinct from old.assigned_to then
    -- coalesce: the Edge Functions (no auth.uid()) pass assigned_by
    -- explicitly when they auto-assign on send.
    new.assigned_by := coalesce(auth.uid(), new.assigned_by);
    new.assigned_at := case when new.assigned_to is null then null else now() end;
  end if;
  return new;
end;
$$;

create trigger smart_inbox_conversations_stamp_assignment
  before update on smart_inbox_conversations
  for each row execute function smart_inbox_conversations_stamp_assignment();

-- Is `p_profile_id` an agent of this property, i.e. would has_permission(
-- p_property_id, 'smart_inbox.view') be true for them? Same rule as
-- has_permission() (role grant or per-membership grant, direct or
-- org-wide membership, module enabled), evaluated for another profile.
-- Answers only to callers who are agents of that property themselves, so
-- it can't be used to probe other properties' staff.
create function smart_inbox_is_agent(p_property_id uuid, p_profile_id uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select has_permission(p_property_id, 'smart_inbox.view') and exists (
    select 1
    from memberships m
    join permissions perm on perm.slug = 'smart_inbox.view'
    join properties p on p.id = p_property_id
    where m.profile_id = p_profile_id
      and m.status = 'active'
      and (m.property_id = p_property_id or m.organization_id = p.organization_id)
      and exists (
        select 1 from property_modules pm
        where pm.property_id = p_property_id and pm.module_id = perm.module_id and pm.enabled
      )
      and (
        exists (select 1 from role_permissions rp where rp.role_id = m.role_id and rp.permission_id = perm.id)
        or exists (select 1 from membership_permission_grants g where g.membership_id = m.id and g.permission_id = perm.id)
      )
  );
$$;

-- The people a conversation can be assigned to, for the assignee picker.
create function smart_inbox_agents(p_property_id uuid) returns table (profile_id uuid, full_name text)
language sql stable security definer set search_path = public as $$
  select distinct pr.id, pr.full_name
  from memberships m
  join properties p on p.id = p_property_id
  join profiles pr on pr.id = m.profile_id
  where m.status = 'active'
    and (m.property_id = p_property_id or m.organization_id = p.organization_id)
    and smart_inbox_is_agent(p_property_id, pr.id)
  order by pr.full_name;
$$;

-- ---------------------------------------------------------------------------
-- Messages and drafts
-- ---------------------------------------------------------------------------
create table smart_inbox_messages (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references properties(id) on delete cascade,
  mailbox_id uuid not null,
  -- The guest conversation; set once the sender is known (after the
  -- message has been read from Graph).
  thread_id uuid,
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
    references smart_inbox_mailboxes(property_id, id) on delete cascade,
  constraint smart_inbox_messages_thread_fkey foreign key (property_id, thread_id)
    references smart_inbox_conversations(property_id, id)
);

create index smart_inbox_messages_thread_idx
  on smart_inbox_messages(thread_id, received_at);
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
alter table smart_inbox_templates enable row level security;
alter table smart_inbox_mailboxes enable row level security;
alter table smart_inbox_mailbox_secrets enable row level security;
alter table smart_inbox_conversations enable row level security;
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

create policy smart_inbox_templates_select on smart_inbox_templates for select to authenticated
  using (has_permission(property_id, 'smart_inbox.view'));
create policy smart_inbox_templates_insert on smart_inbox_templates for insert to authenticated
  with check (has_permission(property_id, 'smart_inbox.manage'));
create policy smart_inbox_templates_update on smart_inbox_templates for update to authenticated
  using (has_permission(property_id, 'smart_inbox.manage'))
  with check (has_permission(property_id, 'smart_inbox.manage'));
create policy smart_inbox_templates_delete on smart_inbox_templates for delete to authenticated
  using (has_permission(property_id, 'smart_inbox.manage'));

create policy smart_inbox_mailboxes_select on smart_inbox_mailboxes for select to authenticated
  using (has_permission(property_id, 'smart_inbox.view'));

-- smart_inbox_mailbox_secrets: intentionally no policy at all.

create policy smart_inbox_conversations_select on smart_inbox_conversations for select to authenticated
  using (has_permission(property_id, 'smart_inbox.view'));
-- Taking a conversation, handing it to a colleague or releasing it, and
-- triage (urgent, stay month, notes). Only those columns are
-- client-writable; an assignee must be another agent of the same property
-- (or nobody).
create policy smart_inbox_conversations_update on smart_inbox_conversations for update to authenticated
  using (has_permission(property_id, 'smart_inbox.view'))
  with check (
    has_permission(property_id, 'smart_inbox.view')
    and (assigned_to is null or smart_inbox_is_agent(property_id, assigned_to))
  );

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
  smart_inbox_settings, smart_inbox_knowledge_entries, smart_inbox_templates,
  smart_inbox_mailboxes, smart_inbox_mailbox_secrets, smart_inbox_conversations, smart_inbox_messages,
  smart_inbox_drafts, smart_inbox_ai_usage
from public, anon, authenticated;

grant select on table
  smart_inbox_settings, smart_inbox_knowledge_entries, smart_inbox_templates, smart_inbox_mailboxes,
  smart_inbox_conversations, smart_inbox_messages, smart_inbox_drafts,
  smart_inbox_ai_usage
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

grant insert (property_id, title, body, sort_order) on table smart_inbox_templates to authenticated;
grant update (title, body, sort_order) on table smart_inbox_templates to authenticated;
grant delete on table smart_inbox_templates to authenticated;

grant update (assigned_to, is_urgent, stay_month, notes) on table smart_inbox_conversations to authenticated;
grant update (status) on table smart_inbox_messages to authenticated;
grant update (body) on table smart_inbox_drafts to authenticated;

revoke all on function smart_inbox_drafts_stamp_editor() from public, anon, authenticated;
revoke all on function smart_inbox_settings_stamp_updater() from public, anon, authenticated;
revoke all on function smart_inbox_conversations_stamp_assignment() from public, anon, authenticated;
revoke all on function smart_inbox_is_agent(uuid, uuid) from public, anon;
revoke all on function smart_inbox_agents(uuid) from public, anon;
grant execute on function smart_inbox_is_agent(uuid, uuid) to authenticated;
grant execute on function smart_inbox_agents(uuid) to authenticated;

comment on table smart_inbox_mailbox_secrets is
  'Service-role only: encrypted Microsoft refresh token and Graph subscription state for a Smart Inbox mailbox. No client policy or grant, ever.';
comment on table smart_inbox_conversations is
  'One conversation per guest sender per property, with the staff agent assigned to it. Staff may change the assignee (to another agent of the same property), urgency, stay month and notes.';
comment on table smart_inbox_drafts is
  'AI-generated reply drafts. Staff may edit body while pending; sending happens only through the smart-inbox-actions Edge Function.';
comment on column smart_inbox_drafts.suggested_actions is
  'Follow-ups the AI noticed (transfer, dining, guest request). Informational: Smart Inbox never writes into another module''s tables.';

commit;
