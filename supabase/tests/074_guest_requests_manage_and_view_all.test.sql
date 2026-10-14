-- 20261014090000_guest_requests_manage_and_view_all: two new module-scoped
-- permissions for Housekeeping, delegable the same way as dining.manage /
-- shifts.manage. Covers:
--   - the real gap this migration closes: request_categories/request_types/
--     request_category_job_titles admin-write policies used to check
--     current_staff_role() = 'admin', a no-op since grant-housekeeping-access
--     always bridges members in with role 'admin' regardless of their real
--     Homisuite role -- now gated by the real, delegable guest_requests.manage;
--   - guest_requests.view_all as a purely additive OR-branch alongside the
--     existing housekeeping_department = 'reception' field, which keeps
--     working completely unchanged for anyone who already has it set
--     (compatibility with the legacy mechanism).
begin;
create extension if not exists pgtap;
select plan(14);

insert into hotels (id, name, timezone, active) values
  ('00000074-0000-0000-0000-00000000ff01', 'Hotel Settantaquattro', 'Europe/Rome', true);
select backfill_legacy_property_mapping();
select backfill_guest_requests_entitlement();

insert into request_categories (id, hotel_id, name, department) values
  ('00000074-0000-0000-0000-000000000c01', '00000074-0000-0000-0000-00000000ff01', 'Housekeeping', 'housekeeping');

-- property_admin: holds guest_requests.manage/view_all by role (default
-- holder, same pattern as dining.manage). current_staff_hotel() requires an
-- active staff_profiles row regardless of Core permissions (true before
-- this migration too, via the old current_staff_role() check) -- bridged
-- here exactly as grant-housekeeping-access would for any real admin who
-- actually works inside the Housekeeping module.
insert into auth.users (id) values ('00000074-0000-0000-0000-000000000a01');
insert into profiles (id, full_name) values ('00000074-0000-0000-0000-000000000a01', 'Property Admin 74');
insert into staff_profiles (id, hotel_id, auth_user_id, name, role, department, active, on_duty) values
  ('00000074-0000-0000-0000-000000000101', '00000074-0000-0000-0000-00000000ff01', '00000074-0000-0000-0000-000000000a01', 'Property Admin 74', 'admin', null, true, true);
insert into memberships (id, profile_id, property_id, role_id, status)
select '00000074-0000-0000-0000-000000000101', '00000074-0000-0000-0000-000000000a01', m.platform_property_id, r.id, 'active'
from legacy_property_mapping m, roles r
where m.legacy_hotel_id = '00000074-0000-0000-0000-00000000ff01' and r.slug = 'property_admin';

-- the Team-bridged member: receptionist-rank Core membership, but
-- staff_profiles.role forced to 'admin' by grant-housekeeping-access, as it
-- always is -- exactly the shape that made the legacy RLS check a no-op.
insert into auth.users (id) values ('00000074-0000-0000-0000-000000000a02');
insert into profiles (id, full_name) values ('00000074-0000-0000-0000-000000000a02', 'Bridged Member 74');
insert into staff_profiles (id, hotel_id, auth_user_id, name, role, department, active, on_duty) values
  ('00000074-0000-0000-0000-000000000102', '00000074-0000-0000-0000-00000000ff01', '00000074-0000-0000-0000-000000000a02', 'Bridged Member 74', 'admin', null, true, true);
insert into memberships (id, profile_id, property_id, role_id, status)
select '00000074-0000-0000-0000-000000000202', '00000074-0000-0000-0000-000000000a02', m.platform_property_id, r.id, 'active'
from legacy_property_mapping m, roles r
where m.legacy_hotel_id = '00000074-0000-0000-0000-00000000ff01' and r.slug = 'receptionist';

-- ### the gap this migration closes: before any grant, the bridged member
--     (legacy role forced to 'admin', real Core role receptionist) cannot
--     write to request_categories -- proves the old current_staff_role() =
--     'admin' check really was a no-op being replaced, not a real
--     regression ###
set local role authenticated;
set local request.jwt.claim.sub = '00000074-0000-0000-0000-000000000a02';
with upd as (
  update request_categories set name = 'Hacked' where id = '00000074-0000-0000-0000-000000000c01' returning 1
)
select is((select count(*)::int from upd), 0, 'bridged member without guest_requests.manage cannot rename a request category, despite legacy staff_profiles.role being admin');
reset role;

-- ### property_admin, who holds guest_requests.manage by role, can write ###
set local role authenticated;
set local request.jwt.claim.sub = '00000074-0000-0000-0000-000000000a01';
update request_categories set name = 'Housekeeping (rinominata)' where id = '00000074-0000-0000-0000-000000000c01';
select is(
  (select name from request_categories where id = '00000074-0000-0000-0000-000000000c01'),
  'Housekeeping (rinominata)',
  'property_admin, holding guest_requests.manage by role, can rename a request category'
);
reset role;

-- ### property_admin delegates guest_requests.manage to the bridged member ###
set local role authenticated;
set local request.jwt.claim.sub = '00000074-0000-0000-0000-000000000a01';
select lives_ok(
  $$ select grant_member_permission('00000074-0000-0000-0000-000000000202', 'guest_requests.manage') $$,
  'property_admin can delegate guest_requests.manage to the bridged member'
);
reset role;

