import type { SupabaseClient } from '@supabase/supabase-js'

export async function addStaffMember(
  supabase: SupabaseClient,
  propertyId: string,
  profileId: string,
  planningUnitId: string,
): Promise<string> {
  const { data, error } = await supabase.rpc('add_shift_staff_member', {
    p_property_id: propertyId,
    p_profile_id: profileId,
    p_planning_unit_id: planningUnitId,
  })
  if (error) throw error
  if (!data) throw new Error('Il salvataggio non è stato confermato dal database')
  return data as string
}
