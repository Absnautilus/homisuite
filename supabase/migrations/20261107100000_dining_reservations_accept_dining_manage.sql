-- The Dining reservations screen gates its own UI (the "Aggiungi
-- prenotazione" button, every status-change button in the detail panel)
-- on the modern `dining.manage` permission -- but the one RLS policy on
-- restaurant_reservation_requests (select/insert/update/delete) only ever
-- recognized the older, legacy front-desk check: staff_profiles role
-- admin/master, or role 'operatore' with department = 'reception' (a
-- separate field from job title/role, with no UI anywhere to set it).
-- A staff member correctly granted dining.manage through the real role
-- system -- the exact permission the button is gated on -- could see every
-- action, attempt one, and be denied by RLS with a generic "Non hai i
-- permessi" message that gave no indication why, and silently saw an
-- EMPTY reservation list rather than an error (the same policy also
-- governs SELECT). Found live: a Receptionist whose job title is
-- literally "Reception" was blocked because nobody had ever set the
-- separate department field.
--
-- Fixed the additive way this project always does it: the legacy check
-- stays completely intact (front-desk staff without dining.manage keep
-- working exactly as before), and has_permission(property_id,
-- 'dining.manage') is OR'd in as a second, independent way to qualify --
-- the same permission the UI already assumes grants this.

begin;

drop policy if exists restaurant_reservation_requests_concierge on restaurant_reservation_requests;

create policy restaurant_reservation_requests_concierge on restaurant_reservation_requests
  for all
  using (
    (hotel_id = current_staff_hotel_for_module('dining') and current_staff_manages_front_desk())
    or has_permission(legacy_hotel_property_id(hotel_id), 'dining.manage')
  )
  with check (
    (hotel_id = current_staff_hotel_for_module('dining') and current_staff_manages_front_desk())
    or has_permission(legacy_hotel_property_id(hotel_id), 'dining.manage')
  );

commit;
