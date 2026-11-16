-- A staff member can have an active shift_staff_profiles row (be scheduled,
-- have shifts assigned) without holding any formal shifts.view/shifts.manage
-- permission grant at all -- ordinary staff aren't required to hold one.
-- owns_shift_staff_profile's self-service branch still required
-- has_permission(property_id, 'shifts.view') on top of "this row is mine",
-- which made "Salva preferenze" fail for exactly those staff. Owning your
-- own active staff profile is sufficient proof you're allowed to edit your
-- own preferences / respond to your own swap offers -- drop the extra
-- permission requirement for the self branch. The platform-impersonation
-- branch (added in 20261116130000) is unaffected.
create or replace function public.owns_shift_staff_profile(p_property_id uuid, p_staff_profile_id uuid)
 returns boolean
 language sql
 stable security definer
 set search_path to ''
as $function$
  select exists (
    select 1
    from public.shift_staff_profiles staff
    where staff.property_id = p_property_id
      and staff.id = p_staff_profile_id
      and staff.active
      and (
        staff.profile_id = (select auth.uid())
        or public.platform_impersonated_action_allowed(
          p_property_id,
          (select m.id from public.memberships m
             where m.property_id = p_property_id and m.profile_id = staff.profile_id and m.status = 'active'
             limit 1)
        )
      )
  );
$function$;
