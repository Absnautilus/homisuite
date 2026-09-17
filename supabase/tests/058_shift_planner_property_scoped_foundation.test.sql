begin;
create extension if not exists pgtap;
select plan(37);

-- Every module table is explicitly property scoped.
select has_column('public', 'shift_staff_profiles', 'property_id', 'shift staff profiles are property scoped');
select has_column('public', 'shifts', 'property_id', 'shifts are property scoped');
select has_column('public', 'shift_swap_requests', 'property_id', 'swap requests are property scoped');
select has_column('public', 'shift_absence_requests', 'property_id', 'absence requests are property scoped');
select has_column('public', 'shift_preassignment_requests', 'property_id', 'preassignment requests are property scoped');
select has_column('public', 'shift_month_states', 'property_id', 'month states are property scoped');
select has_column('public', 'shift_settings', 'property_id', 'settings are property scoped');
select has_column('public', 'shift_preferences', 'property_id', 'preferences are property scoped');
select has_column('public', 'shift_read_notifications', 'property_id', 'read notifications are property scoped');
select has_column('public', 'shift_push_subscriptions', 'property_id', 'push subscriptions are property scoped');

select is(
  (select count(*)::int from permissions where slug in ('shifts.view', 'shifts.manage', 'shifts.requests.manage')),
  3,
  'the module owns exactly the three required permissions'
);

insert into organizations (id, name, slug) values
  ('00000058-0000-0000-0000-000000000001', 'Shift Org A', 'test-058-shift-org-a'),
  ('00000058-0000-0000-0000-000000000002', 'Shift Org B', 'test-058-shift-org-b');
insert into properties (id, organization_id, name, slug) values
  ('00000058-0000-0000-0000-000000000011', '00000058-0000-0000-0000-000000000001', 'Shift Property A1', 'shift-058-a1'),
  ('00000058-0000-0000-0000-000000000012', '00000058-0000-0000-0000-000000000001', 'Shift Property A2', 'shift-058-a2'),
  ('00000058-0000-0000-0000-000000000013', '00000058-0000-0000-0000-000000000002', 'Shift Property B1', 'shift-058-b1');

insert into auth.users (id) values
  ('00000058-0000-0000-0000-000000000041'),
  ('00000058-0000-0000-0000-000000000042'),
  ('00000058-0000-0000-0000-000000000043'),
  ('00000058-0000-0000-0000-000000000044'),
  ('00000058-0000-0000-0000-000000000045');
insert into profiles (id, full_name) values
  ('00000058-0000-0000-0000-000000000041', 'Shift Manager A1'),
  ('00000058-0000-0000-0000-000000000042', 'Shift Viewer A1'),
  ('00000058-0000-0000-0000-000000000043', 'Shift Peer A1'),
  ('00000058-0000-0000-0000-000000000044', 'Shift Manager B1'),
  ('00000058-0000-0000-0000-000000000045', 'Shift Manager A2');

insert into memberships (profile_id, property_id, role_id, status)
select v.profile_id, v.property_id, r.id, 'active'
from (values
  ('00000058-0000-0000-0000-000000000041'::uuid, '00000058-0000-0000-0000-000000000011'::uuid, 'manager'),
  ('00000058-0000-0000-0000-000000000042'::uuid, '00000058-0000-0000-0000-000000000011'::uuid, 'receptionist'),
  ('00000058-0000-0000-0000-000000000043'::uuid, '00000058-0000-0000-0000-000000000011'::uuid, 'receptionist'),
  ('00000058-0000-0000-0000-000000000044'::uuid, '00000058-0000-0000-0000-000000000013'::uuid, 'manager'),
  ('00000058-0000-0000-0000-000000000045'::uuid, '00000058-0000-0000-0000-000000000012'::uuid, 'manager')
) as v(profile_id, property_id, role_slug)
join roles r on r.slug = v.role_slug;

set local role authenticated;
set local request.jwt.claim.sub = '00000058-0000-0000-0000-000000000042';
select is(has_permission('00000058-0000-0000-0000-000000000011', 'shifts.view'), false,
  'a role grant alone is insufficient while the module entitlement is disabled');
