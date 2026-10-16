-- Platform Admin operational read access — Fase C, PR C2 (Shifts module).
--
-- Wires the Shifts module into the operational-context mechanism built in
-- C1 (platform_operational_sessions). This is the first module, chosen
-- first because its two RLS helper functions (can_view_shift_planning_unit,
-- can_view_shift_staff_profile) are confirmed, by direct grep across every
-- migration, to be used EXCLUSIVELY by `for select` policies — never by a
-- write policy's `using`/`with check`, and never inside any mutating RPC
-- body. Extending them directly is therefore a single, well-contained
-- change point that cannot touch write authorization.
--
-- platform_has_permission()/has_property_access() ARE NOT TOUCHED. Both are
-- reused by write policies and RPCs elsewhere in the schema (has_permission
-- gates nearly every `core.*`/`shifts.manage`/`shifts.requests.manage`
-- write check in this repo) — extending either would risk widening write
-- access far beyond this PR's intent. Every table below whose own SELECT
-- policy calls has_permission()/has_property_access() directly (the
-- vacation tables, property_job_titles, property_staff_details) instead
-- gets its *own, separately-named* SELECT policy re-created with the same
-- original condition plus the new OR-branch — never the shared helper
-- function body.
--
-- platform_operational_read_allowed(property_id) is the one new primitive:
-- true only when ALL of the following hold, checked fresh on every call,
-- never cached:
--   - is_platform_admin() (false the instant the admin's platform_admins
--     row is suspended, regardless of any session state)
--   - platform_has_permission('platform.support.read')
--   - platform_mfa_satisfied()
--   - an operational session exists for THIS admin, scoped to THIS
--     property, with status = 'active' and not yet past its expires_at
--     (checked by timestamp directly — never by trusting the session
--     row's status label alone, since that is only lazily flipped to
--     'expired' when platform_my_operational_session() happens to be
--     called; a stale 'active' row past its expires_at must still deny
--     access here)
--
-- This is deliberately an AND of four live facts, not an OR of "session
-- exists" against "is admin" — see docs/platform-admin-operational-
-- context.md's explicit contract: caching either half inside the session
-- row would silently reintroduce the "session as a stale credential"
-- problem that design exists to avoid.
--
-- Scope of this PR: the tables Shifts' own screens actually read from
-- (supabase/tests/079 exercises every one of them, for both positive
-- access and cross-property/no-session/no-permission/no-MFA/suspended
-- denial). Deliberately NOT touched: shift_notifications,
-- shift_push_subscriptions (push-registration internals, never rendered
-- in any screen) and `profiles` (shared across the entire product, far
-- broader blast radius than this module warrants for what is, here, only
-- a "staff full name" display nicety — left as a known, accepted gap).
-- No write policy, grant, or RPC on any table is touched.

begin;

