-- Restores the role scope on restaurant_reservation_requests_concierge.
--
-- 20261107100000_dining_reservations_accept_dining_manage.sql recreated this
-- policy to OR in has_permission(..., 'dining.manage'), but dropped the
-- original `to authenticated` (20260918100000_dining_module.sql). Without
-- it the policy applies to every role, so an `anon` read of the table now
-- evaluates current_staff_hotel_for_module() -- which anon may not execute --
-- and fails with "permission denied for function" instead of returning no
-- rows. pgTAP 058 ("anon cannot read the reservation dashboard at all") and
-- 068 caught it.
--
-- Same predicate as 20261107100000, only scoped back to authenticated:
-- staff behavior is unchanged, anon gets the intended empty result again.

begin;

drop policy if exists restaurant_reservation_requests_concierge on restaurant_reservation_requests;

create policy restaurant_reservation_requests_concierge on restaurant_reservation_requests
  for all to authenticated
  using (
    (hotel_id = current_staff_hotel_for_module('dining') and current_staff_manages_front_desk())
    or has_permission(legacy_hotel_property_id(hotel_id), 'dining.manage')
  )
  with check (
    (hotel_id = current_staff_hotel_for_module('dining') and current_staff_manages_front_desk())
    or has_permission(legacy_hotel_property_id(hotel_id), 'dining.manage')
  );

commit;
