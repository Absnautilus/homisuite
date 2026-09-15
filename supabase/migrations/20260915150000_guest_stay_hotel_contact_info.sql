-- Widens guest_stay_info's result to also carry the hotel's contact
-- details, so the guest UI can show a "click to open WhatsApp" link, an
-- email, a postal address, and the hotel's own default checkout time --
-- all from the one token-scoped call it already makes on load, no second
-- round trip. Everything but the checkout time comes from the Core
-- property's settings jsonb (apps/web's Settings page writes
-- property.settings.phone/address/publicEmail/checkOutTime), reached
-- through legacy_property_mapping the same way current_staff_department()
-- and guest_requests_legacy_hotel_for_property already bridge hotel_id ->
-- platform_property_id. All of them are null when the hotel has no Core
-- mapping yet or the fields were never filled in -- the guest UI hides
-- whatever isn't there rather than showing an empty row, and in
-- particular never falls back to any Homisuite-owned contact: no phone
-- here means no WhatsApp button, not a wrong number.
--
-- check_out_at itself is still the stay's own real timestamp (the date
-- guests actually need), but its time-of-day is often just whatever a
-- front-desk default landed on when the stay was created, not a
-- deliberate per-guest choice -- hotel_check_out_time (Settings' "Orario
-- check-out predefinito", a plain HH:MM string) is what the guest card
-- displays instead, falling back to check_out_at's own time only when the
-- hotel never set one.
--
-- A function's return type can't change via CREATE OR REPLACE, so this
-- drops and recreates it, same as resolve_hotel_guest_slug_with_name did.

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
  hotel_check_out_time text
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
    p.settings ->> 'checkOutTime'
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
