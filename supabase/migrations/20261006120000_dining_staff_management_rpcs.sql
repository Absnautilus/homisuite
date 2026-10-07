-- Staff-only transactional RPCs for the Restaurant Concierge staff UI,
-- replacing two client-side multi-statement sequences an external review
-- of PR #185 flagged as non-atomic:
--
-- 1. setAlternatives (RestaurantsTab/BookingDetailSlideOver) did a plain
--    DELETE then a separate INSERT from the client -- a failure between the
--    two left a reservation with NO authorized alternatives at all, worse
--    than whatever bad input caused the failure in the first place.
-- 2. RestaurantManagementSlideOver.saveAll() wrote `restaurants` and
--    `restaurant_operational_profiles` as two separate client calls behind
--    one "Salva modifiche" button -- a failure on the second call silently
--    left the restaurant's public fields saved but its operational profile
--    not, with no indication to the user which half actually persisted.
--
-- Both become single SECURITY INVOKER functions: SQL functions execute
-- inside the caller's own transaction, so any exception raised partway
-- through rolls back every write the function made, down to the call's own
-- start -- exactly the all-or-nothing guarantee the client-side version
-- couldn't provide. SECURITY INVOKER (not DEFINER): the callers are
-- authenticated staff who already hold the right table grants and RLS
-- policies (dining.manage) -- there's no privilege gap to bridge, unlike
-- the guest-facing RPC in 20261006110000, so there's no reason to run as
-- the function owner instead of the caller.
begin;

-- ---------------------------------------------------------------------------
-- set_restaurant_reservation_alternatives — replaces the whole ranked list
-- for one reservation in a single transaction. Re-validates everything the
-- table's own constraints would catch anyway (same hotel as the
-- reservation, no duplicate restaurant ids) up front, so a bad call fails
-- with one clear error instead of a half-applied DELETE.
-- ---------------------------------------------------------------------------
create function set_restaurant_reservation_alternatives(
  p_reservation_id uuid,
  p_restaurant_ids uuid[]
) returns setof restaurant_reservation_alternatives
language plpgsql security invoker set search_path = public as $$
declare
  v_hotel_id uuid;
  v_count int := coalesce(array_length(p_restaurant_ids, 1), 0);
  v_distinct_count int;
begin
  select hotel_id into v_hotel_id from restaurant_reservation_requests where id = p_reservation_id;
  if v_hotel_id is null then
    raise exception 'reservation_not_found' using errcode = '22023';
  end if;
  if v_hotel_id <> current_staff_hotel_for_module('dining') or not current_staff_manages_front_desk() then
    raise exception 'insufficient_privilege' using errcode = '42501';
  end if;

  select count(distinct x) into v_distinct_count from unnest(p_restaurant_ids) x;
  if v_count <> v_distinct_count then
    raise exception 'duplicate_restaurant_id' using errcode = '22023';
  end if;

  if v_count > 0 and (select count(*) from restaurants where id = any(p_restaurant_ids) and hotel_id = v_hotel_id) <> v_count then
    raise exception 'restaurant_not_found_or_wrong_hotel' using errcode = '22023';
  end if;

  delete from restaurant_reservation_alternatives where reservation_id = p_reservation_id;

  if v_count = 0 then
    return;
  end if;

  return query
    insert into restaurant_reservation_alternatives (reservation_id, restaurant_id, rank)
    select p_reservation_id, rid, ord
    from unnest(p_restaurant_ids) with ordinality as t(rid, ord)
    returning *;
end;
$$;

revoke all on function set_restaurant_reservation_alternatives(uuid, uuid[]) from public;
grant execute on function set_restaurant_reservation_alternatives(uuid, uuid[]) to authenticated;

-- ---------------------------------------------------------------------------
-- save_restaurant_management — one restaurant's full Pubblico/Info
-- curate/Operativo form, saved as one transaction. Named, typed parameters
-- (not a jsonb blob) to match this codebase's existing RPC style
-- (create_dining_reservation_request, create_guest_request, ...); verbose,
-- but every field stays a real, checked type instead of an unchecked
-- jsonb->>'key' extraction.
-- ---------------------------------------------------------------------------
create function save_restaurant_management(
  p_restaurant_id uuid,
  p_name text,
  p_cuisine text,
  p_price_tier smallint,
  p_walk_minutes smallint,
  p_address text,
  p_website_url text,
  p_maps_url text,
  p_short_description text,
  p_guest_tags text[],
  p_is_recommended boolean,
  p_sort_order int,
  p_concierge_description text,
  p_ideal_for text,
  p_guest_profile text,
  p_active boolean,
  p_contact_phone text,
  p_contact_email text,
  p_contact_whatsapp text,
  p_preferred_contact_method text,
  p_contact_person text,
  p_commercial_agreement text,
  p_commission_rate numeric,
  p_booking_notes text,
  p_difficult_times text,
  p_last_verified_on date
) returns restaurants
language plpgsql security invoker set search_path = public as $$
declare
  v_restaurant restaurants%rowtype;
begin
  update restaurants set
    name = p_name,
    cuisine = p_cuisine,
    price_tier = p_price_tier,
    walk_minutes = p_walk_minutes,
    address = p_address,
    website_url = p_website_url,
    maps_url = p_maps_url,
    short_description = p_short_description,
    guest_tags = coalesce(p_guest_tags, '{}'),
    is_recommended = p_is_recommended,
    sort_order = p_sort_order,
    concierge_description = p_concierge_description,
    ideal_for = p_ideal_for,
    guest_profile = p_guest_profile,
    active = p_active
  where id = p_restaurant_id
  returning * into v_restaurant;

  -- A 0-row UPDATE (RLS silently filtered it, or the id doesn't exist) is
  -- exactly the "zero-row update treated as success" trap the same review
  -- flagged generally -- this RPC refuses to treat it as one.
  if v_restaurant.id is null then
    raise exception 'restaurant_not_found_or_forbidden' using errcode = '22023';
  end if;

  insert into restaurant_operational_profiles (
    restaurant_id, contact_phone, contact_email, contact_whatsapp, preferred_contact_method,
    contact_person, commercial_agreement, commission_rate, booking_notes, difficult_times, last_verified_on
  ) values (
    p_restaurant_id, p_contact_phone, p_contact_email, p_contact_whatsapp, p_preferred_contact_method,
    p_contact_person, coalesce(p_commercial_agreement, 'none'), p_commission_rate, p_booking_notes,
    p_difficult_times, p_last_verified_on
  )
  on conflict (restaurant_id) do update set
    contact_phone = excluded.contact_phone,
    contact_email = excluded.contact_email,
    contact_whatsapp = excluded.contact_whatsapp,
    preferred_contact_method = excluded.preferred_contact_method,
    contact_person = excluded.contact_person,
    commercial_agreement = excluded.commercial_agreement,
    commission_rate = excluded.commission_rate,
    booking_notes = excluded.booking_notes,
    difficult_times = excluded.difficult_times,
    last_verified_on = excluded.last_verified_on;

  return v_restaurant;
end;
$$;

revoke all on function save_restaurant_management(
  uuid, text, text, smallint, smallint, text, text, text, text, text[], boolean, int, text, text, text, boolean,
  text, text, text, text, text, text, numeric, text, text, date
) from public;
grant execute on function save_restaurant_management(
  uuid, text, text, smallint, smallint, text, text, text, text, text[], boolean, int, text, text, text, boolean,
  text, text, text, text, text, text, numeric, text, text, date
) to authenticated;

commit;
