-- 20260921200000_housekeeping_push_consolidation: Web Push recipients
-- must match the post-Shell request visibility model rather than legacy
-- staff_profiles.role/department, and only one INSERT webhook may remain.
begin;
create extension if not exists pgtap;
select plan(11);

insert into hotels (id, name, timezone, active) values
  ('00000063-0000-0000-0000-00000000ff01', 'Hotel Sessantatre', 'Europe/Rome', true);
select backfill_legacy_property_mapping();
select backfill_guest_requests_entitlement();

insert into auth.users (id) values
  ('00000063-0000-0000-0000-000000000a01'),
  ('00000063-0000-0000-0000-000000000a02'),
  ('00000063-0000-0000-0000-000000000a03'),
  ('00000063-0000-0000-0000-000000000a04'),
  ('00000063-0000-0000-0000-000000000a05'),
  ('00000063-0000-0000-0000-000000000a06'),
  ('00000063-0000-0000-0000-000000000a07');

insert into profiles (id, full_name) values
  ('00000063-0000-0000-0000-000000000a01', 'Matched Mansione'),
  ('00000063-0000-0000-0000-000000000a02', 'Other Mansione'),
  ('00000063-0000-0000-0000-000000000a03', 'Full Queue Mansione'),
  ('00000063-0000-0000-0000-000000000a04', 'Property Admin'),
  ('00000063-0000-0000-0000-000000000a05', 'Per Member Override'),
  ('00000063-0000-0000-0000-000000000a06', 'Off Duty'),
  ('00000063-0000-0000-0000-000000000a07', 'Property Admin With Override');

insert into memberships (profile_id, property_id, role_id, status)
select p.profile_id, m.platform_property_id, r.id, 'active'
from (
  values
    ('00000063-0000-0000-0000-000000000a01'::uuid, 'receptionist'),
    ('00000063-0000-0000-0000-000000000a02'::uuid, 'receptionist'),
    ('00000063-0000-0000-0000-000000000a03'::uuid, 'receptionist'),
    ('00000063-0000-0000-0000-000000000a04'::uuid, 'property_admin'),
    ('00000063-0000-0000-0000-000000000a05'::uuid, 'receptionist'),
    ('00000063-0000-0000-0000-000000000a06'::uuid, 'receptionist'),
    ('00000063-0000-0000-0000-000000000a07'::uuid, 'property_admin')
) as p(profile_id, role_slug)
join legacy_property_mapping m on m.legacy_hotel_id = '00000063-0000-0000-0000-00000000ff01'
join roles r on r.slug = p.role_slug;

insert into property_job_titles (id, property_id, name, sees_full_queue)
select v.id, m.platform_property_id, v.name, v.sees_full_queue
from (
  values
    ('00000063-0000-0000-0000-00000000aa01'::uuid, 'Piani', false),
    ('00000063-0000-0000-0000-00000000aa02'::uuid, 'Manutenzione', false),
    ('00000063-0000-0000-0000-00000000aa03'::uuid, 'Reception', true)
) as v(id, name, sees_full_queue)
join legacy_property_mapping m on m.legacy_hotel_id = '00000063-0000-0000-0000-00000000ff01';

-- Shell-bridged users deliberately all look like legacy admins, including
-- rank-10 receptionists. Recipient selection must ignore that compatibility
-- role and use Core/mansione state.
insert into staff_profiles (id, hotel_id, auth_user_id, name, role, department, active, on_duty) values
  ('00000063-0000-0000-0000-000000000101', '00000063-0000-0000-0000-00000000ff01', '00000063-0000-0000-0000-000000000a01', 'Matched Mansione', 'admin', null, true, true),
  ('00000063-0000-0000-0000-000000000102', '00000063-0000-0000-0000-00000000ff01', '00000063-0000-0000-0000-000000000a02', 'Other Mansione', 'admin', null, true, true),
  ('00000063-0000-0000-0000-000000000103', '00000063-0000-0000-0000-00000000ff01', '00000063-0000-0000-0000-000000000a03', 'Full Queue Mansione', 'admin', null, true, true),
  ('00000063-0000-0000-0000-000000000104', '00000063-0000-0000-0000-00000000ff01', '00000063-0000-0000-0000-000000000a04', 'Property Admin', 'admin', null, true, true),
  ('00000063-0000-0000-0000-000000000105', '00000063-0000-0000-0000-00000000ff01', '00000063-0000-0000-0000-000000000a05', 'Per Member Override', 'admin', null, true, true),
  ('00000063-0000-0000-0000-000000000106', '00000063-0000-0000-0000-00000000ff01', '00000063-0000-0000-0000-000000000a06', 'Off Duty', 'admin', null, true, false),
  ('00000063-0000-0000-0000-000000000107', '00000063-0000-0000-0000-00000000ff01', '00000063-0000-0000-0000-000000000a07', 'Property Admin With Override', 'admin', null, true, true);

