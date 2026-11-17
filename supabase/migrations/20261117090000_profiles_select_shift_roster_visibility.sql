-- A staff member can be genuinely scheduled in Turni (an active
-- shift_staff_profiles row, a job title via property_staff_details) with
-- no memberships row at all -- reported: a real person's Turni roster
-- entry showed the literal placeholder name "Dipendente" instead of her
-- actual name, because shiftLiveData.ts's name lookup falls back to that
-- placeholder whenever the joined profiles row comes back empty, and
-- profiles_select's existing checks (shares_accessible_property,
-- can_manage_profile) are both membership-based -- with no membership on
-- either side, her own profile row is invisible to every other viewer,
-- herself excluded (auth.uid() = id).
--
-- Extend visibility to cover exactly this case: whoever can legitimately
-- see someone's shift_staff_profiles row (can_view_shift_staff_profile,
-- the same check shift_staff_profiles_select itself already uses) can
-- also see that person's name -- a narrower grant than the existing
-- membership-based branches, scoped to Turni roster visibility only.
alter policy profiles_select on public.profiles
  using (
    (auth.uid() = id)
    or shares_accessible_property(id)
    or can_manage_profile(id)
    or exists (
      select 1 from shift_staff_profiles ssp
      where ssp.profile_id = profiles.id
        and ssp.active
        and can_view_shift_staff_profile(ssp.property_id, ssp.id)
    )
  );
