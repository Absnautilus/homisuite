-- Fase 2 Step 7 — REQUEST VISIBILITY, REWRITTEN for
-- 20260917120000_request_categories_job_titles: the department-scoped
-- queue (a fixed reception/housekeeping/maintenance/porter enum) is
-- replaced by mansione-based routing (property_job_titles, the same
-- per-property job titles Team already manages). This file keeps its
-- original number/role in the suite (guest_requests visibility isolation)
-- but its assertions now cover the new mechanism: own mansione visible, a
-- different mansione not, a sees_full_queue mansione sees everything,
-- Core admin rank does not bypass operational routing, a category with no mansione linked is invisible to everyone but
-- admin/master/sees_full_queue, and a staff member with no job title at
-- all fails closed.
begin;
create extension if not exists pgtap;
select plan(11);

insert into hotels (id, name, timezone, active) values
  ('00000026-0000-0000-0000-00000000ff01', 'Hotel Uno', 'Europe/Rome', true);
select backfill_legacy_property_mapping();
select backfill_guest_requests_entitlement();

-- Categories deliberately created with no department at all (nullable as
-- of this migration) -- the new, intended shape going forward.
insert into request_categories (id, hotel_id, name) values
  ('00000026-0000-0000-0000-000000000c01', '00000026-0000-0000-0000-00000000ff01', 'Pulizie'),
  ('00000026-0000-0000-0000-000000000c02', '00000026-0000-0000-0000-00000000ff01', 'Manutenzione'),
  ('00000026-0000-0000-0000-000000000c03', '00000026-0000-0000-0000-00000000ff01', 'Non Assegnata');
insert into request_types (id, category_id, name) values
  ('00000026-0000-0000-0000-0000000fee01', '00000026-0000-0000-0000-000000000c01', 'Asciugamani'),
  ('00000026-0000-0000-0000-0000000fee02', '00000026-0000-0000-0000-000000000c02', 'Riparazione'),
  ('00000026-0000-0000-0000-0000000fee03', '00000026-0000-0000-0000-000000000c03', 'Voce Orfana');

insert into property_job_titles (id, property_id, name, sees_full_queue)
select '00000026-0000-0000-0000-0000000aa001', m.platform_property_id, 'Governante', false
from legacy_property_mapping m where m.legacy_hotel_id = '00000026-0000-0000-0000-00000000ff01';
insert into property_job_titles (id, property_id, name, sees_full_queue)
select '00000026-0000-0000-0000-0000000aa002', m.platform_property_id, 'Tecnico', false
from legacy_property_mapping m where m.legacy_hotel_id = '00000026-0000-0000-0000-00000000ff01';
insert into property_job_titles (id, property_id, name, sees_full_queue)
select '00000026-0000-0000-0000-0000000aa003', m.platform_property_id, 'Reception', true
from legacy_property_mapping m where m.legacy_hotel_id = '00000026-0000-0000-0000-00000000ff01';

insert into request_category_job_titles (category_id, job_title_id) values
  ('00000026-0000-0000-0000-000000000c01', '00000026-0000-0000-0000-0000000aa001'), -- Pulizie -> Governante
  ('00000026-0000-0000-0000-000000000c02', '00000026-0000-0000-0000-0000000aa002'); -- Manutenzione -> Tecnico
-- 'Non Assegnata' deliberately has no linked job title at all.

insert into rooms (id, hotel_id, room_number) values
  ('00000026-0000-0000-0000-0000000fa001', '00000026-0000-0000-0000-00000000ff01', '101'),
  ('00000026-0000-0000-0000-0000000fa002', '00000026-0000-0000-0000-00000000ff01', '102'),
  ('00000026-0000-0000-0000-0000000fa003', '00000026-0000-0000-0000-00000000ff01', '103');