set local role authenticated;
set local request.jwt.claim.sub = '00000074-0000-0000-0000-000000000a02';
update request_categories set name = 'Rinominata dal membro delegato' where id = '00000074-0000-0000-0000-000000000c01';
select is(
  (select name from request_categories where id = '00000074-0000-0000-0000-000000000c01'),
  'Rinominata dal membro delegato',
  'the bridged member can now rename a request category via the delegated permission'
);
reset role;

-- ### guest_requests.view_all: before any grant, no override, no legacy
--     field, no sees_full_queue mansione -- does not see the full queue ###
set local role authenticated;
set local request.jwt.claim.sub = '00000074-0000-0000-0000-000000000a02';
select ok(
  not current_staff_sees_full_queue(),
  'bridged member sees only their mansione-scoped queue before guest_requests.view_all is granted'
);
reset role;

-- ### property_admin grants guest_requests.view_all ###
set local role authenticated;
set local request.jwt.claim.sub = '00000074-0000-0000-0000-000000000a01';
select lives_ok(
  $$ select grant_member_permission('00000074-0000-0000-0000-000000000202', 'guest_requests.view_all') $$,
  'property_admin can grant guest_requests.view_all to the bridged member'
);
reset role;

set local role authenticated;
set local request.jwt.claim.sub = '00000074-0000-0000-0000-000000000a02';
select ok(
  current_staff_sees_full_queue(),
  'bridged member now sees the full queue via guest_requests.view_all, with no legacy field touched'
);
reset role;

select is(
  (select housekeeping_department from property_staff_details where profile_id = '00000074-0000-0000-0000-000000000a02'),
  null,
  'guest_requests.view_all does not write to housekeeping_department -- no row exists for this member at all'
);

-- ### revoke: full-queue visibility goes away again ###
set local role authenticated;
set local request.jwt.claim.sub = '00000074-0000-0000-0000-000000000a01';
select lives_ok(
  $$ select revoke_member_permission('00000074-0000-0000-0000-000000000202', 'guest_requests.view_all') $$,
  'property_admin can revoke guest_requests.view_all'
);
reset role;

set local role authenticated;
set local request.jwt.claim.sub = '00000074-0000-0000-0000-000000000a02';
select ok(
  not current_staff_sees_full_queue(),
  'bridged member no longer sees the full queue after the revoke'
);
reset role;

-- ### compatibility: a different member using the EXISTING legacy field
--     (housekeeping_department = 'reception') is completely unaffected by
--     this migration -- still sees the full queue with zero
--     guest_requests.view_all grant ###
insert into auth.users (id) values ('00000074-0000-0000-0000-000000000a03');
insert into profiles (id, full_name) values ('00000074-0000-0000-0000-000000000a03', 'Legacy Reception Member 74');
insert into staff_profiles (id, hotel_id, auth_user_id, name, role, department, active, on_duty) values
  ('00000074-0000-0000-0000-000000000103', '00000074-0000-0000-0000-00000000ff01', '00000074-0000-0000-0000-000000000a03', 'Legacy Reception Member 74', 'admin', null, true, true);
insert into memberships (id, profile_id, property_id, role_id, status)
select '00000074-0000-0000-0000-000000000203', '00000074-0000-0000-0000-000000000a03', m.platform_property_id, r.id, 'active'
from legacy_property_mapping m, roles r
where m.legacy_hotel_id = '00000074-0000-0000-0000-00000000ff01' and r.slug = 'receptionist';
insert into property_staff_details (property_id, profile_id, housekeeping_department)
select m.platform_property_id, '00000074-0000-0000-0000-000000000a03', 'reception'
from legacy_property_mapping m where m.legacy_hotel_id = '00000074-0000-0000-0000-00000000ff01';

set local role authenticated;
set local request.jwt.claim.sub = '00000074-0000-0000-0000-000000000a03';
select ok(
  current_staff_sees_full_queue(),
  'a member with the pre-existing legacy housekeeping_department=reception field still sees the full queue, unaffected by this migration'
);
reset role;

-- ### housekeeping_push_recipient_profiles: a candidate holding
--     guest_requests.view_all is included; one with neither the permission
--     nor the legacy field/mansione is excluded ###
set local role authenticated;
set local request.jwt.claim.sub = '00000074-0000-0000-0000-000000000a01';
select lives_ok(
  $$ select grant_member_permission('00000074-0000-0000-0000-000000000202', 'guest_requests.view_all') $$,
  'property_admin re-grants guest_requests.view_all for the push-recipients check below'
);
reset role;

select ok(
  '00000074-0000-0000-0000-000000000a02' in (
    select profile_id from housekeeping_push_recipient_profiles('00000074-0000-0000-0000-00000000ff01')
  ),
  'the member with guest_requests.view_all is included as a push recipient'
);
select ok(
  '00000074-0000-0000-0000-000000000a01' not in (
    select profile_id from housekeeping_push_recipient_profiles('00000074-0000-0000-0000-00000000ff01')
  ),
  'property_admin (guest_requests.manage, not a staff_profiles row at all) is not a push recipient -- Core admin rank alone never qualifies'
);

select * from finish();
rollback;
