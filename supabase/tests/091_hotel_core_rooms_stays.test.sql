-- Hotel Core inventory must work without the Housekeeping entitlement.
begin;
create extension if not exists pgtap;
select plan(12);

insert into hotels (id,name,timezone,active) values
 ('00000092-0000-0000-0000-00000000ff01','Core Only A','Europe/Rome',true),
 ('00000092-0000-0000-0000-00000000ff02','Core Only B','Europe/Rome',true);
select backfill_legacy_property_mapping();
insert into auth.users(id) values
 ('00000092-0000-0000-0000-000000000a01'),
 ('00000092-0000-0000-0000-000000000a02');
insert into profiles(id,full_name) values
 ('00000092-0000-0000-0000-000000000a01','Core Admin'),
 ('00000092-0000-0000-0000-000000000a02','Core Reception');
insert into memberships(id,profile_id,property_id,role_id,status)
select '00000092-0000-0000-0000-0000000d0001',
 '00000092-0000-0000-0000-000000000a01',m.platform_property_id,r.id,'active'
from legacy_property_mapping m,roles r
where m.legacy_hotel_id='00000092-0000-0000-0000-00000000ff01'
and r.slug='property_admin';
insert into memberships(id,profile_id,property_id,role_id,status)
select '00000092-0000-0000-0000-0000000d0002',
 '00000092-0000-0000-0000-000000000a02',m.platform_property_id,r.id,'active'
from legacy_property_mapping m,roles r
where m.legacy_hotel_id='00000092-0000-0000-0000-00000000ff01'
and r.slug='receptionist';

-- No guest_requests entitlement is enabled for either fixture property.
select is(
 (select count(*)::int from property_modules pm join modules mo on mo.id=pm.module_id
 join legacy_property_mapping lm on lm.platform_property_id=pm.property_id
 where lm.legacy_hotel_id='00000092-0000-0000-0000-00000000ff01'
 and mo.slug='guest_requests' and pm.enabled),0,
 'Housekeeping is disabled');

select platform_property_id as core_property_a from legacy_property_mapping where legacy_hotel_id='00000092-0000-0000-0000-00000000ff01' \gset
select platform_property_id as core_property_b from legacy_property_mapping where legacy_hotel_id='00000092-0000-0000-0000-00000000ff02' \gset
set local role authenticated;
set local request.jwt.claim.sub='00000092-0000-0000-0000-000000000a01';
select is(
 core_hotel_id_for_property(:'core_property_a'::uuid),
 '00000092-0000-0000-0000-00000000ff01'::uuid,
 'Core admin resolves the hotel without module entitlement');
select lives_ok(
 $$insert into rooms(id,hotel_id,room_number)
 values('00000092-0000-0000-0000-00000000aa01','00000092-0000-0000-0000-00000000ff01','101')$$,
 'Core admin creates room with Housekeeping disabled');
select lives_ok(
 $$insert into stays(hotel_id,room_id,guest_last_name,check_in_at,check_out_at)
 values('00000092-0000-0000-0000-00000000ff01','00000092-0000-0000-0000-00000000aa01','Core Guest',now(),now()+interval '1 day')$$,
 'Core admin creates stay with Housekeeping disabled');
select is(
 (select count(*)::int from stays where hotel_id='00000092-0000-0000-0000-00000000ff01'),1,
 'Core admin reads its stay');

select is(
 core_hotel_id_for_property(:'core_property_b'::uuid),
 null::uuid, 'Core admin cannot resolve a different organization property');

-- A Core administrator may manage only their own mapped hotel.
select is(
 (select count(*)::int from rooms where hotel_id='00000092-0000-0000-0000-00000000ff02'),
 0, 'Core admin cannot read another hotel inventory');
select throws_ok(
 $insert into rooms(hotel_id,room_number)
 values('00000092-0000-0000-0000-00000000ff02','CROSS-HOTEL')$,
 '42501',null,'Core admin cannot insert rooms into another hotel');
select is(
 (select count(*)::int from stays where hotel_id='00000092-0000-0000-0000-00000000ff02'),
 0, 'Core admin cannot read another hotel stays');

set local request.jwt.claim.sub='00000092-0000-0000-0000-000000000a02';
select is(
 core_hotel_id_for_property(:'core_property_a'::uuid),
 null::uuid,'receptionist without core.property.manage cannot use management bridge');
select is((select count(*)::int from stays where hotel_id='00000092-0000-0000-0000-00000000ff01'),0,
 'receptionist cannot read Core stays without management permission or Housekeeping entitlement');
select throws_ok(
 $$insert into rooms(hotel_id,room_number) values('00000092-0000-0000-0000-00000000ff01','DENIED')$$,
 '42501',null,'receptionist cannot create Core rooms');
select * from finish();
rollback;
