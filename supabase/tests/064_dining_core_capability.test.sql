-- 20260922080500_dining_core_capability: Dining's admin-write policies now
-- check has_permission(property_id, 'dining.manage') instead of hard-coding
-- current_staff_role() in ('admin', 'master'). 058/059/060 already exercise
-- the resulting read/write behavior end-to-end (property_admin can write,
-- organization_admin/"master" can write, a non-admin operatore cannot, a
-- disabled module blocks writes too) -- this file checks the capability
-- wiring itself: the permission exists on the right module, is granted to
-- exactly the two roles that used to qualify as admin/master, and the
-- hotel_id -> property_id resolver behaves.
begin;
create extension if not exists pgtap;
select plan(5);

select ok(
  exists (
    select 1 from permissions p
    join modules m on m.id = p.module_id
    where p.slug = 'dining.manage' and m.slug = 'dining'
  ),
  'dining.manage is a permission scoped to the dining module'
);

select set_eq(
  $$ select r.slug from role_permissions rp join roles r on r.id = rp.role_id join permissions p on p.id = rp.permission_id where p.slug = 'dining.manage' $$,
  array['property_admin', 'organization_admin'],
  'dining.manage is granted to exactly property_admin and organization_admin -- the old admin/master equivalence, nothing wider'
);

insert into hotels (id, name, timezone, active) values
  ('00000064-0000-0000-0000-00000000ff01', 'Hotel Sessantaquattro', 'Europe/Rome', true);
select backfill_legacy_property_mapping();

select is(
  legacy_hotel_property_id('00000064-0000-0000-0000-00000000ff01'),
  (select platform_property_id from legacy_property_mapping where legacy_hotel_id = '00000064-0000-0000-0000-00000000ff01'),
  'legacy_hotel_property_id resolves the same property_id legacy_property_mapping carries'
);

select is(
  legacy_hotel_property_id('00000000-0000-0000-0000-000000000000'),
  null::uuid,
  'legacy_hotel_property_id returns null for a hotel_id with no mapping'
);

select ok(
  not has_function_privilege('anon', 'legacy_hotel_property_id(uuid)', 'EXECUTE'),
  'legacy_hotel_property_id is not callable by anon'
);

select * from finish();
rollback;
