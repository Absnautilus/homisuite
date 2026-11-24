import type { SupabaseClient } from '@supabase/supabase-js'

export async function setShiftLocked(
  supabase: SupabaseClient,
  propertyId: string,
  planningUnitId: string,
  staffProfileId: string,
  shiftDate: string,
  locked: boolean,
  note?: string | null,
) {
  const month = `${shiftDate.slice(0, 7)}-01`
  const { data: monthState, error: stateError } = await supabase
    .from('shift_month_states')
    .select('status')
    .eq('property_id', propertyId)
    .eq('planning_unit_id', planningUnitId)
    .eq('month', month)
    .maybeSingle()
  if (stateError) throw stateError
  if (monthState?.status === 'final') throw new Error('Il mese è definitivo.')

  // Unlocking always clears the note too -- otherwise a stale note from a
  // previous DNM would silently reappear the next time this same cell gets
  // locked again, attached to a reason that may no longer apply.
  const { data, error } = await supabase
    .from('shifts')
    .update({ locked, note: locked ? (note ?? null) : null })
    .eq('property_id', propertyId)
    .eq('planning_unit_id', planningUnitId)
    .eq('staff_profile_id', staffProfileId)
    .eq('shift_date', shiftDate)
    .select('id')
    .maybeSingle()
  if (error) throw error
  if (!data) throw new Error('Puoi bloccare solo un turno già assegnato.')
}
