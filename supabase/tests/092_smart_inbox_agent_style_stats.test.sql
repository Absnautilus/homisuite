begin;
create extension if not exists pgtap;
select plan(12);

insert into organizations (id, name, slug) values
  ('00000092-0000-0000-0000-000000000001', 'Stats Org', 'test-092-org');
insert into properties (id, organization_id, name, slug) values
  ('00000092-0000-0000-0000-000000000011', '00000092-0000-0000-0000-000000000001', 'Hotel Numeri', 'stats-a');
insert into property_modules (property_id, module_id, enabled)
select '00000092-0000-0000-0000-000000000011', id, true from modules where slug = 'smart_inbox';

insert into auth.users (id, email) values
  ('00000092-0000-0000-0000-000000000041', 'reception-092@example.com'),
  ('00000092-0000-0000-0000-000000000042', 'manager-092@example.com'),
  ('00000092-0000-0000-0000-000000000043', 'reception2-092@example.com');
insert into profiles (id, full_name) values
  ('00000092-0000-0000-0000-000000000041', 'Luca'),
  ('00000092-0000-0000-0000-000000000042', 'Giulia'),
  ('00000092-0000-0000-0000-000000000043', 'Anna');
insert into memberships (profile_id, property_id, organization_id, role_id, status)
select fixture.profile_id, '00000092-0000-0000-0000-000000000011', null, role.id, 'active'
from (values
  ('00000092-0000-0000-0000-000000000041'::uuid, 'receptionist'),
  ('00000092-0000-0000-0000-000000000042'::uuid, 'manager'),
  ('00000092-0000-0000-0000-000000000043'::uuid, 'receptionist')
) as fixture(profile_id, role_slug)
join roles role on role.slug = fixture.role_slug;

-- Three pasted messages today: two answered (one by Luca as drafted, one by
-- Anna after editing), one still open; plus a filtered one.
insert into smart_inbox_messages (id, property_id, source, body_text, status, received_at) values
  ('00000092-0000-0000-0000-000000000071', '00000092-0000-0000-0000-000000000011', 'booking', 'a', 'replied', now() - interval '2 hours'),
  ('00000092-0000-0000-0000-000000000072', '00000092-0000-0000-0000-000000000011', 'whatsapp', 'b', 'replied', now() - interval '3 hours'),
  ('00000092-0000-0000-0000-000000000073', '00000092-0000-0000-0000-000000000011', 'booking', 'c', 'draft_ready', now() - interval '1 hour'),
  ('00000092-0000-0000-0000-000000000074', '00000092-0000-0000-0000-000000000011', 'other', 'd', 'ignored', now() - interval '1 hour');
insert into smart_inbox_drafts (property_id, message_id, body, ai_body, status, sent_by, sent_at) values
  ('00000092-0000-0000-0000-000000000011', '00000092-0000-0000-0000-000000000071', E'Ciao,\nLuca', 'Ciao,', 'sent', '00000092-0000-0000-0000-000000000041', now() - interval '1 hour'),
  ('00000092-0000-0000-0000-000000000011', '00000092-0000-0000-0000-000000000072', E'Hello there,\nAnna', 'Hi,', 'sent', '00000092-0000-0000-0000-000000000043', now() - interval '2 hours'),
  ('00000092-0000-0000-0000-000000000011', '00000092-0000-0000-0000-000000000073', 'x', 'x', 'pending', null, null);

-- ---------------------------------------------------------------------------
-- Preferences
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claim.sub = '00000092-0000-0000-0000-000000000041';

select lives_ok(
  $$insert into smart_inbox_agent_preferences (property_id, profile_id, tone, instructions, languages)
    values ('00000092-0000-0000-0000-000000000011', '00000092-0000-0000-0000-000000000041', 'formale', 'Do sempre del lei.', '{it,en,de}')$$,
  'an agent saves their own style and languages'
);
select throws_ok(
  $$insert into smart_inbox_agent_preferences (property_id, profile_id, tone)
    values ('00000092-0000-0000-0000-000000000011', '00000092-0000-0000-0000-000000000043', 'essenziale')$$,
  '42501', null,
  'an agent cannot write a colleague''s preferences'
);
select throws_ok(
  $$update smart_inbox_agent_preferences set languages = '{klingon}'
    where profile_id = '00000092-0000-0000-0000-000000000041'$$,
  '23514', null,
  'only known language codes are stored'
);

set local request.jwt.claim.sub = '00000092-0000-0000-0000-000000000043';
select is(
  (select count(*)::int from smart_inbox_agent_preferences),
  0,
  'an agent does not see a colleague''s preferences'
);

-- ---------------------------------------------------------------------------
-- Statistics
-- ---------------------------------------------------------------------------
select is((smart_inbox_stats('00000092-0000-0000-0000-000000000011', 7)->>'received')::int, 3, 'filtered messages are not counted as received');
select is((smart_inbox_stats('00000092-0000-0000-0000-000000000011', 7)->>'replied')::int, 2, 'replies sent in the period');
select is((smart_inbox_stats('00000092-0000-0000-0000-000000000011', 7)->>'unchanged')::int, 1, 'a reply sent as drafted plus signature counts as unchanged');
select is((smart_inbox_stats('00000092-0000-0000-0000-000000000011', 7)->>'open_now')::int, 1, 'messages still to answer');
select is(jsonb_array_length(smart_inbox_stats('00000092-0000-0000-0000-000000000011', 7)->'by_day'), 7, 'one row per day of the period');
select is(
  (select array_agg(value->>'full_name') from jsonb_array_elements(smart_inbox_stats('00000092-0000-0000-0000-000000000011', 7)->'by_agent')),
  array['Anna'],
  'an agent sees only their own figures per agent'
);

set local request.jwt.claim.sub = '00000092-0000-0000-0000-000000000042';
select is(
  (select array_agg(value->>'full_name' order by value->>'full_name') from jsonb_array_elements(smart_inbox_stats('00000092-0000-0000-0000-000000000011', 30)->'by_agent')),
  array['Anna', 'Luca'],
  'a manager sees every agent'
);
reset role;

set local role anon;
select throws_ok(
  $$select smart_inbox_stats('00000092-0000-0000-0000-000000000011', 7)$$,
  '42501', null,
  'statistics are not available to anonymous callers'
);
reset role;

select * from finish();
rollback;
