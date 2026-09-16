-- Widens resolve_hotel_guest_slug with the hotel's brand color and logo,
-- same bridge (legacy_property_mapping -> properties.settings) and same
-- null-not-error behavior guest_stay_info already uses for these fields --
-- so the login screen (before the guest has a session, only the slug is
-- known) can render with the hotel's own color/logo too, instead of always
-- falling back to generic Homisuite branding until after login.
--
-- A function's return type can't change via CREATE OR REPLACE, so this
-- drops and recreates it, same as its own prior widening
-- (20260913120000_resolve_hotel_guest_slug_with_name.sql) did.

begin;

drop function resolve_hotel_guest_slug(text);

create function resolve_hotel_guest_slug(p_slug text) returns table(
  id uuid,
  name text,
  brand_color text,
  logo_path text,
  logo_updated_at text
)
language sql stable security definer set search_path = public as $$
  select
    h.id,
    h.name,
    p.settings ->> 'brandColor',
    case when p.id is not null then p.id::text || '/logo.png' else null end,
    p.settings ->> 'logoUpdatedAt'
  from hotels h
  left join legacy_property_mapping m on m.legacy_hotel_id = h.id
  left join properties p on p.id = m.platform_property_id
  where h.guest_slug = p_slug and h.active;
$$;

revoke all on function resolve_hotel_guest_slug(text) from public;
grant execute on function resolve_hotel_guest_slug(text) to anon;

commit;
