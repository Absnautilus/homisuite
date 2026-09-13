-- Widens resolve_hotel_guest_slug's result to also carry the hotel's name,
-- so apps/guest's login screen can show "Access your stay at <hotel>"
-- before the guest has authenticated (room + PIN), when only the slug is
-- known. A function's return type can't change via CREATE OR REPLACE, so
-- this drops and recreates it -- its one caller (apps/guest's
-- resolveHotelFromSlug) and its own pgTAP suite (044) are updated
-- alongside this migration.

begin;

drop function resolve_hotel_guest_slug(text);

create function resolve_hotel_guest_slug(p_slug text) returns table(id uuid, name text)
language sql stable security definer set search_path = public as $$
  select id, name from hotels where guest_slug = p_slug and active;
$$;

revoke all on function resolve_hotel_guest_slug(text) from public;
grant execute on function resolve_hotel_guest_slug(text) to anon;

commit;