reset role;

-- T1 never enables production entitlements. The test enables only Property A1
-- to exercise the policies and deliberately leaves A2/B1 disabled.
insert into property_modules (property_id, module_id, enabled)
select '00000058-0000-0000-0000-000000000011', id, true from modules where slug = 'shifts';
insert into property_modules (property_id, module_id, enabled)
select '00000058-0000-0000-0000-000000000012', id, true from modules where slug = 'shifts';

set local role authenticated;
set local request.jwt.claim.sub = '00000058-0000-0000-0000-000000000042';
select is(has_permission('00000058-0000-0000-0000-000000000011', 'shifts.view'), true,
  'an entitled receptionist receives shifts.view');
select is(has_permission('00000058-0000-0000-0000-000000000011', 'shifts.manage'), false,
  'an entitled receptionist does not receive shifts.manage');
reset role;

set local role authenticated;
set local request.jwt.claim.sub = '00000058-0000-0000-0000-000000000041';
select is(has_permission('00000058-0000-0000-0000-000000000011', 'shifts.manage'), true,
  'an entitled manager receives shifts.manage');
reset role;

insert into shift_staff_profiles (id, property_id, profile_id, employee_type) values
  ('00000058-0000-0000-0000-000000000061', '00000058-0000-0000-0000-000000000011', '00000058-0000-0000-0000-000000000041', 'day'),
  ('00000058-0000-0000-0000-000000000062', '00000058-0000-0000-0000-000000000011', '00000058-0000-0000-0000-000000000042', 'rotating'),
  ('00000058-0000-0000-0000-000000000063', '00000058-0000-0000-0000-000000000011', '00000058-0000-0000-0000-000000000043', 'night'),
  ('00000058-0000-0000-0000-000000000064', '00000058-0000-0000-0000-000000000013', '00000058-0000-0000-0000-000000000044', 'day'),
  ('00000058-0000-0000-0000-000000000065', '00000058-0000-0000-0000-000000000012', '00000058-0000-0000-0000-000000000045', 'day');
insert into shifts (property_id, staff_profile_id, shift_date, code) values
  ('00000058-0000-0000-0000-000000000011', '00000058-0000-0000-0000-000000000062', '2026-10-01', 'M'),
  ('00000058-0000-0000-0000-000000000013', '00000058-0000-0000-0000-000000000064', '2026-10-01', 'P'),
  ('00000058-0000-0000-0000-000000000012', '00000058-0000-0000-0000-000000000065', '2026-10-01', 'N');

set local role authenticated;
set local request.jwt.claim.sub = '00000058-0000-0000-0000-000000000042';
select is((select count(*)::int from shift_staff_profiles), 3,
  'a viewer cannot see the roster of another property in the same organization');
select is((select count(*)::int from shifts), 1,
  'a viewer cannot see shifts from another entitled property in the same organization');
select is((select code from shifts where staff_profile_id = '00000058-0000-0000-0000-000000000062'), 'M',
  'the visible shift carries the expected value');

with changed as (
  update shifts set code = 'N'
  where staff_profile_id = '00000058-0000-0000-0000-000000000062'
  returning 1
)
select is((select count(*)::int from changed), 0, 'shifts.view alone cannot update a shift');
reset role;
select is(
  (select code from shifts where staff_profile_id = '00000058-0000-0000-0000-000000000062'),
  'M',
  'the denied viewer update did not change persisted data'
);

set local role authenticated;
set local request.jwt.claim.sub = '00000058-0000-0000-0000-000000000042';
select throws_ok(
  $$ insert into shifts (property_id, staff_profile_id, shift_date, code)
     values ('00000058-0000-0000-0000-000000000011', '00000058-0000-0000-0000-000000000062', '2026-10-02', 'P') $$,
  '42501', null, 'shifts.view alone cannot insert a shift'
);
reset role;

