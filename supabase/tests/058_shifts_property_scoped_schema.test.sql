begin;
create extension if not exists pgtap;
select plan(70);

-- ---------------------------------------------------------------------------
-- Reference data and tenant fixtures
-- ---------------------------------------------------------------------------

insert into organizations (id, name, slug) values
  ('00000058-0000-0000-0000-000000000001', 'Shifts Org A', 'test-058-org-a'),
  ('00000058-0000-0000-0000-000000000002', 'Shifts Org B', 'test-058-org-b');

insert into properties (id, organization_id, name, slug) values
  ('00000058-0000-0000-0000-000000000011', '00000058-0000-0000-0000-000000000001', 'Shifts Property A', 'shifts-a'),
  ('00000058-0000-0000-0000-000000000012', '00000058-0000-0000-0000-000000000002', 'Shifts Property B', 'shifts-b');

-- Only A is entitled. B deliberately remains disabled.
insert into property_modules (property_id, module_id, enabled)
select '00000058-0000-0000-0000-000000000011', id, true
from modules where slug = 'shifts';

insert into auth.users (id, email) values
  ('00000058-0000-0000-0000-000000000041', 'manager-a-058@example.com'),
  ('00000058-0000-0000-0000-000000000042', 'employee-a-058@example.com'),
  ('00000058-0000-0000-0000-000000000043', 'peer-a-058@example.com'),
  ('00000058-0000-0000-0000-000000000044', 'manager-b-058@example.com'),
  ('00000058-0000-0000-0000-000000000045', 'org-admin-a-058@example.com');

insert into profiles (id, full_name) values
  ('00000058-0000-0000-0000-000000000041', 'Manager A'),
  ('00000058-0000-0000-0000-000000000042', 'Employee A'),
  ('00000058-0000-0000-0000-000000000043', 'Peer A'),
  ('00000058-0000-0000-0000-000000000044', 'Manager B'),
  ('00000058-0000-0000-0000-000000000045', 'Organization Admin A');

insert into memberships (profile_id, property_id, organization_id, role_id, status)
select fixture.profile_id, fixture.property_id, fixture.organization_id, role.id, 'active'
from (values
  ('00000058-0000-0000-0000-000000000041'::uuid, '00000058-0000-0000-0000-000000000011'::uuid, null::uuid, 'manager'),
  ('00000058-0000-0000-0000-000000000042'::uuid, '00000058-0000-0000-0000-000000000011'::uuid, null::uuid, 'receptionist'),
  ('00000058-0000-0000-0000-000000000043'::uuid, '00000058-0000-0000-0000-000000000011'::uuid, null::uuid, 'receptionist'),
  ('00000058-0000-0000-0000-000000000044'::uuid, '00000058-0000-0000-0000-000000000012'::uuid, null::uuid, 'manager'),
  ('00000058-0000-0000-0000-000000000045'::uuid, null::uuid, '00000058-0000-0000-0000-000000000001'::uuid, 'organization_admin')
) as fixture(profile_id, property_id, organization_id, role_slug)
join roles role on role.slug = fixture.role_slug;

insert into property_job_titles (id, property_id, name) values
  ('00000058-0000-0000-0000-000000000061', '00000058-0000-0000-0000-000000000011', 'Reception A'),
  ('00000058-0000-0000-0000-000000000062', '00000058-0000-0000-0000-000000000012', 'Reception B');

insert into property_staff_details (property_id, profile_id, job_title_id) values
  ('00000058-0000-0000-0000-000000000011', '00000058-0000-0000-0000-000000000041', '00000058-0000-0000-0000-000000000061'),
  ('00000058-0000-0000-0000-000000000011', '00000058-0000-0000-0000-000000000042', '00000058-0000-0000-0000-000000000061'),
  ('00000058-0000-0000-0000-000000000011', '00000058-0000-0000-0000-000000000043', '00000058-0000-0000-0000-000000000061'),
  ('00000058-0000-0000-0000-000000000012', '00000058-0000-0000-0000-000000000044', '00000058-0000-0000-0000-000000000062');

