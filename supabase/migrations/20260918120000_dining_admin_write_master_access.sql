-- Fixes a real bug surfaced by manual testing on Palazzo Veneziano: a
-- master account could not create a dining category ("Operazione non
-- riuscita" -- an RLS 42501, masked client-side by a bug in
-- readableDiningError fixed separately in this same PR).
--
-- Every other admin-gated table in this codebase treats master as
-- admin-equivalent (see guest_requests_authorization_wrapper.sql's own
-- header: "every other table... gates master exactly like admin:
-- hotel_id = current_staff_hotel() AND role IN ('admin', 'master')" --
-- rooms, stays, guest_requests, request_categories, request_types,
-- guest_login_attempts all do this). Dining's own admin-write policies
-- were written checking only `= 'admin'`, missing that -- this migration
-- corrects the three that need it. restaurant_reservation_requests'
-- concierge policy already composes on current_staff_manages_front_desk(),
-- which already includes master via current_staff_role() in
-- ('admin', 'master'), so it was never affected.

begin;

drop policy dining_categories_admin_write on dining_categories;
create policy dining_categories_admin_write on dining_categories for all to authenticated
  using (hotel_id = current_staff_hotel_for_module('dining') and current_staff_role() in ('admin', 'master'))
  with check (hotel_id = current_staff_hotel_for_module('dining') and current_staff_role() in ('admin', 'master'));

drop policy restaurants_admin_write on restaurants;
create policy restaurants_admin_write on restaurants for all to authenticated
  using (
    hotel_id = current_staff_hotel_for_module('dining')
    and current_staff_role() in ('admin', 'master')
    and exists (select 1 from dining_categories dc where dc.id = category_id and dc.hotel_id = hotel_id)
  )
  with check (
    hotel_id = current_staff_hotel_for_module('dining')
    and current_staff_role() in ('admin', 'master')
    and exists (select 1 from dining_categories dc where dc.id = category_id and dc.hotel_id = hotel_id)
  );

drop policy restaurant_hours_admin_write on restaurant_hours;
create policy restaurant_hours_admin_write on restaurant_hours for all to authenticated
  using (
    current_staff_role() in ('admin', 'master')
    and exists (
      select 1 from restaurants r
      where r.id = restaurant_id and r.hotel_id = current_staff_hotel_for_module('dining')
    )
  )
  with check (
    current_staff_role() in ('admin', 'master')
    and exists (
      select 1 from restaurants r
      where r.id = restaurant_id and r.hotel_id = current_staff_hotel_for_module('dining')
    )
  );

commit;
