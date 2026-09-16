-- Widens guest_stay_info with the hotel's optional brand color (a hex
-- string, apps/web's Settings page "Colore del marchio" field under
-- properties.settings.brandColor), so the guest app can recolor its accent
-- to match the property instead of always using Homisuite's default
-- purple. Same bridge/null behavior as the rest of this function: absent
-- when the hotel has no Core mapping or never set a custom color, in which
-- case the guest app keeps its own default.
--
-- NOTE: another open, unapplied PR (guest navbar logo/name) also widens
-- this same function with hotel_logo_path/hotel_logo_updated_at. Whichever
-- of the two migrations is applied second must fold in the other's added
-- columns too, or a bare CREATE FUNCTION here will silently drop them from
-- the live function -- same DROP+CREATE hazard flagged in every prior
-- widening of this function.
--
-- A function's return type can't change via CREATE OR REPLACE, so this
-- drops and recreates it, same as every prior widening did.

begin;

drop function guest_stay_info(text);

create function guest_stay_info(p_token text) returns table(
  room_number text,
  guest_last_name text,
  check_out_at timestamptz,
  hotel_name text,
  hotel_phone text,
  hotel_address text,
  hotel_email text,
  hotel_check_out_time text,
  hotel_wifi_network text,
  hotel_wifi_password text,
  hotel_breakfast_hours text,
  hotel_bar_hours text,
  hotel_brand_color text
)
language sql security definer stable set search_path = public, extensions as $$
  select
    r.room_number,
    s.guest_last_name,
    s.check_out_at,
    h.name,
    p.settings ->> 'phone',
    p.settings ->> 'address',
    p.settings ->> 'publicEmail',
    p.settings ->> 'checkOutTime',
    p.settings ->> 'wifiNetwork',
    p.settings ->> 'wifiPassword',
    p.settings ->> 'breakfastHours',
    p.settings ->> 'barHours',
    p.settings ->> 'brandColor'
  from guest_requests_guest_sessions gs
  join stays s on s.id = gs.stay_id
  join rooms r on r.id = s.room_id
  join hotels h on h.id = s.hotel_id
  left join legacy_property_mapping m on m.legacy_hotel_id = h.id
  left join properties p on p.id = m.platform_property_id
  where gs.token_hash = encode(digest(p_token, 'sha256'), 'hex')
    and gs.revoked_at is null
    and gs.expires_at > now()
    and s.status = 'active'
    and now() < s.check_out_at
  limit 1;
$$;

revoke all on function guest_stay_info(text) from public;
grant execute on function guest_stay_info(text) to anon;

commit;