insert into shift_planning_units (id, property_id, name, slug) values
  ('00000058-0000-0000-0000-000000000071', '00000058-0000-0000-0000-000000000011', 'Reception A', 'reception'),
  ('00000058-0000-0000-0000-000000000073', '00000058-0000-0000-0000-000000000011', 'Housekeeping A', 'housekeeping'),
  ('00000058-0000-0000-0000-000000000072', '00000058-0000-0000-0000-000000000012', 'Reception B', 'reception');

insert into shift_staff_profiles (id, property_id, profile_id, shift_type) values
  ('00000058-0000-0000-0000-000000000081', '00000058-0000-0000-0000-000000000011', '00000058-0000-0000-0000-000000000041', 'director'),
  ('00000058-0000-0000-0000-000000000082', '00000058-0000-0000-0000-000000000011', '00000058-0000-0000-0000-000000000042', 'day'),
  ('00000058-0000-0000-0000-000000000083', '00000058-0000-0000-0000-000000000011', '00000058-0000-0000-0000-000000000043', 'rotating'),
  ('00000058-0000-0000-0000-000000000084', '00000058-0000-0000-0000-000000000012', '00000058-0000-0000-0000-000000000044', 'director');

insert into shift_unit_members (id, property_id, planning_unit_id, staff_profile_id) values
  ('00000058-0000-0000-0000-000000000091', '00000058-0000-0000-0000-000000000011', '00000058-0000-0000-0000-000000000071', '00000058-0000-0000-0000-000000000081'),
  ('00000058-0000-0000-0000-000000000092', '00000058-0000-0000-0000-000000000011', '00000058-0000-0000-0000-000000000071', '00000058-0000-0000-0000-000000000082'),
  ('00000058-0000-0000-0000-000000000093', '00000058-0000-0000-0000-000000000011', '00000058-0000-0000-0000-000000000073', '00000058-0000-0000-0000-000000000083'),
  ('00000058-0000-0000-0000-000000000094', '00000058-0000-0000-0000-000000000012', '00000058-0000-0000-0000-000000000072', '00000058-0000-0000-0000-000000000084');

insert into shift_codes (id, property_id, planning_unit_id, code, label, kind, starts_at, ends_at, color) values
  ('00000058-0000-0000-0000-000000000101', '00000058-0000-0000-0000-000000000011', '00000058-0000-0000-0000-000000000071', 'A1', 'Apertura 1', 'work', '07:00', '15:00', '#2E9F43'),
  ('00000058-0000-0000-0000-000000000103', '00000058-0000-0000-0000-000000000011', '00000058-0000-0000-0000-000000000073', 'H1', 'Housekeeping', 'work', '08:00', '16:00', '#8B5CF6'),
  ('00000058-0000-0000-0000-000000000102', '00000058-0000-0000-0000-000000000012', '00000058-0000-0000-0000-000000000072', 'A1', 'Apertura 1', 'work', '07:00', '15:00', '#2E9F43');

insert into shifts (id, property_id, planning_unit_id, staff_profile_id, shift_code_id, shift_date) values
  ('00000058-0000-0000-0000-000000000111', '00000058-0000-0000-0000-000000000011', '00000058-0000-0000-0000-000000000071', '00000058-0000-0000-0000-000000000082', '00000058-0000-0000-0000-000000000101', '2026-10-01'),
  ('00000058-0000-0000-0000-000000000112', '00000058-0000-0000-0000-000000000011', '00000058-0000-0000-0000-000000000073', '00000058-0000-0000-0000-000000000083', '00000058-0000-0000-0000-000000000103', '2026-10-01'),
  ('00000058-0000-0000-0000-000000000113', '00000058-0000-0000-0000-000000000011', '00000058-0000-0000-0000-000000000071', '00000058-0000-0000-0000-000000000081', '00000058-0000-0000-0000-000000000101', '2026-10-02');