-- ---------------------------------------------------------------------------
-- platform_operational_read_allowed — the one new primitive this PR adds.
-- ---------------------------------------------------------------------------
create function platform_operational_read_allowed(p_property_id uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select
    is_platform_admin()
    and platform_has_permission('platform.support.read')
    and platform_mfa_satisfied()
    and exists (
      select 1
      from platform_operational_sessions s
      join platform_admins pa on pa.id = s.platform_admin_id
      where pa.profile_id = auth.uid()
        and pa.status = 'active'
        and s.property_id = p_property_id
        and s.status = 'active'
        and s.expires_at > now()
    );
$$;

revoke all on function platform_operational_read_allowed(uuid) from public, anon;
grant execute on function platform_operational_read_allowed(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Shifts' own SELECT-only helpers — extended in place. Same language,
-- security, and search_path attributes as the originals (CREATE OR REPLACE
-- preserves the function's OID and existing grants; nothing to re-grant).
-- The admin branch is a top-level OR, not folded into the existing
-- has_permission(...) AND (...) expression -- Admin Master's authorization
-- never depends on holding shifts.view/shifts.manage, which she does not
-- and must not hold.
-- ---------------------------------------------------------------------------
create or replace function can_view_shift_planning_unit(p_property_id uuid, p_planning_unit_id uuid)
returns boolean
language sql stable security definer set search_path = '' as $$
  select (
    public.has_permission(p_property_id, 'shifts.view') and (
      public.has_permission(p_property_id, 'shifts.manage')
      or exists (
        select 1
        from public.shift_unit_members member
        join public.shift_staff_profiles staff
          on staff.property_id = member.property_id
         and staff.id = member.staff_profile_id
        join public.shift_planning_units source_unit
          on source_unit.property_id = member.property_id
         and source_unit.id = member.planning_unit_id
        where member.property_id = p_property_id
          and member.active
          and staff.active
          and staff.profile_id = (select auth.uid())
          and (
            member.planning_unit_id = p_planning_unit_id
            or source_unit.member_visibility_scope = 'all_units'
          )
      )
    )
  ) or public.platform_operational_read_allowed(p_property_id);
$$;

create or replace function can_view_shift_staff_profile(p_property_id uuid, p_staff_profile_id uuid)
returns boolean
language sql stable security definer set search_path = '' as $$
  select (
    public.has_permission(p_property_id, 'shifts.view') and (
      public.has_permission(p_property_id, 'shifts.manage')
      or exists (
        select 1
        from public.shift_unit_members member
        where member.property_id = p_property_id
          and member.staff_profile_id = p_staff_profile_id
          and member.active
          and public.can_view_shift_planning_unit(member.property_id, member.planning_unit_id)
      )
    )
  ) or public.platform_operational_read_allowed(p_property_id);
$$;

-- ---------------------------------------------------------------------------
-- Tables whose own SELECT policy calls has_permission()/has_property_access()
-- directly: re-create that one named policy with the same original
-- condition plus the new OR-branch. The sibling insert/update/delete
-- policies on each of these tables are untouched.
-- ---------------------------------------------------------------------------
drop policy shift_vacation_settings_select on shift_vacation_settings;
create policy shift_vacation_settings_select on shift_vacation_settings for select to authenticated
  using (has_permission(property_id, 'shifts.view') or platform_operational_read_allowed(property_id));

drop policy shift_vacation_periods_select on shift_vacation_periods;
create policy shift_vacation_periods_select on shift_vacation_periods for select to authenticated
  using (has_permission(property_id, 'shifts.view') or platform_operational_read_allowed(property_id));

drop policy shift_preferences_select on shift_preferences;
create policy shift_preferences_select on shift_preferences for select to authenticated
  using (owns_shift_staff_profile(property_id, staff_profile_id) or has_permission(property_id, 'shifts.manage') or platform_operational_read_allowed(property_id));

drop policy shift_absence_requests_select on shift_absence_requests;
create policy shift_absence_requests_select on shift_absence_requests for select to authenticated
  using (owns_shift_staff_profile(property_id, staff_profile_id) or has_permission(property_id, 'shifts.requests.manage') or platform_operational_read_allowed(property_id));

drop policy shift_swap_requests_select on shift_swap_requests;
create policy shift_swap_requests_select on shift_swap_requests for select to authenticated
  using (
    owns_shift_staff_profile(property_id, requester_staff_profile_id)
    or (target_staff_profile_id is not null and owns_shift_staff_profile(property_id, target_staff_profile_id))
    or has_permission(property_id, 'shifts.requests.manage')
    or platform_operational_read_allowed(property_id)
  );

drop policy property_job_titles_select on property_job_titles;
create policy property_job_titles_select on property_job_titles for select to authenticated
  using (has_property_access(property_id) or platform_operational_read_allowed(property_id));

drop policy property_staff_details_select on property_staff_details;
create policy property_staff_details_select on property_staff_details for select to authenticated
  using (has_property_access(property_id) or platform_operational_read_allowed(property_id));

commit;
