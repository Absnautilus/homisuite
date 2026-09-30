import type { SupabaseClient } from '@supabase/supabase-js'

export interface StaffShiftPreferences {
  preferredShiftCodes: string[]
  weekdayShiftPreferences: Record<string, string[]>
}

export async function loadStaffShiftPreferences(supabase: SupabaseClient, propertyId: string, staffProfileId: string): Promise<StaffShiftPreferences> {
  const { data, error } = await supabase.from('shift_staff_profiles')
    .select('preferred_shift_codes,weekday_shift_preferences').eq('property_id', propertyId).eq('id', staffProfileId).single()
  if (error) throw error
  return { preferredShiftCodes: data.preferred_shift_codes ?? [], weekdayShiftPreferences: data.weekday_shift_preferences ?? {} }
}

export async function saveStaffShiftPreferences(supabase: SupabaseClient, propertyId: string, staffProfileId: string, preferences: StaffShiftPreferences): Promise<void> {
  const { error } = await supabase.from('shift_staff_profiles').update({
    preferred_shift_codes: preferences.preferredShiftCodes,
    weekday_shift_preferences: preferences.weekdayShiftPreferences,
  }).eq('property_id', propertyId).eq('id', staffProfileId)
  if (error) throw error
}