insert into shift_notifications (id, property_id, planning_unit_id, profile_id, kind) values
  ('00000058-0000-0000-0000-000000000121', '00000058-0000-0000-0000-000000000011', '00000058-0000-0000-0000-000000000071', '00000058-0000-0000-0000-000000000042', 'schedule_published'),
  ('00000058-0000-0000-0000-000000000122', '00000058-0000-0000-0000-000000000011', '00000058-0000-0000-0000-000000000073', '00000058-0000-0000-0000-000000000043', 'schedule_published');

insert into shift_preferences (property_id, planning_unit_id, staff_profile_id, preference_date, preference) values
  ('00000058-0000-0000-0000-000000000011', '00000058-0000-0000-0000-000000000073', '00000058-0000-0000-0000-000000000083', '2026-10-03', 'prefer_evening');

insert into shift_absence_requests (id, property_id, planning_unit_id, staff_profile_id, starts_on, ends_on, absence_kind) values
  ('00000058-0000-0000-0000-000000000132', '00000058-0000-0000-0000-000000000011', '00000058-0000-0000-0000-000000000073', '00000058-0000-0000-0000-000000000083', '2026-10-06', '2026-10-06', 'permission');

-- ---------------------------------------------------------------------------
-- Schema, capability and tenant-integrity assertions
-- ---------------------------------------------------------------------------

select is(
  (select count(*)::int from permissions where slug like 'shifts.%'),
  3,
  'Turni exposes exactly the three approved capabilities'
);
select is(
  (select count(*)::int from role_permissions rp join roles r on r.id = rp.role_id join permissions p on p.id = rp.permission_id where r.slug = 'receptionist' and p.slug like 'shifts.%'),
  1,
  'receptionist receives view only'
);
select is(
  (select count(*)::int from role_permissions rp join roles r on r.id = rp.role_id join permissions p on p.id = rp.permission_id where r.slug = 'manager' and p.slug like 'shifts.%'),
  3,
  'manager receives view, manage and request management'
);
select is(
  (select count(*)::int from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relname in ('shift_planning_units','shift_staff_profiles','shift_unit_job_titles','shift_unit_members','shift_rule_sets','shift_codes','shift_month_states','shifts','shift_preferences','shift_absence_requests','shift_swap_requests','shift_preassignments','shift_notifications','shift_push_subscriptions') and c.relrowsecurity),
  14,
  'RLS is enabled on every exposed Turni table'
);
select ok(
  not has_table_privilege('anon', 'public.shift_planning_units', 'select,insert,update,delete'),
  'anon receives no Turni table privileges'
);
select ok(
  has_column_privilege('authenticated', 'public.shift_notifications', 'read_at', 'update')
  and not has_column_privilege('authenticated', 'public.shift_notifications', 'payload', 'update'),
  'notification recipients can update read_at but not rewrite payload'
);
select ok(
  not has_table_privilege('authenticated', 'public.shift_rule_sets', 'update,delete'),
  'immutable rule sets expose no update or delete grant'
);
select is(
  (select member_visibility_scope from shift_planning_units where id = '00000058-0000-0000-0000-000000000071'),
  'own_unit',
  'planning-unit members default to seeing only their own unit'
);

