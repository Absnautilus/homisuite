-- First step toward guest.homisuite.com becoming a real per-hotel
-- "directory" of guest-facing services instead of a single hardcoded
-- Housekeeping flow: lets the guest UI ask, anonymously, which modules a
-- given hotel actually has enabled for its guests. Today this only ever
-- returns guest_requests (Housekeeping), so the guest app can keep going
-- straight into it without showing a one-tile directory screen -- but the
-- mechanism is real end to end, ready for a second guest-facing module to
-- just start showing up here instead of needing new plumbing.
--
-- Not every Core module has a guest-facing side (most don't), so
-- guest_facing marks the ones that do -- separate from a hotel's own
-- property_modules.enabled, which only says the module exists for that
-- property at all, staff or guest.
--
-- hotel_id -> platform_property_id is the same legacy_property_mapping
-- bridge current_staff_department() and guest_stay_info already use.
-- Public/anonymous input (a hotel_id, not a guest session token) is the
-- same trust model apps/guest's fetchMenu already relies on for
-- request_categories/request_types -- knowing which service categories a
-- hotel offers isn't sensitive, and no per-guest data is involved.

begin;

alter table modules add column guest_facing boolean not null default false;

update modules set guest_facing = true where slug = 'guest_requests';

create function guest_available_modules(p_hotel_id uuid) returns table(
  slug text,
  display_name text
)
language sql stable security definer set search_path = public as $$
  select m.slug, m.display_name
  from legacy_property_mapping lpm
  join property_modules pm on pm.property_id = lpm.platform_property_id
  join modules m on m.id = pm.module_id
  where lpm.legacy_hotel_id = p_hotel_id
    and pm.enabled
    and m.guest_facing
    and m.status = 'active'
  order by m.display_name;
$$;

revoke all on function guest_available_modules(uuid) from public;
grant execute on function guest_available_modules(uuid) to anon;

commit;
