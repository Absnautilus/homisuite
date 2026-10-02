import type { SupabaseClient } from '@supabase/supabase-js'
import type { VacationPeriod, VacationSettings } from '@homisuite/shifts-module'

const DEFAULT_SETTINGS: VacationSettings = { periodsPerYear: 3, minDays: 1, maxDays: 30 }

export async function loadVacationData(
  supabase: SupabaseClient,
  propertyId: string,
): Promise<{ periods: VacationPeriod[]; settings: VacationSettings }> {
  const [periodsResult, settingsResult] = await Promise.all([
    supabase.from('shift_vacation_periods').select('id,staff_profile_id,period_index,start_date,end_date,status').eq('property_id', propertyId),
    supabase.from('shift_vacation_settings').select('periods_per_year,min_days,max_days').eq('property_id', propertyId).maybeSingle(),
  ])
  if (periodsResult.error) throw periodsResult.error
  if (settingsResult.error) throw settingsResult.error

  const periods: VacationPeriod[] = (periodsResult.data ?? []).map((row) => ({
    id: String(row.id),
    staffProfileId: String(row.staff_profile_id),
    periodIndex: Number(row.period_index),
    start: String(row.start_date),
    end: String(row.end_date),
    status: row.status === 'confirmed' ? 'confirmed' : 'pending',
  }))

  const settingsRow = settingsResult.data
  const settings: VacationSettings = settingsRow ? {
    periodsPerYear: Number(settingsRow.periods_per_year),
    minDays: Number(settingsRow.min_days),
    maxDays: Number(settingsRow.max_days),
  } : DEFAULT_SETTINGS

  return { periods, settings }
}

export async function requestVacationPeriod(
  supabase: SupabaseClient,
  propertyId: string,
  input: { staffProfileId: string; periodIndex: number; start: string; end: string },
) {
  const { error } = await supabase.rpc('request_vacation_period', {
    p_property_id: propertyId,
    p_staff_profile_id: input.staffProfileId,
    p_period_index: input.periodIndex,
    p_start: input.start,
    p_end: input.end,
  })
  if (error) throw error
}

export async function decideVacationPeriod(supabase: SupabaseClient, periodId: string, approve: boolean) {
  const { error } = await supabase.rpc('decide_vacation_period', { p_period_id: periodId, p_approve: approve })
  if (error) throw error
}

export async function saveVacationSettings(supabase: SupabaseClient, propertyId: string, settings: VacationSettings) {
  const { error } = await supabase.from('shift_vacation_settings').upsert({
    property_id: propertyId,
    periods_per_year: settings.periodsPerYear,
    min_days: settings.minDays,
    max_days: settings.maxDays,
    updated_at: new Date().toISOString(),
  })
  if (error) throw error
}