select throws_ok(
  $$insert into shift_unit_job_titles (property_id, planning_unit_id, job_title_id)
    values ('00000058-0000-0000-0000-000000000011', '00000058-0000-0000-0000-000000000071', '00000058-0000-0000-0000-000000000062')$$,
  '23503', null,
  'a planning unit cannot reference a job title from another property'
);
select throws_ok(
  $$insert into shift_unit_members (property_id, planning_unit_id, staff_profile_id)
    values ('00000058-0000-0000-0000-000000000011', '00000058-0000-0000-0000-000000000071', '00000058-0000-0000-0000-000000000084')$$,
  '23503', null,
  'a planning unit cannot include staff from another property'
);
select throws_ok(
  $$insert into shifts (property_id, planning_unit_id, staff_profile_id, shift_code_id, shift_date)
    values ('00000058-0000-0000-0000-000000000011', '00000058-0000-0000-0000-000000000071', '00000058-0000-0000-0000-000000000082', '00000058-0000-0000-0000-000000000102', '2026-10-02')$$,
  '23503', null,
  'a shift cannot use a code from another property'
);
select throws_ok(
  $$insert into shifts (property_id, planning_unit_id, staff_profile_id, shift_code_id, shift_date)
    values ('00000058-0000-0000-0000-000000000011', '00000058-0000-0000-0000-000000000071', '00000058-0000-0000-0000-000000000082', '00000058-0000-0000-0000-000000000103', '2026-10-02')$$,
  '23503', null,
  'a shift cannot use a code from another unit in the same property'
);
select throws_ok(
  $$insert into shifts (property_id, planning_unit_id, staff_profile_id, shift_code_id, shift_date)
    values ('00000058-0000-0000-0000-000000000012', '00000058-0000-0000-0000-000000000072', '00000058-0000-0000-0000-000000000082', '00000058-0000-0000-0000-000000000102', '2026-10-02')$$,
  '23503', null,
  'a shift cannot pair a staff profile with another property'
);
select throws_ok(
  $$insert into shift_swap_requests (property_id, planning_unit_id, requester_staff_profile_id, requested_shift_id, target_staff_profile_id)
    values ('00000058-0000-0000-0000-000000000011', '00000058-0000-0000-0000-000000000071', '00000058-0000-0000-0000-000000000082', '00000058-0000-0000-0000-000000000111', '00000058-0000-0000-0000-000000000084')$$,
  '23503', null,
  'a swap request cannot target staff from another property'
);
select throws_ok(
  $$insert into shift_swap_requests (property_id, planning_unit_id, requester_staff_profile_id, requested_shift_id, offered_shift_id)
    values ('00000058-0000-0000-0000-000000000011', '00000058-0000-0000-0000-000000000071', '00000058-0000-0000-0000-000000000082', '00000058-0000-0000-0000-000000000111', '00000058-0000-0000-0000-000000000113')$$,
  '23514', null,
  'an offered shift requires an explicit target staff member'
);

-- ---------------------------------------------------------------------------
-- Read-only employee: can read and own input, cannot administer
-- ---------------------------------------------------------------------------

set local role authenticated;
set local request.jwt.claim.sub = '00000058-0000-0000-0000-000000000042';

