-- "Aggiungi prenotazione" always required picking a restaurant off this
-- hotel's own configured list. A guest's phoned-in booking is sometimes
-- for somewhere not on it (not every restaurant in town is convenzionato)
-- -- restaurant_id becomes optional, and custom_restaurant_name holds the
-- free-typed name for that case. Exactly one of the two is ever set; every
-- reader that already resolves a name from restaurant_id (OggiPanel,
-- TuttePanel, BookingDetailSlideOver) falls back to
-- "Altro (<custom_restaurant_name>)" when it's null.
alter table restaurant_reservation_requests
  alter column restaurant_id drop not null;

alter table restaurant_reservation_requests
  add column custom_restaurant_name text;

alter table restaurant_reservation_requests
  add constraint restaurant_reservation_requests_restaurant_xor_custom check (
    (restaurant_id is not null) <> (custom_restaurant_name is not null)
  );

comment on column restaurant_reservation_requests.custom_restaurant_name is 'Free-typed restaurant name for a booking at a restaurant not on this hotel''s own list -- mutually exclusive with restaurant_id (see the xor check constraint).';
