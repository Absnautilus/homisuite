import type { SupabaseClient } from '@supabase/supabase-js'

const DAY_INDEX: Record<string, number> = { Dom: 0, Lun: 1, Mar: 2, Mer: 3, Gio: 4, Ven: 5, Sab: 6 }

function parseRestDays(label: string): number[] {
  return label.split('+').map((part) => DAY_INDEX[part.trim()]).filter((day): day is number => day !== undefined)
}

export async function saveStaffRestSettings(
  supabase: SupabaseClient,
  propertyId: string,
  staffProfileId: string,
  restMode: 'fixed' | 'rotating',
  restDays: string,
): Promise<void> {
  const { error } = await supabase
    .from('shift_staff_profiles')
    .update({
      rest_mode: restMode,
      fixed_rest_days: restMode === 'fixed' ? parseRestDays(restDays) : [],
      updated_at: new Date().toISOString(),
    })
    .eq('property_id', propertyId)
    .eq('id', staffProfileId)
  if (error) throw error
}
