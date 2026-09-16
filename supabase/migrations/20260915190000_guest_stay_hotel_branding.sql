-- Widens guest_stay_info once more so the guest navbar can show the
-- hotel's own name and logo instead of generic Homisuite branding.
-- hotel_name is already returned (from the legacy hotel's own name); this
-- adds the storage path to the property's logo (same "property-logos"
-- bucket and "<property_id>/logo.png" convention apps/web's Settings page
-- already uses) plus its own logoUpdatedAt cache-buster, so the frontend
-- builds the exact same public URL apps/web does. hotel_logo_updated_at is
-- null whenever the hotel never uploaded a logo (or has no Core mapping),
-- which the guest UI treats as "no logo" and falls back to the generic
-- Homisuite mark -- never a broken image request.
--
-- A function's return type can't change via CREATE OR REPLACE, so this
-- drops and recreates it, same as the previous widenings.

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
  hotel_logo_path text,
  hotel_logo_updated_at text
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
    case when p.id is not null then p.id::text || '/logo.png' else null end,
    p.settings ->> 'logoUpdatedAt'
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
