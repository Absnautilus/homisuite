-- Platform Admin operational read access -- Fase C, PR C2 (Dining module).
--
-- Reuses platform_operational_read_allowed(property_id) from the Shifts PR
-- unchanged -- the same four-fact check (is_platform_admin + platform.
-- support.read + verified MFA + an active, unexpired session scoped to
-- that property), re-evaluated fresh on every call.
--
-- Dining's own write policies are shaped differently from Shifts', and
-- that shape dictates a different technique here:
--
--   - dining_categories / restaurants / restaurant_hours / dining_guest_tags
--     are already readable by EVERYONE (anon + authenticated, gated only
--     on hotel_has_module(hotel_id, 'dining')) -- public catalog data. Admin
--     Master already sees all of it. Nothing to add.
--
--   - restaurant_operational_profiles, restaurant_reservation_requests,
--     restaurant_reservation_alternatives each have exactly ONE policy, a
--     `for all` combining read+write into a single USING/WITH CHECK pair
--     (restaurant_operational_profiles_admin_write,
--     restaurant_reservation_requests_concierge,
--     restaurant_reservation_alternatives_concierge). Appending an
--     OR-branch to any of these would be exactly the mistake point 1/2 of
--     the instructed verification asks us to rule out: it would grant the
--     admin INSERT/UPDATE/DELETE too, since `for all` evaluates the same
--     USING/WITH CHECK for every command. Instead, each of these three
--     tables gets a brand-new, additive policy restricted to `for select`
--     only. Postgres combines same-command permissive policies with OR;
--     a `for select`-only policy contributes nothing to how INSERT/
--     UPDATE/DELETE are evaluated, so the original `for all` policy
--     remains the sole authority over every write, completely untouched.
--
--   - restaurant_reservation_feedback_concierge_read and
--     dining_change_log_select are already their own, separate `for
--     select`-only policies (no write policy exists for either table to
--     authenticated at all) -- these are extended in place, same pattern
--     as the Shifts PR's vacation/request tables.
--
-- legacy_hotel_property_id(hotel_id) (already existing, read-only bridge
-- function, used today only inside other read/write-gating expressions,
-- never modified here) resolves each of these hotel_id-keyed tables to the
-- Core property_id platform_operational_read_allowed() expects.

begin;

-- ---------------------------------------------------------------------------
-- New, additive SELECT-only policies on tables whose only existing policy
-- is `for all`.
-- ---------------------------------------------------------------------------
create policy restaurant_operational_profiles_platform_admin_read
  on restaurant_operational_profiles for select to authenticated
  using (
    exists (
      select 1 from restaurants r
      where r.id = restaurant_id
        and platform_operational_read_allowed(legacy_hotel_property_id(r.hotel_id))
    )
  );

create policy restaurant_reservation_requests_platform_admin_read
  on restaurant_reservation_requests for select to authenticated
  using (platform_operational_read_allowed(legacy_hotel_property_id(hotel_id)));

create policy restaurant_reservation_alternatives_platform_admin_read
  on restaurant_reservation_alternatives for select to authenticated
  using (platform_operational_read_allowed(legacy_hotel_property_id(hotel_id)));

-- ---------------------------------------------------------------------------
-- Already select-only policies -- extended in place with the same
-- drop+recreate technique as the Shifts PR.
-- ---------------------------------------------------------------------------
drop policy restaurant_reservation_feedback_concierge_read on restaurant_reservation_feedback;
create policy restaurant_reservation_feedback_concierge_read on restaurant_reservation_feedback for select to authenticated
  using (
    exists (
      select 1 from restaurant_reservation_requests rr
      where rr.id = reservation_id
        and rr.hotel_id = current_staff_hotel_for_module('dining')
        and current_staff_manages_front_desk()
    )
    or exists (
      select 1 from restaurant_reservation_requests rr
      where rr.id = reservation_id
        and platform_operational_read_allowed(legacy_hotel_property_id(rr.hotel_id))
    )
  );

drop policy dining_change_log_select on dining_change_log;
create policy dining_change_log_select on dining_change_log for select to authenticated
  using (
    (hotel_id = current_staff_hotel_for_module('dining') and current_staff_manages_front_desk())
    or platform_operational_read_allowed(legacy_hotel_property_id(hotel_id))
  );

commit;
