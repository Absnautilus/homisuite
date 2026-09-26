import type { SupabaseClient } from '@supabase/supabase-js'
import type { ShiftPlanningUnit } from '@homisuite/shifts-module'

/** Flips a unit's month between Bozza (draft) and Definitivo (final). */
export async function setMonthStatus(
  supabase: SupabaseClient,
  propertyId: string,
  profileId: string,
  unit: ShiftPlanningUnit,
  status: 'draft' | 'final',
): Promise<void> {
  if (!unit.month) throw new Error('Mese non disponibile per questa unità.')
  const { error } = await supabase.from('shift_month_states').upsert({
    property_id: propertyId,
    planning_unit_id: unit.id,
    month: `${unit.month}-01`,
    status,
    finalized_at: status === 'final' ? new Date().toISOString() : null,
    finalized_by: status === 'final' ? profileId : null,
  }, { onConflict: 'planning_unit_id,month' })
  if (error) throw error
}
