import type { SupabaseClient } from '@supabase/supabase-js'
import { assertRowAffected } from './assertRowAffected'

export async function saveMemberOrder(
  supabase: SupabaseClient,
  propertyId: string,
  planningUnitId: string,
  staffProfileIds: string[],
) {
  for (const [index, staffProfileId] of staffProfileIds.entries()) {
    const { data, error } = await supabase.from('shift_unit_members')
      .update({ display_order: index })
      .eq('property_id', propertyId)
      .eq('planning_unit_id', planningUnitId)
      .eq('staff_profile_id', staffProfileId)
      .select('id')
      .maybeSingle()
    if (error) throw error
    assertRowAffected(data, 'Membro non trovato in questa unità.')
  }
}