select is((select count(*)::int from shift_planning_units), 1, 'employee sees only the entitled property unit');
select is((select count(*)::int from shifts), 2, 'employee reads every shift in their member unit');
select is((select count(*)::int from shift_staff_profiles), 2, 'employee sees staff only from visible units');
select is((select count(*)::int from shift_notifications), 1, 'employee reads only their own notification');
update shift_notifications set read_at = now()
where id = '00000058-0000-0000-0000-000000000121';
select ok(
  (select read_at is not null from shift_notifications where id = '00000058-0000-0000-0000-000000000121'),
  'notification recipient can persist read_at'
);
update shift_notifications set read_at = now()
where id = '00000058-0000-0000-0000-000000000122';
reset role;
select ok(
  (select read_at is null from shift_notifications where id = '00000058-0000-0000-0000-000000000122'),
  'recipient cannot update a peer notification'
);
set local role authenticated;
set local request.jwt.claim.sub = '00000058-0000-0000-0000-000000000042';
select throws_ok(
  $$insert into shift_planning_units (property_id, name, slug) values ('00000058-0000-0000-0000-000000000011', 'Forbidden', 'forbidden')$$,
  '42501', null,
  'view capability cannot create planning units'
);
select throws_ok(
  $$insert into shifts (property_id, planning_unit_id, staff_profile_id, shift_code_id, shift_date)
    values ('00000058-0000-0000-0000-000000000011', '00000058-0000-0000-0000-000000000071', '00000058-0000-0000-0000-000000000082', '00000058-0000-0000-0000-000000000101', '2026-10-03')$$,
  '42501', null,
  'view capability cannot write the schedule'
);
select lives_ok(
  $$insert into shift_preferences (property_id, planning_unit_id, staff_profile_id, preference_date, preference)
    values ('00000058-0000-0000-0000-000000000011', '00000058-0000-0000-0000-000000000071', '00000058-0000-0000-0000-000000000082', '2026-10-03', 'prefer_morning')$$,
  'employee can create their own preference'
);
select is(
  (select preference from shift_preferences where staff_profile_id = '00000058-0000-0000-0000-000000000082'),
  'prefer_morning',
  'the own preference is persisted'
);
select is((select count(*)::int from shift_preferences), 1, 'employee cannot read a peer preference');
select throws_ok(
  $$insert into shift_preferences (property_id, planning_unit_id, staff_profile_id, preference_date, preference)
    values ('00000058-0000-0000-0000-000000000011', '00000058-0000-0000-0000-000000000071', '00000058-0000-0000-0000-000000000083', '2026-10-03', 'prefer_morning')$$,
  '42501', null,
  'employee cannot create a preference for a peer'
);
select lives_ok(
  $$insert into shift_absence_requests (id, property_id, planning_unit_id, staff_profile_id, starts_on, ends_on, absence_kind)
    values ('00000058-0000-0000-0000-000000000131', '00000058-0000-0000-0000-000000000011', '00000058-0000-0000-0000-000000000071', '00000058-0000-0000-0000-000000000082', '2026-10-04', '2026-10-05', 'leave')$$,
  'employee can open their own absence request'
);
select is(
  (select status from shift_absence_requests where id = '00000058-0000-0000-0000-000000000131'),
  'pending',
  'new absence request is persisted as pending'
);
select is((select count(*)::int from shift_absence_requests), 1, 'employee cannot read a peer absence request');
update shift_absence_requests set status = 'approved'
where id = '00000058-0000-0000-0000-000000000131';
select is(
  (select status from shift_absence_requests where id = '00000058-0000-0000-0000-000000000131'),
  'pending',
  'failed self-approval leaves the request pending'
);
update shift_absence_requests set status = 'cancelled'
where id = '00000058-0000-0000-0000-000000000131';
select is(
  (select status from shift_absence_requests where id = '00000058-0000-0000-0000-000000000131'),
  'pending',
  'employee cannot bypass the future cancellation RPC'
);
select lives_ok(
  $$insert into shift_push_subscriptions (property_id, profile_id, endpoint, p256dh, auth_secret)
    values ('00000058-0000-0000-0000-000000000011', '00000058-0000-0000-0000-000000000042', 'https://push.example/employee', 'key', 'secret')$$,
  'employee can register their own push subscription'
);
select is(
  (select count(*)::int from shift_push_subscriptions where profile_id = '00000058-0000-0000-0000-000000000042'),
  1,
  'the own push subscription is persisted'
);
select throws_ok(
  $$insert into shift_push_subscriptions (property_id, profile_id, endpoint, p256dh, auth_secret)
    values ('00000058-0000-0000-0000-000000000011', '00000058-0000-0000-0000-000000000043', 'https://push.example/peer', 'key', 'secret')$$,
  '42501', null,
  'employee cannot register a push subscription for a peer'
);
select lives_ok(
  $$insert into shift_swap_requests (id, property_id, planning_unit_id, requester_staff_profile_id, requested_shift_id, target_staff_profile_id, offered_shift_id)
    values ('00000058-0000-0000-0000-000000000151', '00000058-0000-0000-0000-000000000011', '00000058-0000-0000-0000-000000000071', '00000058-0000-0000-0000-000000000082', '00000058-0000-0000-0000-000000000111', '00000058-0000-0000-0000-000000000081', '00000058-0000-0000-0000-000000000113')$$,
  'employee can open a valid swap request for their own shift'
);
select is(
  (select status from shift_swap_requests where id = '00000058-0000-0000-0000-000000000151'),
  'pending',
  'the swap request is persisted as pending'
);

-- ---------------------------------------------------------------------------
-- Manager: property-scoped writes and request decisions
-- ---------------------------------------------------------------------------

set local request.jwt.claim.sub = '00000058-0000-0000-0000-000000000041';