-- Inserted via the trigger's own resolution (assigned_job_title_ids left
-- at its default '{}' here), not hardcoded, so this also exercises
-- guest_requests_before_insert's new lookup end-to-end.
insert into guest_requests (id, hotel_id, room_number, request_type_id, quantity, status) values
  ('00000026-0000-0000-0000-00000000ba01', '00000026-0000-0000-0000-00000000ff01', '101', '00000026-0000-0000-0000-0000000fee01', 1, 'requested'),
  ('00000026-0000-0000-0000-00000000ba02', '00000026-0000-0000-0000-00000000ff01', '102', '00000026-0000-0000-0000-0000000fee02', 1, 'requested'),
  ('00000026-0000-0000-0000-00000000ba03', '00000026-0000-0000-0000-00000000ff01', '103', '00000026-0000-0000-0000-0000000fee03', 1, 'requested');

select is(
  (select assigned_job_title_ids from guest_requests where id = '00000026-0000-0000-0000-00000000ba01'),
  array['00000026-0000-0000-0000-0000000aa001']::uuid[],
  'guest_requests_before_insert resolved the Pulizie request''s assigned_job_title_ids from its category'
);

insert into auth.users (id) values
  ('00000026-0000-0000-0000-000000000a01'), -- Governante
  ('00000026-0000-0000-0000-000000000a02'), -- Tecnico
  ('00000026-0000-0000-0000-000000000a03'), -- Reception (sees_full_queue)
  ('00000026-0000-0000-0000-000000000a04'), -- property_admin
  ('00000026-0000-0000-0000-000000000a05'); -- operatore with no job title assigned

insert into profiles (id, full_name) values
  ('00000026-0000-0000-0000-000000000a01', 'Governante Uno'),
  ('00000026-0000-0000-0000-000000000a02', 'Tecnico Uno'),
  ('00000026-0000-0000-0000-000000000a03', 'Reception Uno'),
  ('00000026-0000-0000-0000-000000000a04', 'PA Uno'),
  ('00000026-0000-0000-0000-000000000a05', 'Senza Mansione');

insert into staff_profiles (id, hotel_id, auth_user_id, name, role, department, active, login_username) values
  ('00000026-0000-0000-0000-000000000101', '00000026-0000-0000-0000-00000000ff01', '00000026-0000-0000-0000-000000000a01', 'Governante Uno', 'operatore', 'housekeeping', true, 'test026.gov1'),
  ('00000026-0000-0000-0000-000000000102', '00000026-0000-0000-0000-00000000ff01', '00000026-0000-0000-0000-000000000a02', 'Tecnico Uno', 'operatore', 'maintenance', true, 'test026.tec1'),
  ('00000026-0000-0000-0000-000000000103', '00000026-0000-0000-0000-00000000ff01', '00000026-0000-0000-0000-000000000a03', 'Reception Uno', 'operatore', 'reception', true, 'test026.rec1'),
  ('00000026-0000-0000-0000-000000000104', '00000026-0000-0000-0000-00000000ff01', '00000026-0000-0000-0000-000000000a04', 'PA Uno', 'admin', null, true, null),
  ('00000026-0000-0000-0000-000000000105', '00000026-0000-0000-0000-00000000ff01', '00000026-0000-0000-0000-000000000a05', 'Senza Mansione', 'operatore', 'housekeeping', true, 'test026.none1');

insert into memberships (profile_id, property_id, role_id, status)
select '00000026-0000-0000-0000-000000000a01', m.platform_property_id, r.id, 'active'
from legacy_property_mapping m, roles r
where m.legacy_hotel_id = '00000026-0000-0000-0000-00000000ff01' and r.slug = 'receptionist';
insert into memberships (profile_id, property_id, role_id, status)
select '00000026-0000-0000-0000-000000000a02', m.platform_property_id, r.id, 'active'
from legacy_property_mapping m, roles r
where m.legacy_hotel_id = '00000026-0000-0000-0000-00000000ff01' and r.slug = 'receptionist';
insert into memberships (profile_id, property_id, role_id, status)
select '00000026-0000-0000-0000-000000000a03', m.platform_property_id, r.id, 'active'
from legacy_property_mapping m, roles r
where m.legacy_hotel_id = '00000026-0000-0000-0000-00000000ff01' and r.slug = 'receptionist';
insert into memberships (profile_id, property_id, role_id, status)
select '00000026-0000-0000-0000-000000000a04', m.platform_property_id, r.id, 'active'
from legacy_property_mapping m, roles r
where m.legacy_hotel_id = '00000026-0000-0000-0000-00000000ff01' and r.slug = 'property_admin';
insert into memberships (profile_id, property_id, role_id, status)
select '00000026-0000-0000-0000-000000000a05', m.platform_property_id, r.id, 'active'
from legacy_property_mapping m, roles r
where m.legacy_hotel_id = '00000026-0000-0000-0000-00000000ff01' and r.slug = 'receptionist';

