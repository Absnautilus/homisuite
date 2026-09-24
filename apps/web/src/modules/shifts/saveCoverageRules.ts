import type { SupabaseClient } from '@supabase/supabase-js'
import type { ShiftPlanningUnit } from '@homisuite/shifts-module'

/**
 * shift_rule_sets is immutable-by-convention and versioned: editing coverage
 * means inserting a new version with the updated coverage (keeping the unit's
 * existing hard/soft rules and preset_key) and pointing the planning unit's
 * current_rule_set_id at it, rather than updating the row in place.
 */
export async function saveCoverageRules(
  supabase: SupabaseClient,
  propertyId: string,
  unit: ShiftPlanningUnit,
  coverage: Array<{ code: string; quantity: number }>,
) {
  const { data, error } = await supabase.from('shift_rule_sets').insert({
    property_id: propertyId,
    planning_unit_id: unit.id,
    version: unit.ruleSetVersion + 1,
    preset_key: unit.ruleSetName,
    rules: {
      coverage: coverage.map(({ code, quantity }) => `${quantity} × ${code}`),
      hard: unit.rules.hard,
      soft: unit.rules.soft,
    },
  }).select('id').single()
  if (error) throw error

  const { error: activateError } = await supabase.from('shift_planning_units')
    .update({ current_rule_set_id: data.id })
    .eq('property_id', propertyId)
    .eq('id', unit.id)
  if (activateError) throw activateError
}
