begin;
create extension if not exists pgtap;
select plan(4);

-- Property with Smart Inbox on; a manager and two receptionists, one of
-- whom has Smart Inbox switched off in Team.
insert into organizations (id, name, slug) values
  ('00000091-0000-0000-0000-000000000001', 'Agents Org', 'test-091-org');
insert into properties (id, organization_id, name, slug) values
  ('00000091-0000-0000-0000-000000000011', '00000091-0000-0000-0000-000000000001', 'Hotel Agenti', 'agents-a');
insert into property_modules (property_id, module_id, enabled)
select '00000091-0000-0000-0000-000000000011', id, true from modules where slug = 'smart_inbox';

insert into auth.users (id, email) values
  ('00000091-0000-0000-0000-000000000041', 'manager-091@example.com'),
  ('00000091-0000-0000-0000-000000000042', 'reception-on-091@example.com'),
  ('00000091-0000-0000-0000-000000000043', 'reception-off-091@example.com');
insert into profiles (id, full_name) values
  ('00000091-0000-0000-0000-000000000041', 'Manager'),
  ('00000091-0000-0000-0000-000000000042', 'Reception On'),
  ('00000091-0000-0000-0000-000000000043', 'Reception Off');

insert into memberships (id, profile_id, property_id, organization_id, role_id, status)
select fixture.id, fixture.profile_id, '00000091-0000-0000-0000-000000000011', null, role.id, 'active'
from (values
  ('00000091-0000-0000-0000-000000000051'::uuid, '00000091-0000-0000-0000-000000000041'::uuid, 'manager'),
  ('00000091-0000-0000-0000-000000000052'::uuid, '00000091-0000-0000-0000-000000000042'::uuid, 'receptionist'),
  ('00000091-0000-0000-0000-000000000053'::uuid, '00000091-0000-0000-0000-000000000043'::uuid, 'receptionist')
) as fixture(id, profile_id, role_slug)
join roles role on role.slug = fixture.role_slug;

insert into membership_module_access (membership_id, module_id, enabled)
select '00000091-0000-0000-0000-000000000053', id, false from modules where slug = 'smart_inbox';

insert into smart_inbox_conversations (id, property_id, guest_address, guest_name) values
  ('00000091-0000-0000-0000-000000000091', '00000091-0000-0000-0000-000000000011', 'guest@example.com', 'Guest');

set local role authenticated;
set local request.jwt.claim.sub = '00000091-0000-0000-0000-000000000041';

select ok(
  smart_inbox_is_agent('00000091-0000-0000-0000-000000000011', '00000091-0000-0000-0000-000000000042'),
  'a receptionist is an agent'
);
select ok(
  not smart_inbox_is_agent('00000091-0000-0000-0000-000000000011', '00000091-0000-0000-0000-000000000043'),
  'a receptionist with Smart Inbox switched off in Team is not an agent'
);
select is(
  (select array_agg(full_name order by full_name) from smart_inbox_agents('00000091-0000-0000-0000-000000000011')),
  array['Manager', 'Reception On'],
  'the agent picker leaves out members whose access is switched off'
);
select throws_ok(
  $$update smart_inbox_conversations set assigned_to = '00000091-0000-0000-0000-000000000043'
    where id = '00000091-0000-0000-0000-000000000091'$$,
  '42501', null,
  'a guest cannot be assigned to someone whose Smart Inbox access is off'
);

reset role;
select * from finish();
rollback;
