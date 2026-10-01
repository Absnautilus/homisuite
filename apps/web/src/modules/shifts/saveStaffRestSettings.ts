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
  const fixedRestDays = restMode === 'fixed' ? parseRestDays(restDays) : []
  if (restMode === 'fixed' && fixedRestDays.length === 0) throw new Error('Seleziona almeno un giorno di riposo fisso')
  const { data, error } = await supabase.rpc('save_shift_staff_rest_settings', {
    p_property_id: propertyId,
    p_staff_profile_id: staffProfileId,
    p_rest_mode: restMode,
    p_fixed_rest_days: fixedRestDays,
  })
  if (error) throw error
  if (!data) throw new Error('Il salvataggio non è stato confermato dal database')
}
