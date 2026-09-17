begin;

-- One-time production data cleanup, explicitly authorized by the platform
-- owner: Palazzo Veneziano's own guest_requests history so far was
-- generated while manually testing the app (login/menu/mansioni features),
-- not by real guests -- she asked for it to be cleared before going live,
-- keeping every other real row (the hotel itself, its rooms, stays, staff,
-- request_categories/types, mansioni) untouched.
--
-- Scoped to Palazzo Veneziano's own hotel_id only, resolved by name rather
-- than a hardcoded id so this fails loudly (wrong row count) instead of
-- silently hitting the wrong hotel if the name were ever ambiguous.
--
-- No table references guest_requests(id) (see
-- 20260911180000_cleanup_dev_phase_fixtures.sql's own comment on this),
-- so this delete has no cascading effect on any other table.
--
-- Guarded the same way as that same prior cleanup migration: CI and any
-- other fresh/seeded database never has a "Palazzo Veneziano" row, so this
-- is a safe no-op everywhere except the real production database.
do $$
declare
  target_hotel_id uuid;
  hotel_count int;
  deleted_count int;
begin
  select count(*) into hotel_count from hotels where name = 'Palazzo Veneziano';

  if hotel_count = 0 then
    raise notice 'clear_palazzo_veneziano_guest_requests: no hotel named Palazzo Veneziano in this database (expected in CI/fresh environments) -- nothing to clean up here, skipping.';
    return;
  end if;

  if hotel_count > 1 then
    raise exception 'clear_palazzo_veneziano_guest_requests: % hotels named Palazzo Veneziano -- refusing to guess which one, fix the ambiguity first', hotel_count;
  end if;

  select id into target_hotel_id from hotels where name = 'Palazzo Veneziano';

  delete from guest_requests where hotel_id = target_hotel_id;
  get diagnostics deleted_count = row_count;
  raise notice 'clear_palazzo_veneziano_guest_requests: deleted % guest_requests row(s) for Palazzo Veneziano (%).', deleted_count, target_hotel_id;

  if exists (select 1 from guest_requests where hotel_id = target_hotel_id) then
    raise exception 'cleanup incomplete: guest_requests rows still exist for Palazzo Veneziano';
  end if;
end $$;

commit;
