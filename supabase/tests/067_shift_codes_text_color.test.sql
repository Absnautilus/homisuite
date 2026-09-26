-- 20260926180000_shift_codes_text_color: an admin can override the
-- auto-computed badge text color per shift code. null keeps today's
-- behaviour (contrast computed client-side from `color`); any explicit
-- value must be one of the two the UI actually offers.
begin;
create extension if not exists pgtap;
select plan(4);

insert into organizations (id, name, slug) values
  ('00000067-0000-0000-0000-000000000001', 'Text Color Org', 'test-067-org');

insert into properties (id, organization_id, name, slug) values
  ('00000067-0000-0000-0000-000000000011', '00000067-0000-0000-0000-000000000001', 'Text Color Property', 'text-color-a');

insert into shift_planning_units (id, property_id, name, slug) values
  ('00000067-0000-0000-0000-000000000071', '00000067-0000-0000-0000-000000000011', 'Reception', 'reception');

insert into shift_codes (id, property_id, planning_unit_id, code, label, kind, starts_at, ends_at, color) values
  ('00000067-0000-0000-0000-000000000101', '00000067-0000-0000-0000-000000000011', '00000067-0000-0000-0000-000000000071', 'A1', 'Apertura 1', 'work', '07:00', '15:00', '#2E9F43');

-- ### column exists, starts null (auto-contrast) ###
select is(
  (select text_color from shift_codes where id = '00000067-0000-0000-0000-000000000101'),
  null,
  'text_color starts unset, so the client falls back to auto-contrast'
);

-- ### an explicit white or black override is accepted ###
select lives_ok(
  $$update shift_codes set text_color = '#ffffff' where id = '00000067-0000-0000-0000-000000000101'$$,
  'white is an accepted override'
);
select lives_ok(
  $$update shift_codes set text_color = '#111111' where id = '00000067-0000-0000-0000-000000000101'$$,
  'black is an accepted override'
);

-- ### anything else is rejected ###
select throws_ok(
  $$update shift_codes set text_color = '#ff0000' where id = '00000067-0000-0000-0000-000000000101'$$,
  '23514', null,
  'an arbitrary color is not an accepted text_color override'
);

select * from finish();
rollback;
