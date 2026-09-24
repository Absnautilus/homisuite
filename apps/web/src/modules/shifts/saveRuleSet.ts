import type { SupabaseClient } from '@supabase/supabase-js'
import type { ShiftPlanningUnit } from '@homisuite/shifts-module'

/**
 * shift_rule_sets is immutable-by-convention and versioned: editing coverage,
 * hard or soft rules means inserting a new version with the updated fields
 * (keeping the unit's preset_key and engine_version) and pointing the
 * planning unit's current_rule_set_id at it, rather than updating the row
 * in place.
 */
export async function saveRuleSet(
  supabase: SupabaseClient,
  propertyId: string,
  unit: ShiftPlanningUnit,
  rules: { coverage: Array<{ code: string; quantity: number }>; hard: string[]; soft: string[] },
) {
  const { data, error } = await supabase.from('shift_rule_sets').insert({
    property_id: propertyId,
    planning_unit_id: unit.id,
    version: unit.ruleSetVersion + 1,
    status: 'active',
    preset_key: unit.ruleSetName,
    engine_version: unit.ruleSetEngineVersion ?? 'v1',
    rules: {
      coverage: rules.coverage.map(({ code, quantity }) => `${quantity} × ${code}`),
      hard: rules.hard,
      soft: rules.soft,
    },
  }).select('id').single()
  if (error) throw error

  const { error: activateError } = await supabase.from('shift_planning_units')
    .update({ current_rule_set_id: data.id })
    .eq('property_id', propertyId)
    .eq('id', unit.id)
  if (activateError) throw activateError
}
