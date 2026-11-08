begin;
create extension if not exists pgtap;
select plan(16);

-- Fixtures: property A (Smart Inbox on) with a receptionist and a manager;
-- property C in the same org without the module.
insert into organizations (id, name, slug) values
  ('00000090-0000-0000-0000-000000000001', 'Compose Org', 'test-090-org');

insert into properties (id, organization_id, name, slug) values
  ('00000090-0000-0000-0000-000000000011', '00000090-0000-0000-0000-000000000001', 'Hotel Laguna', 'compose-a'),
  ('00000090-0000-0000-0000-000000000013', '00000090-0000-0000-0000-000000000001', 'Hotel Senza', 'compose-c');

insert into property_modules (property_id, module_id, enabled)
select '00000090-0000-0000-0000-000000000011', id, true from modules where slug = 'smart_inbox';

insert into auth.users (id, email) values
  ('00000090-0000-0000-0000-000000000041', 'reception-090@example.com'),
  ('00000090-0000-0000-0000-000000000042', 'manager-090@example.com'),
  ('00000090-0000-0000-0000-000000000044', 'manager-c-090@example.com');

insert into profiles (id, full_name) values
  ('00000090-0000-0000-0000-000000000041', 'Luca Ferri'),
  ('00000090-0000-0000-0000-000000000042', 'Giulia Bianchi'),
  ('00000090-0000-0000-0000-000000000044', 'Manager C');

insert into memberships (profile_id, property_id, organization_id, role_id, status)
select fixture.profile_id, fixture.property_id, null, role.id, 'active'
from (values
  ('00000090-0000-0000-0000-000000000041'::uuid, '00000090-0000-0000-0000-000000000011'::uuid, 'receptionist'),
  ('00000090-0000-0000-0000-000000000042'::uuid, '00000090-0000-0000-0000-000000000011'::uuid, 'manager'),
  ('00000090-0000-0000-0000-000000000044'::uuid, '00000090-0000-0000-0000-000000000013'::uuid, 'manager')
) as fixture(profile_id, property_id, role_slug)
join roles role on role.slug = fixture.role_slug;

insert into property_job_titles (id, property_id, name) values
  ('00000090-0000-0000-0000-000000000061', '00000090-0000-0000-0000-000000000011', 'Receptionist');
insert into property_staff_details (property_id, profile_id, job_title_id) values
  ('00000090-0000-0000-0000-000000000011', '00000090-0000-0000-0000-000000000041', '00000090-0000-0000-0000-000000000061');

insert into smart_inbox_conversations (id, property_id, guest_address, guest_name) values
  ('00000090-0000-0000-0000-000000000091', '00000090-0000-0000-0000-000000000011', 'booking:lukas weber', 'Lukas Weber');

insert into smart_inbox_templates (id, property_id, title, body) values
  ('00000090-0000-0000-0000-0000000000a1', '00000090-0000-0000-0000-000000000011', 'Check-in tardivo', 'Gentile {nome}, nessun problema.');

-- ---------------------------------------------------------------------------
-- Pasted messages
-- ---------------------------------------------------------------------------
select lives_ok(
  $$insert into smart_inbox_messages (id, property_id, thread_id, source, from_name, body_text, status)
    values ('00000090-0000-0000-0000-000000000071', '00000090-0000-0000-0000-000000000011',
            '00000090-0000-0000-0000-000000000091', 'booking', 'Lukas Weber', 'Hallo…', 'draft_ready')$$,
  'a message pasted from Booking.com needs no mailbox'
);
select throws_ok(
  $$insert into smart_inbox_messages (property_id, source, body_text) values ('00000090-0000-0000-0000-000000000011', 'outlook', 'x')$$,
  '23514', null,
  'an Outlook message must still come from a mailbox'
);
select throws_ok(
  $$insert into smart_inbox_messages (property_id, source, body_text) values ('00000090-0000-0000-0000-000000000011', 'telegram', 'x')$$,
  '23514', null,
  'only known channels are accepted'
);
select throws_ok(
  $$insert into smart_inbox_settings (property_id, enabled_sources) values ('00000090-0000-0000-0000-000000000011', '{booking,telegram}')$$,
  '23514', null,
  'settings accept only known channels'
);

