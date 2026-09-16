-- Widens guest_stay_info with the hotel's public website (Settings'
-- "Sito web" field, under properties.settings.website), the last of
-- "Contatti pubblici" apps/web collects that the guest ContactsCard still
-- didn't surface -- phone/address/email were already exposed, the website
-- link was simply missing. Same bridge/null behavior as the rest of this
-- function.
--
-- Also folds in hotel_logo_path/hotel_logo_updated_at, added by
-- 20260916120000 (the guest navbar logo/name PR): both this migration and
-- that one were open in parallel and each did its own DROP+CREATE, so
-- whichever applies second must carry the other's columns forward or its
-- own bare CREATE FUNCTION would silently drop them -- same hazard flagged
-- in every prior widening. This one now applies after 20260916120000.
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
  hotel_brand_color text,
  hotel_logo_path text,
  hotel_logo_updated_at text,
  hotel_website text
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
    p.settings ->> 'brandColor',
    case when p.id is not null then p.id::text || '/logo.png' else null end,
    p.settings ->> 'logoUpdatedAt',
    p.settings ->> 'website'
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