set local role authenticated;
set local request.jwt.claim.sub = '00000058-0000-0000-0000-000000000041';
with changed as (
  update shifts set code = 'N'
  where staff_profile_id = '00000058-0000-0000-0000-000000000062'
  returning 1
)
select is((select count(*)::int from changed), 1, 'shifts.manage updates exactly one intended shift');
select is(
  (select code from shifts where staff_profile_id = '00000058-0000-0000-0000-000000000062'),
  'N',
  'the manager shift update is persisted and readable'
);
reset role;

-- Self-service data is restricted to the Core profile mapped to the module
-- staff record, rather than trusting a caller-supplied profile id.
set local role authenticated;
set local request.jwt.claim.sub = '00000058-0000-0000-0000-000000000042';
select lives_ok(
  $$ insert into shift_preferences (property_id, staff_profile_id, preferred_shift_codes)
     values ('00000058-0000-0000-0000-000000000011', '00000058-0000-0000-0000-000000000062', array['M']) $$,
  'a staff member can create their own preferences'
);
select is(
  (select preferred_shift_codes from shift_preferences
   where staff_profile_id = '00000058-0000-0000-0000-000000000062'),
  array['M'],
  'own preferences are persisted'
);
select throws_ok(
  $$ insert into shift_preferences (property_id, staff_profile_id, preferred_shift_codes)
     values ('00000058-0000-0000-0000-000000000011', '00000058-0000-0000-0000-000000000063', array['N']) $$,
  '42501', null, 'a staff member cannot create preferences for a peer'
);
select lives_ok(
  $$ insert into shift_absence_requests
       (property_id, staff_profile_id, starts_on, ends_on, absence_type)
     values
       ('00000058-0000-0000-0000-000000000011', '00000058-0000-0000-0000-000000000062',
        '2026-10-10', '2026-10-11', 'leave') $$,
  'a staff member can submit their own absence request'
);
select is(
  (select count(*)::int from shift_absence_requests
   where staff_profile_id = '00000058-0000-0000-0000-000000000062' and status = 'pending'),
  1,
  'the own absence request is persisted as pending'
);
select throws_ok(
  $$ insert into shift_absence_requests
       (property_id, staff_profile_id, starts_on, ends_on, absence_type)
     values
       ('00000058-0000-0000-0000-000000000011', '00000058-0000-0000-0000-000000000063',
        '2026-10-12', '2026-10-12', 'leave') $$,
  '42501', null, 'a staff member cannot submit an absence request for a peer'
);
reset role;

set local role authenticated;
set local request.jwt.claim.sub = '00000058-0000-0000-0000-000000000041';
with changed as (
  update shift_absence_requests set status = 'approved'
  where staff_profile_id = '00000058-0000-0000-0000-000000000062'
  returning 1
)
select is((select count(*)::int from changed), 1, 'a request manager approves exactly one request');
select is(
  (select status from shift_absence_requests
   where staff_profile_id = '00000058-0000-0000-0000-000000000062'),
  'approved',
  'the manager approval is persisted'
);
reset role;

-- A property id cannot be paired with a staff id from another tenant even
-- for a privileged database caller; composite foreign keys enforce this
-- below RLS as a final integrity boundary.
select throws_ok(
  $$ insert into shifts (property_id, staff_profile_id, shift_date, code)
     values ('00000058-0000-0000-0000-000000000011', '00000058-0000-0000-0000-000000000064', '2026-10-02', 'M') $$,
  '23503', null, 'cross-property staff references are rejected by the database'
);

set local role authenticated;
set local request.jwt.claim.sub = '00000058-0000-0000-0000-000000000044';
select is((select count(*)::int from shifts), 0,
  'a manager at a non-entitled property cannot read shift data');
select is(has_permission('00000058-0000-0000-0000-000000000013', 'shifts.manage'), false,
  'a manager at a non-entitled property cannot manage the module');
reset role;

select is(has_table_privilege('anon', 'public.shifts', 'select'), false,
  'anon has no direct table read grant');
select is(has_function_privilege('anon', 'public.is_shift_staff_self(uuid,uuid)', 'execute'), false,
  'anon cannot execute the ownership helper');
select is(has_function_privilege('authenticated', 'public.is_shift_staff_self(uuid,uuid)', 'execute'), true,
  'authenticated can execute the ownership helper used by RLS');

select * from finish();
rollback;
