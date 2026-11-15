-- restaurant_photos_admin_write was created without "to authenticated"
-- (unlike every other admin_write policy in Dining), so it defaulted to
-- PUBLIC -- meaning Postgres had to evaluate its USING clause (which calls
-- current_staff_hotel_for_module, a function anon has no EXECUTE grant on)
-- even for a guest's own SELECT, aborting the whole query with
-- "permission denied for function current_staff_hotel_for_module" instead
-- of ever reaching restaurant_photos_public_read.
alter policy restaurant_photos_admin_write on restaurant_photos to authenticated;
alter policy restaurant_photos_public_read on restaurant_photos to anon, authenticated;
