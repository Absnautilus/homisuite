-- Fix: Platform Admin couldn't resolve either module's legacy hotel_id --
-- Fase C follow-up, found during live testing of C2-Dining/C2-Housekeeping.
--
-- Both PRs extended the operational tables' own RLS, but missed that the
-- legacy-hotel-id BRIDGE functions each module's frontend calls first --
-- guest_requests_legacy_hotel_for_property() (Housekeeping,
-- getGuestRequestsLegacyHotelId) and legacy_hotel_for_property() (Dining,
-- getDiningLegacyHotelId) -- each independently gate on has_property_access
-- (an ordinary tenant membership), which Admin Master never has and must
-- never be given. The mapping row itself was never missing; the bridge
-- function always returned null for her regardless, which both modules'
-- access gates correctly but unhelpfully read as "this property isn't
-- bridged to a legacy hotel at all" (no-mapping) -- a wrong diagnosis for
-- what was actually an authorization gap one level below where C2 looked.
--
-- Fix: same additive OR-branch pattern as every other function in this
-- series -- has_property_access(...) OR platform_operational_read_allowed
-- (...). Both functions are CREATE OR REPLACE on their existing, unchanged
-- shape (same two migrations: 20260906072119 for the Housekeeping one,
-- 20261013120000's redefinition for the Dining one) -- only the new
-- OR-branch is added, preserving every other condition and the function's
-- existing grant.
--
-- This only ever reveals a legacy_hotel_id (an internal FK value, not
-- guest/operational data) to Admin Master, and only when
-- platform_operational_read_allowed() already holds -- the same standing
-- permission + MFA + active, unexpired, property-scoped session check
-- used everywhere else in Fase C. No RLS policy, write path, or grant is
-- touched.

begin;

create or replace function guest_requests_legacy_hotel_for_property(p_property_id uuid)
returns uuid
language sql stable security definer set search_path = public as $$
  select m.legacy_hotel_id
  from legacy_property_mapping m
  where m.platform_property_id = p_property_id
    and (has_property_access(p_property_id) or platform_operational_read_allowed(p_property_id))
    and has_module(p_property_id, 'guest_requests')
  limit 1;
$$;

create or replace function legacy_hotel_for_property(p_property_id uuid, p_module_slug text)
returns uuid
language sql stable security definer set search_path = public as $$
  select m.legacy_hotel_id
  from legacy_property_mapping m
  where m.platform_property_id = p_property_id
    and (has_property_access(p_property_id) or platform_operational_read_allowed(p_property_id))
    and has_module_access(p_property_id, p_module_slug)
  limit 1;
$$;

commit;