-- ---------------------------------------------------------------------------
-- Privilege surface
-- ---------------------------------------------------------------------------
select ok(
  has_column_privilege('authenticated', 'public.smart_inbox_templates', 'when_to_use', 'update')
  and has_column_privilege('authenticated', 'public.smart_inbox_templates', 'translations', 'insert')
  and has_column_privilege('authenticated', 'public.smart_inbox_knowledge_entries', 'assistant_note', 'update')
  and has_column_privilege('authenticated', 'public.smart_inbox_settings', 'signature_template', 'update'),
  'the new template, information and signature fields are editable through RLS'
);
select ok(
  not has_column_privilege('authenticated', 'public.smart_inbox_messages', 'guest_details', 'update')
  and not has_column_privilege('authenticated', 'public.smart_inbox_messages', 'source', 'update')
  and not has_column_privilege('authenticated', 'public.smart_inbox_drafts', 'translation', 'update')
  and not has_column_privilege('authenticated', 'public.smart_inbox_drafts', 'signed_as', 'update'),
  'AI output and channel are written only by the Edge Functions'
);
select ok(
  not has_table_privilege('authenticated', 'public.smart_inbox_messages', 'insert'),
  'staff cannot insert messages directly: pasting goes through the Edge Function'
);

-- ---------------------------------------------------------------------------
-- Receptionist
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claim.sub = '00000090-0000-0000-0000-000000000041';

select is(
  (select source from smart_inbox_messages where id = '00000090-0000-0000-0000-000000000071'),
  'booking',
  'agents see pasted messages with their channel'
);
select is(
  (select row(full_name, job_title)::text from smart_inbox_signature_identity('00000090-0000-0000-0000-000000000011')),
  row('Luca Ferri', 'Receptionist')::text,
  'the signature identity is the agent name and their job title in Team'
);
update smart_inbox_templates set when_to_use = 'sempre' where id = '00000090-0000-0000-0000-0000000000a1';
reset role;
select is(
  (select when_to_use from smart_inbox_templates where id = '00000090-0000-0000-0000-0000000000a1'),
  '',
  'a receptionist cannot change a template'
);

-- ---------------------------------------------------------------------------
-- Manager
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claim.sub = '00000090-0000-0000-0000-000000000042';

select lives_ok(
  $$update smart_inbox_templates
    set when_to_use = 'Arrivo dopo le 22', category = 'prima_arrivo', translations = '{"de": "Lieber {nome}, kein Problem."}'
    where id = '00000090-0000-0000-0000-0000000000a1'$$,
  'a manager can set when to use a template, its category and translations'
);
select is(
  (select translations->>'de' from smart_inbox_templates where id = '00000090-0000-0000-0000-0000000000a1'),
  'Lieber {nome}, kein Problem.',
  'template translations are stored per language'
);
select lives_ok(
  $$insert into smart_inbox_knowledge_entries (property_id, title, content, category, assistant_note)
    values ('00000090-0000-0000-0000-000000000011', 'Parcheggio', '200 m, 25 euro', 'servizi', 'Altezza max 2,10 m')$$,
  'a manager can add information with a category and a note for the assistant'
);
select lives_ok(
  $$insert into smart_inbox_settings (property_id, signature_template, allow_property_signature, enabled_sources)
    values ('00000090-0000-0000-0000-000000000011', E'Saluti,\n{agent}\n{ruolo}', false, '{booking,whatsapp}')$$,
  'a manager can set the signature template and the channels'
);
select is(
  (select row(full_name, job_title)::text from smart_inbox_signature_identity('00000090-0000-0000-0000-000000000011')),
  row('Giulia Bianchi', null::text)::text,
  'an agent without a job title still gets their name'
);

-- ---------------------------------------------------------------------------
-- Manager of a property without the module
-- ---------------------------------------------------------------------------
set local request.jwt.claim.sub = '00000090-0000-0000-0000-000000000044';
select is(
  (select count(*)::int from smart_inbox_signature_identity('00000090-0000-0000-0000-000000000011')),
  0,
  'no signature identity outside a property where you are an agent'
);
reset role;

select * from finish();
rollback;
