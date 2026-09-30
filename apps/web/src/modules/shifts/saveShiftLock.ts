import type { SupabaseClient } from '@supabase/supabase-js'

export async function setShiftLocked(
  supabase: SupabaseClient,
  propertyId: string,
  planningUnitId: string,
  staffProfileId: string,
  shiftDate: string,
  locked: boolean,
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

  const { data, error } = await supabase
    .from('shifts')
    .update({ locked })
    .eq('property_id', propertyId)
    .eq('planning_unit_id', planningUnitId)
    .eq('staff_profile_id', staffProfileId)
    .eq('shift_date', shiftDate)
    .select('id')
    .maybeSingle()
  if (error) throw error
  if (!data) throw new Error('Puoi bloccare solo un turno già assegnato.')
}
