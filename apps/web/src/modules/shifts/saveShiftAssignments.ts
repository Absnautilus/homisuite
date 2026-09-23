import type { SupabaseClient } from '@supabase/supabase-js'
import type { ShiftPlanningUnit } from '@homisuite/shifts-module'

export interface ShiftAssignmentChange {
  planningUnitId: string
  staffProfileId: string
  shiftDate: string
  code: string
}

export async function saveShiftAssignments(
  supabase: SupabaseClient,
  propertyId: string,
  profileId: string,
  unit: ShiftPlanningUnit,
  changes: ShiftAssignmentChange[],
) {
  if (!changes.length) return

  const codeIds = new Map<string, string>()
  const { data: codes, error: codeError } = await supabase
    .from('shift_codes')
    .select('id,code')
    .eq('property_id', propertyId)
    .eq('planning_unit_id', unit.id)
  if (codeError) throw codeError
  for (const code of codes ?? []) codeIds.set(code.code, code.id)

  for (const change of changes) {
    if (!change.code) {
      const { error } = await supabase.from('shifts').delete()
        .eq('property_id', propertyId)
        .eq('planning_unit_id', change.planningUnitId)
        .eq('staff_profile_id', change.staffProfileId)
        .eq('shift_date', change.shiftDate)
      if (error) throw error
      continue
    }
    const shiftCodeId = codeIds.get(change.code)
    if (!shiftCodeId) throw new Error(`Codice turno sconosciuto: ${change.code}`)
    const { error } = await supabase.from('shifts').upsert({
      property_id: propertyId,
      planning_unit_id: change.planningUnitId,
      staff_profile_id: change.staffProfileId,
      shift_code_id: shiftCodeId,
      shift_date: change.shiftDate,
      source: 'manual',
      created_by: profileId,
    }, { onConflict: 'planning_unit_id,staff_profile_id,shift_date' })
    if (error) throw error
  }
}
