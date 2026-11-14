-- A restaurant's photo gallery -- separate from restaurants.cover_image_url
-- (kept as a fast, no-join "first photo" for the list thumbnail) so a
-- restaurant can carry more than one importable photo for a scrollable
-- gallery view.
create table restaurant_photos (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references restaurants(id) on delete cascade,
  image_url text not null,
  -- Google's Place Photos terms require crediting the photo's author
  -- wherever it's shown -- kept alongside the url, same reasoning as
  -- restaurants.cover_image_attribution.
  attribution text,
  sort_order int not null default 0,
  created_at timestamptz not null default now()
);

create index restaurant_photos_restaurant_idx on restaurant_photos(restaurant_id, sort_order);

alter table restaurant_photos enable row level security;

grant select, insert, update, delete on restaurant_photos to authenticated;
grant select on restaurant_photos to anon;

create policy restaurant_photos_admin_write on restaurant_photos for all
  using (exists (
    select 1 from restaurants r
    where r.id = restaurant_photos.restaurant_id
      and r.hotel_id = current_staff_hotel_for_module('dining')
      and has_permission(legacy_hotel_property_id(r.hotel_id), 'dining.manage')
  ))
  with check (exists (
    select 1 from restaurants r
    where r.id = restaurant_photos.restaurant_id
      and r.hotel_id = current_staff_hotel_for_module('dining')
      and has_permission(legacy_hotel_property_id(r.hotel_id), 'dining.manage')
  ));

create policy restaurant_photos_public_read on restaurant_photos for select
  using (exists (
    select 1 from restaurants r
    where r.id = restaurant_photos.restaurant_id
      and r.active
      and hotel_has_module(r.hotel_id, 'dining')
  ));
