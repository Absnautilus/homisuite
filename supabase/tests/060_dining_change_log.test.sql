-- 20260918130000_dining_change_log: trigger-based audit log for the Dining
-- module -- every insert/update/delete on dining_categories, restaurants,
-- restaurant_hours, and restaurant_reservation_requests must produce a
-- readable, actor-attributed row, and only staff who manage front desk may
-- read it. No client role may write to the log directly (trigger-only,
-- via SECURITY DEFINER).
begin;
create extension if not exists pgtap;
select plan(11);

insert into hotels (id, name, timezone, active) values
  ('00000060-0000-0000-0000-00000000ff01', 'Hotel Con Dining', 'Europe/Rome', true);
select backfill_legacy_property_mapping();

insert into property_modules (property_id, module_id, enabled)
select m.platform_property_id, mo.id, true
from legacy_property_mapping m, modules mo
where m.legacy_hotel_id = '00000060-0000-0000-0000-00000000ff01' and mo.slug = 'dining';

insert into auth.users (id) values
  ('00000060-0000-0000-0000-000000000a01'), -- admin @ Hotel Con Dining
  ('00000060-0000-0000-0000-000000000a02'), -- housekeeping operatore @ same hotel
  ('00000060-0000-0000-0000-000000000a03'); -- reception operatore @ same hotel

insert into profiles (id, full_name) values
  ('00000060-0000-0000-0000-000000000a01', 'Admin Uno'),
  ('00000060-0000-0000-0000-000000000a02', 'Housekeeping Due'),
  ('00000060-0000-0000-0000-000000000a03', 'Reception Tre');

insert into staff_profiles (id, hotel_id, auth_user_id, name, role, department, active, login_username) values
  ('00000060-0000-0000-0000-000000000101', '00000060-0000-0000-0000-00000000ff01', '00000060-0000-0000-0000-000000000a01', 'Admin Uno', 'admin', null, true, null),
  ('00000060-0000-0000-0000-000000000102', '00000060-0000-0000-0000-00000000ff01', '00000060-0000-0000-0000-000000000a02', 'Housekeeping Due', 'operatore', 'housekeeping', true, 'test060.hk'),
  ('00000060-0000-0000-0000-000000000103', '00000060-0000-0000-0000-00000000ff01', '00000060-0000-0000-0000-000000000a03', 'Reception Tre', 'operatore', 'reception', true, 'test060.rec');

insert into memberships (profile_id, property_id, role_id, status)
select '00000060-0000-0000-0000-000000000a01', m.platform_property_id, r.id, 'active'
from legacy_property_mapping m, roles r
where m.legacy_hotel_id = '00000060-0000-0000-0000-00000000ff01' and r.slug = 'property_admin';
insert into memberships (profile_id, property_id, role_id, status)
select '00000060-0000-0000-0000-000000000a02', m.platform_property_id, r.id, 'active'
from legacy_property_mapping m, roles r
where m.legacy_hotel_id = '00000060-0000-0000-0000-00000000ff01' and r.slug = 'receptionist';
insert into memberships (profile_id, property_id, role_id, status)
select '00000060-0000-0000-0000-000000000a03', m.platform_property_id, r.id, 'active'
from legacy_property_mapping m, roles r
where m.legacy_hotel_id = '00000060-0000-0000-0000-00000000ff01' and r.slug = 'receptionist';

-- ### admin builds the directory -- each write must log itself ###
set local role authenticated;
set local request.jwt.claim.sub = '00000060-0000-0000-0000-000000000a01';
insert into dining_categories (id, hotel_id, name) values
  ('00000060-0000-0000-0000-000000000c01', '00000060-0000-0000-0000-00000000ff01', 'Fine dining');
insert into restaurants (id, hotel_id, category_id, name) values
  ('00000060-0000-0000-0000-0000000da001', '00000060-0000-0000-0000-00000000ff01', '00000060-0000-0000-0000-000000000c01', 'Trattoria Da Mario');