select ok(has_permission('00000058-0000-0000-0000-000000000011', 'shifts.manage'), 'entitled manager has shifts.manage');
select is((select count(*)::int from shift_planning_units), 2, 'manager sees all units in their property but not another property');
select lives_ok(
  $$insert into shift_planning_units (id, property_id, name, slug)
    values ('00000058-0000-0000-0000-000000000074', '00000058-0000-0000-0000-000000000011', 'Temporary A', 'temporary')$$,
  'manager can create an empty planning unit in their property'
);
select is(
  (select name from shift_planning_units where id = '00000058-0000-0000-0000-000000000074'),
  'Temporary A',
  'manager planning-unit insert is persisted'
);
select lives_ok(
  $$delete from shift_planning_units where id = '00000058-0000-0000-0000-000000000074'$$,
  'manager can delete an empty planning unit'
);
select is(
  (select count(*)::int from shift_planning_units where id = '00000058-0000-0000-0000-000000000074'),
  0,
  'planning-unit deletion is persisted'
);
select lives_ok(
  $$insert into shifts (property_id, planning_unit_id, staff_profile_id, shift_code_id, shift_date)
    values ('00000058-0000-0000-0000-000000000011', '00000058-0000-0000-0000-000000000071', '00000058-0000-0000-0000-000000000081', '00000058-0000-0000-0000-000000000101', '2026-10-03')$$,
  'manager can add a schedule assignment'
);
select is(
  (select count(*)::int from shifts where shift_date = '2026-10-03'),
  1,
  'manager schedule write is persisted'
);

select lives_ok(
  $$insert into shift_rule_sets (id, property_id, planning_unit_id, version, engine_version, rules, created_by)
    values ('00000058-0000-0000-0000-000000000141', '00000058-0000-0000-0000-000000000011', '00000058-0000-0000-0000-000000000071', 1, 'v1', '{}'::jsonb, '00000058-0000-0000-0000-000000000041')$$,
  'manager can create a rule-set version'
);
select is(
  (select engine_version from shift_rule_sets where id = '00000058-0000-0000-0000-000000000141'),
  'v1',
  'rule-set version is persisted'
);
select throws_ok(
  $$update shift_rule_sets set rules = '{"changed":true}'::jsonb where id = '00000058-0000-0000-0000-000000000141'$$,
  '42501', null,
  'published rule-set rows cannot be mutated through the Data API'
);
update shift_planning_units set current_rule_set_id = '00000058-0000-0000-0000-000000000141'
where id = '00000058-0000-0000-0000-000000000071';
select is(
  (select current_rule_set_id from shift_planning_units where id = '00000058-0000-0000-0000-000000000071'),
  '00000058-0000-0000-0000-000000000141'::uuid,
  'unit can activate a rule set belonging to itself'
);

update shift_absence_requests set status = 'approved', decided_by = '00000058-0000-0000-0000-000000000041', decided_at = now()
where id = '00000058-0000-0000-0000-000000000132';
select is(
  (select status from shift_absence_requests where id = '00000058-0000-0000-0000-000000000132'),
  'approved',
  'request manager can approve a peer request'
);
select lives_ok(
  $$update shift_swap_requests set status = 'approved', decided_by = '00000058-0000-0000-0000-000000000041', decided_at = now()
    where id = '00000058-0000-0000-0000-000000000151'$$,
  'request manager can approve a valid swap request'
);
select is(
  (select status from shift_swap_requests where id = '00000058-0000-0000-0000-000000000151'),
  'approved',
  'swap approval is persisted'
);

update shift_unit_members set active = false
where property_id = '00000058-0000-0000-0000-000000000011'
  and planning_unit_id = '00000058-0000-0000-0000-000000000071'
  and staff_profile_id = '00000058-0000-0000-0000-000000000082';
