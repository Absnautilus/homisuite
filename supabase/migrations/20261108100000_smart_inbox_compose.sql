-- Smart Inbox — "Componi risposta" for messages from channels that are not
-- connected (Booking.com/Expedia/Airbnb extranets, WhatsApp, phone), richer
-- templates and hotel information, and replies signed by the agent.
--
-- * Pasted messages live in smart_inbox_messages like Outlook ones, with a
--   `source` and no mailbox/Graph id; they join the same guest
--   conversations, history and agent assignment.
-- * The AI now also returns what it read from the guest (dates, guests,
--   booking reference, requests), which templates and information it used,
--   what was missing, and an Italian translation for staff; that is kept on
--   the message/draft so the screen can show it and nothing is recomputed.
-- * Templates gain a category, a "when to use" hint the AI reads to pick
--   them, and per-language versions; information entries gain a category
--   and a note meant only for the assistant.
-- * Replies are signed by the agent who sends them: the signature is a
--   per-property template ({agent}, {ruolo}, {hotel}) rendered with the
--   sender's own name and job title from Team. The AI writes the body and
--   the closing formula in the guest's language ("Mit freundlichen
--   Grüßen,"); the name block is appended, never written by the AI.

begin;

-- ---------------------------------------------------------------------------
-- Messages from any channel
-- ---------------------------------------------------------------------------
alter table smart_inbox_messages
  alter column mailbox_id drop not null,
  alter column graph_message_id drop not null,
  add column source text not null default 'outlook'
    check (source in ('outlook', 'booking', 'expedia', 'airbnb', 'whatsapp', 'phone', 'other')),
  add column created_by uuid references profiles(id) on delete set null,
  -- What the AI read from the guest's own words. Shape (all optional):
  -- {arrival_date, arrival_time, departure_date, guests, booking_reference,
  --  requests: string[]}
  add column guest_details jsonb not null default '{}'::jsonb check (jsonb_typeof(guest_details) = 'object'),
  -- Topics the guest asked about that the hotel information does not cover
  -- (feeds "Gli ospiti hanno chiesto, ma qui non c'è la risposta").
  add column missing_info text[] not null default '{}',
  -- When no template fitted, the topic of the reply (feeds the "make this a
  -- template" suggestion).
  add column template_gap text,
  add constraint smart_inbox_messages_outlook_has_mailbox check (
    source <> 'outlook' or (mailbox_id is not null and graph_message_id is not null)
  );

create index smart_inbox_messages_property_created_idx
  on smart_inbox_messages(property_id, created_at desc);

alter table smart_inbox_drafts
  add column templates_used text[] not null default '{}',
  add column info_used text[] not null default '{}',
  -- Guest data the reply needed but the message did not contain.
  add column missing_fields text[] not null default '{}',
  -- Italian rendering of the reply, for staff who don't read the guest's
  -- language. Null when the reply already is in Italian.
  add column translation text,
  add column signed_as text check (signed_as in ('agent', 'property'));

-- ---------------------------------------------------------------------------
-- Templates and information
-- ---------------------------------------------------------------------------
alter table smart_inbox_templates
  add column category text not null default 'altro'
    check (category in ('prima_arrivo', 'prenotazioni', 'soggiorno', 'dopo', 'altro')),
  add column when_to_use text not null default '' check (char_length(when_to_use) <= 500),
  -- {"en": "...", "de": "..."}: hand-written versions in other languages.
  -- When the guest's language has none, the AI translates the base text.
  add column translations jsonb not null default '{}'::jsonb check (jsonb_typeof(translations) = 'object');

alter table smart_inbox_knowledge_entries
  add column category text not null default 'servizi'
    check (category in ('arrivo_partenza', 'servizi', 'regole_prezzi', 'altro')),
  add column assistant_note text not null default '' check (char_length(assistant_note) <= 2000);

-- ---------------------------------------------------------------------------
-- Settings: agent signature, channels, translation
-- ---------------------------------------------------------------------------
alter table smart_inbox_settings
  add column signature_template text not null default E'{agent}\n{ruolo} — {hotel}'
    check (char_length(signature_template) <= 1000),
  -- reply_signature (existing) is the signature used when replying on
  -- behalf of the property, without a person's name ({hotel} allowed).
  add column allow_property_signature boolean not null default true,
  add column show_translation boolean not null default true,
  add column enabled_sources text[] not null default '{booking,expedia,airbnb,whatsapp,phone,other}'
    check (enabled_sources <@ array['booking', 'expedia', 'airbnb', 'whatsapp', 'phone', 'other']);

alter table smart_inbox_settings alter column reply_signature set default E'Front Office — {hotel}';

-- ---------------------------------------------------------------------------
-- Who am I, for my signature: name from the profile, role from Team.
-- ---------------------------------------------------------------------------
create function smart_inbox_signature_identity(p_property_id uuid)
returns table (full_name text, job_title text)
language sql stable security definer set search_path = public as $$
  select pr.full_name, jt.name
  from profiles pr
  left join property_staff_details psd on psd.profile_id = pr.id and psd.property_id = p_property_id
  left join property_job_titles jt on jt.id = psd.job_title_id
  where pr.id = auth.uid()
    and has_permission(p_property_id, 'smart_inbox.view');
$$;

revoke all on function smart_inbox_signature_identity(uuid) from public, anon;
grant execute on function smart_inbox_signature_identity(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Grants for the new client-editable columns
-- ---------------------------------------------------------------------------
grant insert (category, when_to_use, translations) on table smart_inbox_templates to authenticated;
grant update (category, when_to_use, translations) on table smart_inbox_templates to authenticated;

grant insert (category, assistant_note) on table smart_inbox_knowledge_entries to authenticated;
grant update (category, assistant_note) on table smart_inbox_knowledge_entries to authenticated;

grant insert (signature_template, allow_property_signature, show_translation, enabled_sources)
  on table smart_inbox_settings to authenticated;
grant update (signature_template, allow_property_signature, show_translation, enabled_sources)
  on table smart_inbox_settings to authenticated;

comment on column smart_inbox_messages.source is
  'outlook = arrived through the connected mailbox; anything else = pasted by staff in "Componi risposta" from that channel.';
comment on column smart_inbox_settings.signature_template is
  'Signature every reply ends with, rendered per sender: {agent} = their name, {ruolo} = their job title in Team, {hotel} = property name.';

commit;
