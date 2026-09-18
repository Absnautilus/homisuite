begin;

-- One-time production entitlement change, explicitly authorized by the
-- platform owner: switch the Dining module on for Palazzo Veneziano so it
-- can be tested end to end in the real app. Every other property is
-- untouched -- Dining stays off everywhere else by design (see
-- 20260918100000_dining_module.sql's own header: no backfill, opt-in per
-- property as a commercial decision).
--
-- Scoped to Palazzo Veneziano's own hotel_id, resolved by name rather than
-- a hardcoded id, same guard shape as
-- 20260917130000_clear_palazzo_veneziano_guest_requests.sql: fails loudly
-- on an unexpected row count instead of silently touching the wrong hotel.
-- CI and any other fresh/seeded database never has a "Palazzo Veneziano"
-- row, so this is a safe no-op everywhere except the real production
-- database.
do $$
declare
  target_hotel_id uuid;
  hotel_count int;
  target_property_id uuid;
  dining_module_id uuid;
begin
  select count(*) into hotel_count from hotels where name = 'Palazzo Veneziano';

  if hotel_count = 0 then
    raise notice 'enable_dining_for_palazzo_veneziano: no hotel named Palazzo Veneziano in this database (expected in CI/fresh environments) -- nothing to enable here, skipping.';
    return;
  end if;

  if hotel_count > 1 then
    raise exception 'enable_dining_for_palazzo_veneziano: % hotels named Palazzo Veneziano -- refusing to guess which one, fix the ambiguity first', hotel_count;
  end if;

  select id into target_hotel_id from hotels where name = 'Palazzo Veneziano';

  select platform_property_id into target_property_id
    from legacy_property_mapping where legacy_hotel_id = target_hotel_id;

  if target_property_id is null then
    raise exception 'enable_dining_for_palazzo_veneziano: Palazzo Veneziano (%) has no legacy_property_mapping row -- cannot enable a Core-side module for an unmapped hotel', target_hotel_id;
  end if;

  select id into dining_module_id from modules where slug = 'dining';

  if dining_module_id is null then
    raise exception 'enable_dining_for_palazzo_veneziano: no module registered with slug ''dining'' -- has 20260918100000_dining_module.sql been applied?';
  end if;

  insert into property_modules (property_id, module_id, enabled)
    values (target_property_id, dining_module_id, true)
  on conflict (property_id, module_id) do update set enabled = true;

  raise notice 'enable_dining_for_palazzo_veneziano: dining enabled for property % (hotel %).', target_property_id, target_hotel_id;
end $$;

commit;
