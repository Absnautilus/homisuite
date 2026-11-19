import type { SupabaseClient } from '@supabase/supabase-js'
import type { RoleCodes, ShiftPlanningUnit } from '@homisuite/shifts-module'

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
  rules: { coverage: Array<{ code: string; quantity: number }>; hard: string[]; soft: string[]; restRotationPairsPerCycle: number; roleCodes: Record<string, RoleCodes> },
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
      restRotationPairsPerCycle: rules.restRotationPairsPerCycle,
      roleCodes: rules.roleCodes,
    },
  }).select('id').single()
  if (error) throw error

  // Without the row-count check, a 0-row match (wrong/stale unit.id) threw
  // nothing: the new version above is inserted and the unit just keeps
  // pointing at its old current_rule_set_id, so the edited rules look
  // saved but never actually take effect.
  const { data: activated, error: activateError } = await supabase.from('shift_planning_units')
    .update({ current_rule_set_id: data.id })
    .eq('property_id', propertyId)
    .eq('id', unit.id)
    .select('id')
    .maybeSingle()
  if (activateError) throw activateError
  if (!activated) throw new Error('Unità di pianificazione non trovata.')
}
