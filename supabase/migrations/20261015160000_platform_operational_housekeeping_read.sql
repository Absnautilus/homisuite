-- Platform Admin operational read access -- Fase C, PR C2 (Housekeeping
-- module, the third and final module from the original audit).
--
-- Reuses platform_operational_read_allowed(property_id) and
-- legacy_hotel_property_id(hotel_id) unchanged -- both already exist from
-- the Shifts/Dining PRs in this series.
--
-- current_staff_hotel() -- the pivot of nearly every Housekeeping SELECT
-- policy -- is reused far more heavily than Dining's current_staff_hotel_
-- for_module('dining') or Shifts' can_view_shift_planning_unit: grepping
-- every migration shows dozens of call sites across write policies
-- (staff_profiles/rooms/request_categories/request_types admin-write,
-- guest_requests update/delete, a BEFORE INSERT trigger that stamps
-- hotel_id from it) and write RPCs (save_pms_integration, set_on_duty,
-- the PMS status functions). It is never modified here, for the same
-- reason has_permission()/has_property_access() aren't touched elsewhere
-- in this series.
--
-- The live policy definitions (read directly from pg_policies, not the
-- original migration files -- several have been redefined in place by
-- later migrations, e.g. guest_requests_select_hotel now also factors in
-- current_staff_sees_full_queue()/assigned_job_title_ids) confirm every
-- table below separates its SELECT policy from its write policy/policies
-- by name. Rather than drop+recreate any of these (as done for the
-- simpler, single-condition policies in the Shifts/Dining PRs), every
-- table here instead gets a brand-new, additive `for select`-only policy
-- -- the same safe pattern used for Dining's `for all`-policied tables,
-- applied everywhere this time as the more conservative choice given how
-- many migrations have touched these specific policy names over time.
-- Zero existing policy text is modified or removed.
--
-- Realtime: Housekeeping's one Realtime channel (`guest_requests-queue-
-- <hotelId>`, modules/housekeeping/src/lib/staff-api.ts) subscribes to
-- postgres_changes on `guest_requests`, which Supabase enforces through
-- this exact same RLS SELECT policy set per-subscriber. Adding the new
-- policy below therefore extends to the Realtime channel automatically --
-- no separate Realtime-specific configuration exists to update.

begin;

create policy hotels_platform_admin_read on hotels for select to authenticated
  using (platform_operational_read_allowed(legacy_hotel_property_id(id)));

create policy staff_profiles_platform_admin_read on staff_profiles for select to authenticated
  using (platform_operational_read_allowed(legacy_hotel_property_id(hotel_id)));

create policy rooms_platform_admin_read on rooms for select to authenticated
  using (platform_operational_read_allowed(legacy_hotel_property_id(hotel_id)));

create policy stays_platform_admin_read on stays for select to authenticated
  using (platform_operational_read_allowed(legacy_hotel_property_id(hotel_id)));

create policy guest_requests_platform_admin_read on guest_requests for select to authenticated
  using (platform_operational_read_allowed(legacy_hotel_property_id(hotel_id)));

-- ---------------------------------------------------------------------------
-- guest_requests_property_job_titles -- the one Housekeeping read RPC
-- (confirmed by the original module audit: used only by staff-api.ts and
-- admin-api.ts to list a hotel's active mansioni, never by any write path).
-- Extended directly since it is a single, self-contained, read-only
-- SECURITY DEFINER function -- CREATE OR REPLACE preserves its existing
-- grant, nothing to re-grant.
-- ---------------------------------------------------------------------------
create or replace function guest_requests_property_job_titles(p_hotel_id uuid)
returns table(id uuid, name text)
language sql security definer stable set search_path = public as $$
  select jt.id, jt.name
  from legacy_property_mapping m
  join property_job_titles jt on jt.property_id = m.platform_property_id
  where m.legacy_hotel_id = p_hotel_id
    and jt.active
    and (p_hotel_id = current_staff_hotel() or platform_operational_read_allowed(legacy_hotel_property_id(p_hotel_id)))
  order by jt.name;
$$;

commit;