insert into property_staff_details (property_id, profile_id, job_title_id, housekeeping_department)
select m.platform_property_id, v.profile_id, v.job_title_id, v.housekeeping_department::department
from (
  values
    ('00000063-0000-0000-0000-000000000a01'::uuid, '00000063-0000-0000-0000-00000000aa01'::uuid, null::text),
    ('00000063-0000-0000-0000-000000000a02'::uuid, '00000063-0000-0000-0000-00000000aa02'::uuid, null::text),
    ('00000063-0000-0000-0000-000000000a03'::uuid, '00000063-0000-0000-0000-00000000aa03'::uuid, null::text),
    ('00000063-0000-0000-0000-000000000a04'::uuid, null::uuid, null::text),
    ('00000063-0000-0000-0000-000000000a05'::uuid, '00000063-0000-0000-0000-00000000aa02'::uuid, 'reception'),
    ('00000063-0000-0000-0000-000000000a06'::uuid, '00000063-0000-0000-0000-00000000aa01'::uuid, null::text),
    ('00000063-0000-0000-0000-000000000a07'::uuid, null::uuid, 'reception')
) as v(profile_id, job_title_id, housekeeping_department)
join legacy_property_mapping m on m.legacy_hotel_id = '00000063-0000-0000-0000-00000000ff01';

select ok(
  '00000063-0000-0000-0000-000000000a01'::uuid in (
    select profile_id from housekeeping_push_recipient_profiles(
      '00000063-0000-0000-0000-00000000ff01',
      array['00000063-0000-0000-0000-00000000aa01'::uuid],
      null
    )
  ),
  'an on-duty member whose mansione is assigned receives the push'
);

select ok(
  '00000063-0000-0000-0000-000000000a02'::uuid not in (
    select profile_id from housekeeping_push_recipient_profiles(
      '00000063-0000-0000-0000-00000000ff01',
      array['00000063-0000-0000-0000-00000000aa01'::uuid],
      null
    )
  ),
  'an unrelated mansione does not receive the push'
);

select ok(
  '00000063-0000-0000-0000-000000000a03'::uuid in (
    select profile_id from housekeeping_push_recipient_profiles(
      '00000063-0000-0000-0000-00000000ff01',
      array['00000063-0000-0000-0000-00000000aa01'::uuid],
      null
    )
  ),
  'a sees_full_queue mansione receives the push'
);

-- 20260922080000_housekeeping_push_recipients_visibility_realignment:
-- Core admin rank alone is no longer an operational-visibility signal (see
-- guest_requests_select_hotel's own model, which dropped the same bypass).
-- A property_admin with no reception override, no sees_full_queue mansione,
-- and no assigned-mansione match must not receive the push.
select ok(
  '00000063-0000-0000-0000-000000000a04'::uuid not in (
    select profile_id from housekeeping_push_recipient_profiles(
      '00000063-0000-0000-0000-00000000ff01',
      array['00000063-0000-0000-0000-00000000aa01'::uuid],
      null
    )
  ),
  'a Core property_admin without operational Reception/full-queue visibility does not receive the push'
);

select ok(
  '00000063-0000-0000-0000-000000000a07'::uuid in (
    select profile_id from housekeeping_push_recipient_profiles(
      '00000063-0000-0000-0000-00000000ff01',
      array['00000063-0000-0000-0000-00000000aa01'::uuid],
      null
    )
  ),
  'a Core property_admin who also holds the per-member reception override still receives the push, via that override -- not via admin rank'
);

select ok(
  '00000063-0000-0000-0000-000000000a05'::uuid in (
    select profile_id from housekeeping_push_recipient_profiles(
      '00000063-0000-0000-0000-00000000ff01',
      array['00000063-0000-0000-0000-00000000aa01'::uuid],
      null
    )
  ),
  'the per-member full-queue override receives the push'
);

select ok(
  '00000063-0000-0000-0000-000000000a06'::uuid not in (
    select profile_id from housekeeping_push_recipient_profiles(
      '00000063-0000-0000-0000-00000000ff01',
      array['00000063-0000-0000-0000-00000000aa01'::uuid],
      null
    )
  ),
  'an off-duty member is excluded even when their mansione matches'
);

select ok(
  '00000063-0000-0000-0000-000000000a01'::uuid not in (
    select profile_id from housekeeping_push_recipient_profiles(
      '00000063-0000-0000-0000-00000000ff01',
      array['00000063-0000-0000-0000-00000000aa01'::uuid],
      '00000063-0000-0000-0000-000000000101'
    )
  ),
  'the staff creator can be excluded without dropping notifications for everybody else'
);

select is(
  (select count(*)::int from pg_trigger where tgrelid='public.guest_requests'::regclass and tgname='notify-new-request' and not tgisinternal),
  0,
  'the duplicate dashboard-created INSERT webhook trigger is removed'
);

select is(
  (select count(*)::int from pg_trigger where tgrelid='public.guest_requests'::regclass and tgname='guest_requests_notify_after_insert' and not tgisinternal and tgenabled='O'),
  1,
  'the versioned pg_net INSERT trigger remains enabled'
);

select ok(
  not has_function_privilege('anon', 'housekeeping_push_recipient_profiles(uuid,uuid[],uuid)', 'EXECUTE'),
  'the push recipient resolver is not callable by anon'
);

select * from finish();
rollback;
