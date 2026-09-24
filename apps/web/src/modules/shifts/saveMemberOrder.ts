import type { SupabaseClient } from '@supabase/supabase-js'

export async function saveMemberOrder(
  supabase: SupabaseClient,
  propertyId: string,
  planningUnitId: string,
  staffProfileIds: string[],
) {
  for (const [index, staffProfileId] of staffProfileIds.entries()) {
    const { error } = await supabase.from('shift_unit_members')
      .update({ display_order: index })
      .eq('property_id', propertyId)
      .eq('planning_unit_id', planningUnitId)
      .eq('staff_profile_id', staffProfileId)
    if (error) throw error
  }
}
