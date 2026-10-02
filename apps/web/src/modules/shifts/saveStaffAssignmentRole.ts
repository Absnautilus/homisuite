import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * Persists the per-unit scheduling role ("Tipo turno" in the Employees
 * panel) -- what "Assegna automaticamente" reads to know who's FOM, the
 * night titolare, the rotating turnante, etc. This lives on
 * shift_unit_members, not shift_staff_profiles, because the role is scoped
 * to one planning-unit membership, not the person globally.
 */
export async function saveStaffAssignmentRole(
  supabase: SupabaseClient,
  propertyId: string,
  planningUnitId: string,
  staffProfileId: string,
  assignmentProfileKey: string,
): Promise<void> {
  const { error } = await supabase.from('shift_unit_members')
    .update({ assignment_profile_key: assignmentProfileKey })
    .eq('property_id', propertyId)
    .eq('planning_unit_id', planningUnitId)
    .eq('staff_profile_id', staffProfileId)
  if (error) throw error
}
