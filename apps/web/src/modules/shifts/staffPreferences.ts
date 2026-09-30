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
  void propertyId
  const { error } = await supabase.rpc('save_my_shift_preferences', {
    p_staff_profile_id: staffProfileId,
    p_preferred_shift_codes: preferences.preferredShiftCodes,
    p_weekday_shift_preferences: preferences.weekdayShiftPreferences,
  })
  if (error) throw error
}
