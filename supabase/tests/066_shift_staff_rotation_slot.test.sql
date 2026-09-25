-- 20260925090000_shift_staff_rotation_slot: rotation_slot is the stable
-- per-employee anchor the rest-day rotation algorithm needs. Two profiles at
-- the same property must never share a slot (they'd get identical rest
-- days), but the same slot number is fine across two different properties,
-- and the column stays null until "Imposta riposi" first assigns one.
begin;
create extension if not exists pgtap;
select plan(6);

insert into organizations (id, name, slug) values
  ('00000066-0000-0000-0000-000000000001', 'Rotation Slot Org', 'test-066-org');

insert into properties (id, organization_id, name, slug) values
  ('00000066-0000-0000-0000-000000000011', '00000066-0000-0000-0000-000000000001', 'Rotation Slot Property A', 'rotation-slot-a'),
  ('00000066-0000-0000-0000-000000000012', '00000066-0000-0000-0000-000000000001', 'Rotation Slot Property B', 'rotation-slot-b');

insert into auth.users (id, email) values
  ('00000066-0000-0000-0000-000000000041', 'staff-a1-066@example.com'),
  ('00000066-0000-0000-0000-000000000042', 'staff-a2-066@example.com'),
  ('00000066-0000-0000-0000-000000000043', 'staff-b1-066@example.com');

insert into profiles (id, full_name) values
  ('00000066-0000-0000-0000-000000000041', 'Staff A1'),
  ('00000066-0000-0000-0000-000000000042', 'Staff A2'),
  ('00000066-0000-0000-0000-000000000043', 'Staff B1');

-- property_staff_details_validate_job_title requires a membership at the
-- property (or its organization) before a staff-details row can reference
-- the profile.
insert into memberships (profile_id, property_id, organization_id, role_id, status)
select fixture.profile_id, fixture.property_id, null::uuid, role.id, 'active'
from (values
  ('00000066-0000-0000-0000-000000000041'::uuid, '00000066-0000-0000-0000-000000000011'::uuid),
  ('00000066-0000-0000-0000-000000000042'::uuid, '00000066-0000-0000-0000-000000000011'::uuid),
  ('00000066-0000-0000-0000-000000000043'::uuid, '00000066-0000-0000-0000-000000000012'::uuid)
) as fixture(profile_id, property_id)
join roles role on role.slug = 'receptionist';

insert into property_staff_details (property_id, profile_id) values
  ('00000066-0000-0000-0000-000000000011', '00000066-0000-0000-0000-000000000041'),
  ('00000066-0000-0000-0000-000000000011', '00000066-0000-0000-0000-000000000042'),
  ('00000066-0000-0000-0000-000000000012', '00000066-0000-0000-0000-000000000043');

insert into shift_staff_profiles (id, property_id, profile_id, shift_type) values
  ('00000066-0000-0000-0000-000000000081', '00000066-0000-0000-0000-000000000011', '00000066-0000-0000-0000-000000000041', 'rotating'),
  ('00000066-0000-0000-0000-000000000082', '00000066-0000-0000-0000-000000000011', '00000066-0000-0000-0000-000000000042', 'rotating'),
  ('00000066-0000-0000-0000-000000000083', '00000066-0000-0000-0000-000000000012', '00000066-0000-0000-0000-000000000043', 'rotating');

-- ### column exists, starts null ###
select is(
  (select rotation_slot from shift_staff_profiles where id = '00000066-0000-0000-0000-000000000081'),
  null,
  'rotation_slot starts unassigned'
);

-- ### a negative slot is rejected ###
select throws_ok(
  $$update shift_staff_profiles set rotation_slot = -1 where id = '00000066-0000-0000-0000-000000000081'$$,
  '23514', null,
  'rotation_slot cannot be negative'
);

-- ### assigning a slot succeeds ###
select lives_ok(
  $$update shift_staff_profiles set rotation_slot = 0 where id = '00000066-0000-0000-0000-000000000081'$$,
  'assigning a non-negative rotation_slot succeeds'
);

-- ### two profiles at the same property cannot share a slot ###
select throws_ok(
  $$update shift_staff_profiles set rotation_slot = 0 where id = '00000066-0000-0000-0000-000000000082'$$,
  '23505', null,
  'two rotating profiles at the same property cannot share a rotation_slot'
);

-- ### the same slot number is fine at a different property ###
select lives_ok(
  $$update shift_staff_profiles set rotation_slot = 0 where id = '00000066-0000-0000-0000-000000000083'$$,
  'the same rotation_slot number is independent across properties'
);

-- ### clearing one back to null coexists with another already-null row ###
-- (profile 082 never got a slot: its earlier attempt above failed and left
-- it null, so clearing 081 too puts two null rows at the same property.)
select lives_ok(
  $$update shift_staff_profiles set rotation_slot = null where id = '00000066-0000-0000-0000-000000000081'$$,
  'multiple profiles at the same property may stay unassigned at once'
);

select * from finish();
rollback;
