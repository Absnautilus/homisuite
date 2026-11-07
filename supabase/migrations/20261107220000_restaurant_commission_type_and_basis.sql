-- Provvigione (commission) was always a single percentage of the whole
-- booking (commission_rate, 0-100). Real agreements vary: some are a fixed
-- euro amount instead of a percentage, and some are charged per guest
-- rather than on the total booking. commission_type and commission_basis
-- let the existing commission_rate column mean either "a percentage of"
-- or "a euro amount for", and either "the total booking" or "each guest" --
-- the UI (RestaurantManagementSlideOver) renders and labels it accordingly.
-- Defaults ('percentage'/'total') keep every existing row's meaning
-- unchanged.
alter table restaurant_operational_profiles
  add column commission_type text not null default 'percentage'
    check (commission_type in ('percentage', 'fixed_amount')),
  add column commission_basis text not null default 'total'
    check (commission_basis in ('per_guest', 'total'));

comment on column restaurant_operational_profiles.commission_type is 'Whether commission_rate is a percentage (0-100) or a fixed euro amount.';
comment on column restaurant_operational_profiles.commission_basis is 'Whether the commission applies once to the whole booking (total) or per guest.';

-- The old 0-100 check only made sense for a percentage -- a fixed euro
-- amount just needs to be non-negative.
alter table restaurant_operational_profiles
  drop constraint restaurant_operational_profiles_commission_rate_check;
alter table restaurant_operational_profiles
  add constraint restaurant_operational_profiles_commission_rate_check check (
    commission_rate is null
    or (commission_type = 'percentage' and commission_rate >= 0 and commission_rate <= 100)
    or (commission_type = 'fixed_amount' and commission_rate >= 0)
  );

-- save_restaurant_management -- two new trailing parameters, both with
-- defaults matching the columns' own defaults, so a caller still on the
-- previous 26-argument form keeps the same behavior as before this
-- migration. CREATE OR REPLACE won't do here: Postgres treats a function
-- with extra parameters (even defaulted ones) as a distinct overload
-- rather than a replacement, which left the old 26-arg and new 28-arg
-- versions coexisting and ambiguous for any 26-arg call -- the old
-- signature is dropped explicitly first so there is exactly one function
-- again.
drop function if exists save_restaurant_management(
  uuid, text, text, smallint, smallint, text, text, text, text, text[], boolean, int, text, text, text, boolean,
  text, text, text, text, text, text, numeric, text, text, date
);
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
  p_last_verified_on date,
  p_commission_type text default 'percentage',
  p_commission_basis text default 'total'
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

  if v_restaurant.id is null then
    raise exception 'restaurant_not_found_or_forbidden' using errcode = '22023';
  end if;

  insert into restaurant_operational_profiles (
    restaurant_id, contact_phone, contact_email, contact_whatsapp, preferred_contact_method,
    contact_person, commercial_agreement, commission_rate, commission_type, commission_basis,
    booking_notes, difficult_times, last_verified_on
  ) values (
    p_restaurant_id, p_contact_phone, p_contact_email, p_contact_whatsapp, p_preferred_contact_method,
    p_contact_person, coalesce(p_commercial_agreement, 'none'), p_commission_rate,
    coalesce(p_commission_type, 'percentage'), coalesce(p_commission_basis, 'total'),
    p_booking_notes, p_difficult_times, p_last_verified_on
  )
  on conflict (restaurant_id) do update set
    contact_phone = excluded.contact_phone,
    contact_email = excluded.contact_email,
    contact_whatsapp = excluded.contact_whatsapp,
    preferred_contact_method = excluded.preferred_contact_method,
    contact_person = excluded.contact_person,
    commercial_agreement = excluded.commercial_agreement,
    commission_rate = excluded.commission_rate,
    commission_type = excluded.commission_type,
    commission_basis = excluded.commission_basis,
    booking_notes = excluded.booking_notes,
    difficult_times = excluded.difficult_times,
    last_verified_on = excluded.last_verified_on;

  return v_restaurant;
end;
$$;

revoke all on function save_restaurant_management(
  uuid, text, text, smallint, smallint, text, text, text, text, text[], boolean, int, text, text, text, boolean,
  text, text, text, text, text, text, numeric, text, text, date, text, text
) from public;
grant execute on function save_restaurant_management(
  uuid, text, text, smallint, smallint, text, text, text, text, text[], boolean, int, text, text, text, boolean,
  text, text, text, text, text, text, numeric, text, text, date, text, text
) to authenticated;