set local request.jwt.claim.sub = '00000058-0000-0000-0000-000000000042';
select throws_ok(
  $$insert into shift_preferences (property_id, planning_unit_id, staff_profile_id, preference_date, preference)
    values ('00000058-0000-0000-0000-000000000011', '00000058-0000-0000-0000-000000000071', '00000058-0000-0000-0000-000000000082', '2026-10-07', 'prefer_off')$$,
  '42501', null,
  'an inactive unit member cannot create preferences for the former unit'
);
select throws_ok(
  $$insert into shift_absence_requests (property_id, planning_unit_id, staff_profile_id, starts_on, ends_on, absence_kind)
    values ('00000058-0000-0000-0000-000000000011', '00000058-0000-0000-0000-000000000071', '00000058-0000-0000-0000-000000000082', '2026-10-07', '2026-10-07', 'leave')$$,
  '42501', null,
  'an inactive unit member cannot create absence requests for the former unit'
);
select throws_ok(
  $$insert into shift_swap_requests (property_id, planning_unit_id, requester_staff_profile_id, requested_shift_id, target_staff_profile_id, offered_shift_id)
    values ('00000058-0000-0000-0000-000000000011', '00000058-0000-0000-0000-000000000071', '00000058-0000-0000-0000-000000000082', '00000058-0000-0000-0000-000000000111', '00000058-0000-0000-0000-000000000081', '00000058-0000-0000-0000-000000000113')$$,
  '42501', null,
  'an inactive unit member cannot open swap requests for the former unit'
);
select is(
  (select count(*)::int from shift_preferences where staff_profile_id = '00000058-0000-0000-0000-000000000082'),
  1,
  'an inactive unit member retains read access to their historical preferences'
);
set local request.jwt.claim.sub = '00000058-0000-0000-0000-000000000041';
update shift_unit_members set active = true
where property_id = '00000058-0000-0000-0000-000000000011'
  and planning_unit_id = '00000058-0000-0000-0000-000000000071'
  and staff_profile_id = '00000058-0000-0000-0000-000000000082';
select ok(
  (select active from shift_unit_members
   where property_id = '00000058-0000-0000-0000-000000000011'
     and planning_unit_id = '00000058-0000-0000-0000-000000000071'
     and staff_profile_id = '00000058-0000-0000-0000-000000000082'),
  'manager can reactivate the unit membership after the access test'
);

update shift_planning_units set member_visibility_scope = 'all_units'
where id = '00000058-0000-0000-0000-000000000071';
set local request.jwt.claim.sub = '00000058-0000-0000-0000-000000000042';
select is((select count(*)::int from shift_planning_units), 2, 'all-units setting lets members of the configured source unit see the other unit');
select is((select count(*)::int from shifts), 4, 'all-units setting lets source-unit members see the other unit schedule');
select is((select count(*)::int from shift_preferences), 1, 'all-units visibility does not expose peer preferences');
select is((select count(*)::int from shift_absence_requests), 1, 'all-units visibility does not expose peer absence requests');
select is((select count(*)::int from shift_notifications), 1, 'all-units visibility does not expose peer notifications');

set local request.jwt.claim.sub = '00000058-0000-0000-0000-000000000043';
select is((select count(*)::int from shift_planning_units), 1, 'the setting is directional: members of another own-unit group still see only their unit');
select is((select count(*)::int from shifts), 1, 'the other own-unit group still sees only its own schedule');

set local request.jwt.claim.sub = '00000058-0000-0000-0000-000000000045';
select ok(has_permission('00000058-0000-0000-0000-000000000011', 'shifts.manage'), 'organization admin inherits Turni management for an entitled property');
select is((select count(*)::int from shift_planning_units), 2, 'organization admin sees every unit in a property of their organization');

-- ---------------------------------------------------------------------------
-- Disabled entitlement: even a manager fails closed
-- ---------------------------------------------------------------------------

set local request.jwt.claim.sub = '00000058-0000-0000-0000-000000000044';
select ok(not has_permission('00000058-0000-0000-0000-000000000012', 'shifts.view'), 'disabled property fails the view capability');
select ok(not has_permission('00000058-0000-0000-0000-000000000012', 'shifts.manage'), 'disabled property fails the manage capability');
select is((select count(*)::int from shift_planning_units), 0, 'disabled property exposes no Turni rows');
select throws_ok(
  $$insert into shift_planning_units (property_id, name, slug)
    values ('00000058-0000-0000-0000-000000000012', 'Forbidden B', 'forbidden-b')$$,
  '42501', null,
  'disabled property cannot create Turni configuration'
);

select * from finish();
rollback;
