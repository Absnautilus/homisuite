-- 20260918120000_dining_admin_write_master_access: a master (organization_admin)
-- account must be able to manage the dining directory exactly like an admin
-- (property_admin) can -- regression test for the bug surfaced by manual
-- testing on Palazzo Veneziano, where a master account got a silent RLS
-- 42501 trying to create a category.
begin;
create extension if not exists pgtap;
select plan(4);

insert into hotels (id, name, timezone, active) values
  ('00000059-0000-0000-0000-00000000ff01', 'Hotel Con Dining', 'Europe/Rome', true);
select backfill_legacy_property_mapping();

insert into property_modules (property_id, module_id, enabled)
select m.platform_property_id, mo.id, true
from legacy_property_mapping m, modules mo
where m.legacy_hotel_id = '00000059-0000-0000-0000-00000000ff01' and mo.slug = 'dining';

insert into auth.users (id) values
  ('00000059-0000-0000-0000-000000000a01'); -- master @ Hotel Con Dining

insert into profiles (id, full_name) values
  ('00000059-0000-0000-0000-000000000a01', 'Master Uno');

insert into staff_profiles (id, hotel_id, auth_user_id, name, role, department, active, login_username) values
  ('00000059-0000-0000-0000-000000000101', '00000059-0000-0000-0000-00000000ff01', '00000059-0000-0000-0000-000000000a01', 'Master Uno', 'admin', null, true, null);

-- Org-wide membership, matching how a real master account is provisioned
-- (D2: master holds one organization_admin membership per organization).
insert into memberships (profile_id, organization_id, role_id, status)
select '00000059-0000-0000-0000-000000000a01', p.organization_id, r.id, 'active'
from legacy_property_mapping m
join properties p on p.id = m.platform_property_id, roles r
where m.legacy_hotel_id = '00000059-0000-0000-0000-00000000ff01' and r.slug = 'organization_admin';

set local role authenticated;
set local request.jwt.claim.sub = '00000059-0000-0000-0000-000000000a01';
select is(current_staff_role()::text, 'master', 'the fixture account resolves as master, not admin -- proving this test exercises the right role');
insert into dining_categories (id, hotel_id, name) values
  ('00000059-0000-0000-0000-000000000c01', '00000059-0000-0000-0000-00000000ff01', 'Fine dining');
reset role;
select is((select count(*)::int from dining_categories where id = '00000059-0000-0000-0000-000000000c01'), 1, 'a master account can create a dining category');

set local role authenticated;
set local request.jwt.claim.sub = '00000059-0000-0000-0000-000000000a01';
insert into restaurants (id, hotel_id, category_id, name) values
  ('00000059-0000-0000-0000-0000000da001', '00000059-0000-0000-0000-00000000ff01', '00000059-0000-0000-0000-000000000c01', 'Trattoria Da Mario');
insert into restaurant_hours (restaurant_id, day_of_week, opens_at, closes_at) values
  ('00000059-0000-0000-0000-0000000da001', 1, '12:00', '15:00');
reset role;
select is((select count(*)::int from restaurants where id = '00000059-0000-0000-0000-0000000da001'), 1, 'a master account can create a restaurant');
select is((select count(*)::int from restaurant_hours where restaurant_id = '00000059-0000-0000-0000-0000000da001'), 1, 'a master account can add opening hours');

select * from finish();
rollback;
