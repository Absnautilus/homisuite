-- 20260917120000_request_categories_job_titles: admin-only write access to
-- the new category<->mansione links and to a job title's sees_full_queue
-- flag, same shape as request_categories_admin_write/property_job_titles_update
-- already use (admin/master or core.staff.manage respectively) -- an
-- operatore must not be able to grant themselves (or anyone) full-queue
-- visibility, or wire a category to whichever mansione they like.
begin;
create extension if not exists pgtap;
select plan(10);

insert into hotels (id, name, timezone, active) values
  ('00000057-0000-0000-0000-00000000ff01', 'Hotel Uno', 'Europe/Rome', true),
  ('00000057-0000-0000-0000-00000000ff02', 'Hotel Due', 'Europe/Rome', true);
select backfill_legacy_property_mapping();
select backfill_guest_requests_entitlement();

insert into request_categories (id, hotel_id, name) values
  ('00000057-0000-0000-0000-000000000c01', '00000057-0000-0000-0000-00000000ff01', 'Pulizie');

insert into property_job_titles (id, property_id, name)
select '00000057-0000-0000-0000-0000000aa001', m.platform_property_id, 'Governante'
from legacy_property_mapping m where m.legacy_hotel_id = '00000057-0000-0000-0000-00000000ff01';
insert into property_job_titles (id, property_id, name, active)
select '00000057-0000-0000-0000-0000000aa002', m.platform_property_id, 'Ex Mansione', false
from legacy_property_mapping m where m.legacy_hotel_id = '00000057-0000-0000-0000-00000000ff01';

insert into auth.users (id) values
  ('00000057-0000-0000-0000-000000000a01'), -- operatore @ Hotel Uno
  ('00000057-0000-0000-0000-000000000a02'), -- property_admin @ Hotel Uno
  ('00000057-0000-0000-0000-000000000a03'); -- operatore @ Hotel Due (different hotel)

insert into profiles (id, full_name) values
  ('00000057-0000-0000-0000-000000000a01', 'Operatore Uno'),
  ('00000057-0000-0000-0000-000000000a02', 'PA Uno'),
  ('00000057-0000-0000-0000-000000000a03', 'Operatore Due');

insert into staff_profiles (id, hotel_id, auth_user_id, name, role, department, active, login_username) values
  ('00000057-0000-0000-0000-000000000101', '00000057-0000-0000-0000-00000000ff01', '00000057-0000-0000-0000-000000000a01', 'Operatore Uno', 'operatore', 'housekeeping', true, 'test057.op1'),
  ('00000057-0000-0000-0000-000000000102', '00000057-0000-0000-0000-00000000ff01', '00000057-0000-0000-0000-000000000a02', 'PA Uno', 'admin', null, true, null),
  ('00000057-0000-0000-0000-000000000103', '00000057-0000-0000-0000-00000000ff02', '00000057-0000-0000-0000-000000000a03', 'Operatore Due', 'operatore', 'housekeeping', true, 'test057.op2');

insert into memberships (profile_id, property_id, role_id, status)
select '00000057-0000-0000-0000-000000000a01', m.platform_property_id, r.id, 'active'
from legacy_property_mapping m, roles r
where m.legacy_hotel_id = '00000057-0000-0000-0000-00000000ff01' and r.slug = 'receptionist';
insert into memberships (profile_id, property_id, role_id, status)
select '00000057-0000-0000-0000-000000000a02', m.platform_property_id, r.id, 'active'
from legacy_property_mapping m, roles r
where m.legacy_hotel_id = '00000057-0000-0000-0000-00000000ff01' and r.slug = 'property_admin';
insert into memberships (profile_id, property_id, role_id, status)
select '00000057-0000-0000-0000-000000000a03', m.platform_property_id, r.id, 'active'
from legacy_property_mapping m, roles r
where m.legacy_hotel_id = '00000057-0000-0000-0000-00000000ff02' and r.slug = 'receptionist';

-- ### an operatore cannot link a category to a mansione ###
-- unlike a filtered UPDATE/SELECT, a failing INSERT ... WITH CHECK raises a
-- hard RLS violation (42501) rather than silently matching zero rows.
set local role authenticated;
set local request.jwt.claim.sub = '00000057-0000-0000-0000-000000000a01';
select throws_ok(
  $$ insert into request_category_job_titles (category_id, job_title_id)
     values ('00000057-0000-0000-0000-000000000c01', '00000057-0000-0000-0000-0000000aa001') $$,
  '42501',
  null,
  'an operatore cannot link a category to a job title'
);
reset role;
select is(
  (select count(*)::int from request_category_job_titles where category_id = '00000057-0000-0000-0000-000000000c01'),
  0,
  'confirmed as superuser: no link was actually created'
);

-- ### an operatore cannot flip sees_full_queue on a job title ###
set local role authenticated;
set local request.jwt.claim.sub = '00000057-0000-0000-0000-000000000a01';
with upd as (
  update property_job_titles set sees_full_queue = true
  where id = '00000057-0000-0000-0000-0000000aa001'
  returning 1
)
select is((select count(*)::int from upd), 0, 'an operatore cannot set sees_full_queue on a job title');
reset role;
select is(
  (select sees_full_queue from property_job_titles where id = '00000057-0000-0000-0000-0000000aa001'),
  false,
  'confirmed as superuser: sees_full_queue is still false'
);

-- ### an admin CAN do both ###
set local role authenticated;
set local request.jwt.claim.sub = '00000057-0000-0000-0000-000000000a02';
select lives_ok(
  $$ insert into request_category_job_titles (category_id, job_title_id)
     values ('00000057-0000-0000-0000-000000000c01', '00000057-0000-0000-0000-0000000aa001') $$,
  'a property_admin can link a category to a job title'
);
select lives_ok(
  $$ update property_job_titles set sees_full_queue = true where id = '00000057-0000-0000-0000-0000000aa001' $$,
  'a property_admin can set sees_full_queue on a job title'
);
reset role;
select is(
  (select count(*)::int from request_category_job_titles where category_id = '00000057-0000-0000-0000-000000000c01'),
  1,
  'confirmed as superuser: the link now exists'
);
select is(
  (select sees_full_queue from property_job_titles where id = '00000057-0000-0000-0000-0000000aa001'),
  true,
  'confirmed as superuser: sees_full_queue is now true'
);

-- ### guest_requests_property_job_titles: the read bridge the admin UI's
-- mansioni multi-select uses -- active-only, any staff at the hotel, never
-- another hotel's job titles ###
set local role authenticated;
set local request.jwt.claim.sub = '00000057-0000-0000-0000-000000000a01';
select is(
  (select array_agg(name order by name) from guest_requests_property_job_titles('00000057-0000-0000-0000-00000000ff01')),
  array['Governante'],
  'an operatore at the hotel sees only the active job title, not the inactive one'
);
reset role;

set local role authenticated;
set local request.jwt.claim.sub = '00000057-0000-0000-0000-000000000a03';
select is(
  (select count(*)::int from guest_requests_property_job_titles('00000057-0000-0000-0000-00000000ff01')),
  0,
  'a staff member at a different hotel gets nothing back for this hotel''s job titles'
);
reset role;

select * from finish();
rollback;
