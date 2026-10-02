import type { SupabaseClient } from '@supabase/supabase-js'
import type { ShiftPlanningUnit } from '@homisuite/shifts-module'

interface ExistingShiftRow {
  id: string
  staff_profile_id: string
  shift_date: string
  locked: boolean
  shift_codes: { code: string; kind: string } | { code: string; kind: string }[] | null
}

function relatedCode(row: ExistingShiftRow) {
  return Array.isArray(row.shift_codes) ? row.shift_codes[0] : row.shift_codes
}

function nextMonthStart(month: string): string {
  const [yearText, monthText] = month.split('-')
  return new Date(Date.UTC(Number(yearText), Number(monthText), 1)).toISOString().slice(0, 10)
}

export interface ClearDraftShiftsResult {
  cleared: Record<string, string[]>
}

/**
 * "Svuota bozza": deletes every shift in the unit's current month that
 * "Assegna automaticamente" itself would be allowed to overwrite -- not
 * locked, and either a work-kind code or 'R' -- leaving locked shifts and
 * absence/leave/permission entries untouched. Only valid while the month
 * is still Bozza (same guard generateUnitAssignments uses).
 */
export async function clearDraftShifts(
  supabase: SupabaseClient,
  propertyId: string,
  unit: ShiftPlanningUnit,
): Promise<ClearDraftShiftsResult> {
  if (unit.monthStatus === 'final') throw new Error('Il mese è Definitivo: riporta il mese a Bozza per modificarlo.')
  if (!unit.month) throw new Error('Mese non disponibile per questa unità.')

  const { data: existingShifts, error: existingShiftsError } = await supabase
    .from('shifts').select('id,staff_profile_id,shift_date,locked,shift_codes!inner(code,kind)')
    .eq('property_id', propertyId).eq('planning_unit_id', unit.id)
    .gte('shift_date', `${unit.month}-01`).lt('shift_date', nextMonthStart(unit.month))
  if (existingShiftsError) throw existingShiftsError

  const rows = (existingShifts ?? []) as ExistingShiftRow[]
  const idsToDelete: string[] = []
  const cleared: Record<string, string[]> = {}
  for (const row of rows) {
    const code = relatedCode(row)
    if (!code) continue
    const regeneratable = !row.locked && (code.kind === 'work' || code.code === 'R')
    if (!regeneratable) continue
    idsToDelete.push(row.id)
    cleared[row.staff_profile_id] ??= []
    cleared[row.staff_profile_id]!.push(row.shift_date)
  }
  if (idsToDelete.length > 0) {
    const { error: deleteError } = await supabase.from('shifts').delete().in('id', idsToDelete)
    if (deleteError) throw deleteError
  }
  return { cleared }
}
