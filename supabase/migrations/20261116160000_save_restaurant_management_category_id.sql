-- save_restaurant_management never had a p_category_id parameter, so a
-- restaurant's category (shown read-only as the management slide-over's
-- subtitle) could only ever be set at creation time -- there was no way to
-- change it afterwards. Add it as an optional param (defaulting to "leave
-- unchanged") so existing callers keep working.
create or replace function public.save_restaurant_management(
  p_restaurant_id uuid, p_name text, p_cuisine text, p_price_tier smallint, p_walk_minutes smallint,
  p_address text, p_website_url text, p_maps_url text, p_short_description text, p_guest_tags text[],
  p_is_recommended boolean, p_sort_order integer, p_concierge_description text, p_ideal_for text,
  p_guest_profile text, p_active boolean, p_contact_phone text, p_contact_email text, p_contact_whatsapp text,
  p_preferred_contact_method text, p_contact_person text, p_commercial_agreement text, p_commission_rate numeric,
  p_booking_notes text, p_difficult_times text, p_last_verified_on date,
  p_commission_type text default 'percentage'::text, p_commission_basis text default 'total'::text,
  p_category_id uuid default null
)
returns restaurants
language plpgsql
set search_path to 'public'
as $function$
declare
  v_restaurant restaurants%rowtype;
begin
  update restaurants set
    name = p_name,
    category_id = coalesce(p_category_id, category_id),
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
$function$;