insert into restaurant_hours (id, restaurant_id, day_of_week, opens_at, closes_at) values
  ('00000060-0000-0000-0000-0000000ea001', '00000060-0000-0000-0000-0000000da001', 1, '12:00', '15:00');
update dining_categories set name = 'Alta cucina' where id = '00000060-0000-0000-0000-000000000c01';
reset role;

select is(
  (select summary from dining_change_log where entity_type = 'category' and action = 'created'),
  'Categoria "Fine dining" creata',
  'creating a category logs a readable summary'
);
select is(
  (select actor_name from dining_change_log where entity_type = 'category' and action = 'created'),
  'Admin Uno',
  'the log attributes the category creation to the acting profile by name'
);
select is(
  (select summary from dining_change_log where entity_type = 'category' and action = 'updated'),
  'Categoria "Alta cucina" modificata',
  'updating a category logs the new name'
);
select is(
  (select summary from dining_change_log where entity_type = 'restaurant' and action = 'created'),
  'Ristorante "Trattoria Da Mario" creato',
  'creating a restaurant logs a readable summary'
);
select is(
  (select summary from dining_change_log where entity_type = 'hours' and action = 'created'),
  'Orari di "Trattoria Da Mario" aggiunti',
  'adding opening hours logs the restaurant name, resolved via restaurant_id'
);

-- ### reception manually adds a reservation, then admin confirms it ###
set local role authenticated;
set local request.jwt.claim.sub = '00000060-0000-0000-0000-000000000a03';
insert into restaurant_reservation_requests (id, hotel_id, restaurant_id, guest_name, party_size, reservation_date, reservation_time, created_by) values
  ('00000060-0000-0000-0000-0000000eb001', '00000060-0000-0000-0000-00000000ff01', '00000060-0000-0000-0000-0000000da001', 'Sig.ra Bianchi', 4, '2026-09-20', '20:30', '00000060-0000-0000-0000-000000000103');
reset role;
set local role authenticated;
set local request.jwt.claim.sub = '00000060-0000-0000-0000-000000000a01';
update restaurant_reservation_requests set confirmation_status = 'confirmed' where id = '00000060-0000-0000-0000-0000000eb001';
reset role;

select is(
  (select summary from dining_change_log where entity_type = 'reservation' and action = 'created'),
  'Prenotazione di Sig.ra Bianchi (20/09/2026) creata',
  'a manually-added reservation logs the guest name and date'
);
select is(
  (select actor_name from dining_change_log where entity_type = 'reservation' and action = 'created'),
  'Reception Tre',
  'the reservation-creation log attributes it to the reception member who entered it'
);
select is(
  (select summary from dining_change_log where entity_type = 'reservation' and action = 'updated'),
  'Prenotazione di Sig.ra Bianchi (20/09/2026): stato -> confirmed',
  'confirming a reservation logs the specific status change, not a generic "modificata"'
);

-- ### visibility: front-desk-managing staff can read the log, housekeeping cannot ###
set local role authenticated;
set local request.jwt.claim.sub = '00000060-0000-0000-0000-000000000a01';
select is((select count(*)::int from dining_change_log where hotel_id = '00000060-0000-0000-0000-00000000ff01'), 6, 'admin (manages front desk) can read all 6 logged changes');
reset role;

set local role authenticated;
set local request.jwt.claim.sub = '00000060-0000-0000-0000-000000000a02';
select is((select count(*)::int from dining_change_log where hotel_id = '00000060-0000-0000-0000-00000000ff01'), 0, 'housekeeping operatore (does not manage front desk) cannot read the change log');

-- ### no client role can write to the log directly, only the triggers can ###
select throws_ok(
  $$ insert into dining_change_log (hotel_id, entity_type, entity_id, action, actor_name, summary)
     values ('00000060-0000-0000-0000-00000000ff01', 'category', gen_random_uuid(), 'created', 'Fake', 'Fake entry') $$,
  '42501',
  null,
  'authenticated has no direct write access to the change log -- only the SECURITY DEFINER triggers can insert'
);
reset role;

select * from finish();
rollback;