insert into property_staff_details (property_id, profile_id, job_title_id)
select m.platform_property_id, '00000026-0000-0000-0000-000000000a01', '00000026-0000-0000-0000-0000000aa001'
from legacy_property_mapping m where m.legacy_hotel_id = '00000026-0000-0000-0000-00000000ff01';
insert into property_staff_details (property_id, profile_id, job_title_id)
select m.platform_property_id, '00000026-0000-0000-0000-000000000a02', '00000026-0000-0000-0000-0000000aa002'
from legacy_property_mapping m where m.legacy_hotel_id = '00000026-0000-0000-0000-00000000ff01';
insert into property_staff_details (property_id, profile_id, job_title_id)
select m.platform_property_id, '00000026-0000-0000-0000-000000000a03', '00000026-0000-0000-0000-0000000aa003'
from legacy_property_mapping m where m.legacy_hotel_id = '00000026-0000-0000-0000-00000000ff01';
-- a04 (property_admin) and a05 (no job title) deliberately get no
-- property_staff_details row at all.

-- ### own mansione visible, a different mansione not ###
set local role authenticated;
set local request.jwt.claim.sub = '00000026-0000-0000-0000-000000000a01';
select is(
  (select count(*)::int from guest_requests where id = '00000026-0000-0000-0000-00000000ba01'),
  1,
  'Governante sees the Pulizie request (their own mansione)'
);
select is(
  (select count(*)::int from guest_requests where id = '00000026-0000-0000-0000-00000000ba02'),
  0,
  'Governante does NOT see the Manutenzione request (a different mansione)'
);
select is(
  (select count(*)::int from guest_requests where id = '00000026-0000-0000-0000-00000000ba03'),
  0,
  'Governante does NOT see the unassigned-category request either'
);
-- mutation + re-SELECT under the same role, per house style
select lives_ok(
  $$ update guest_requests set status = 'in_progress' where id = '00000026-0000-0000-0000-00000000ba01' $$,
  'Governante can update their own-mansione request'
);
select is(
  (select status from guest_requests where id = '00000026-0000-0000-0000-00000000ba01'),
  'in_progress',
  'the update actually persisted'
);
reset role;

set local role authenticated;
set local request.jwt.claim.sub = '00000026-0000-0000-0000-000000000a02';
select is(
  (select count(*)::int from guest_requests where id = '00000026-0000-0000-0000-00000000ba02'),
  1,
  'Tecnico sees the Manutenzione request (their own mansione)'
);
select is(
  (select count(*)::int from guest_requests where id = '00000026-0000-0000-0000-00000000ba01'),
  0,
  'Tecnico does NOT see the Pulizie request'
);
reset role;

-- ### a sees_full_queue mansione sees everything ###
set local role authenticated;
set local request.jwt.claim.sub = '00000026-0000-0000-0000-000000000a03';
select is(
  (select count(*)::int from guest_requests),
  3,
  'Reception (sees_full_queue) sees all three requests regardless of mansione'
);
reset role;

-- ### Core admin rank does not bypass operational routing ###
set local role authenticated;
set local request.jwt.claim.sub = '00000026-0000-0000-0000-000000000a04';
select is(
  (select count(*)::int from guest_requests),
  0,
  'property_admin without an operational mansione does not bypass the queue filter'
);
reset role;

-- ### fails closed: no job title assigned at all ###
set local role authenticated;
set local request.jwt.claim.sub = '00000026-0000-0000-0000-000000000a05';
select is(
  (select count(*)::int from guest_requests),
  0,
  'an operatore with no job title assigned sees 0 requests -- fails closed, not open'
);
reset role;

select * from finish();
rollback;
