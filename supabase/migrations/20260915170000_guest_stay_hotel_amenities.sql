-- Widens guest_stay_info further with practical stay info the guest home
-- screen's "Informazioni generali" card now shows alongside checkout:
-- WiFi network/password and breakfast/bar hours. Same bridge as the rest of
-- this function (legacy_property_mapping -> properties.settings, written by
-- apps/web's Settings page "Info per gli ospiti" section), same null
-- behavior when the hotel has no Core mapping or never filled a field in --
-- the guest UI hides whatever isn't there.
--
-- A function's return type can't change via CREATE OR REPLACE, so this
-- drops and recreates it, same as guest_stay_hotel_contact_info did.

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
  hotel_bar_hours text
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
    p.settings ->> 'barHours'
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
