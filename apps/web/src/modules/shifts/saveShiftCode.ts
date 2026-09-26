import type { SupabaseClient } from '@supabase/supabase-js'
import { contrastTextColor, type ShiftCode, type ShiftCodeSave } from '@homisuite/shifts-module'

function timeLabel(start: string | null, end: string | null): string {
  if (!start || !end) return ''
  return `${start.slice(0, 5)}–${end.slice(0, 5)}`
}

function toShiftCode(row: { id: string; code: string; label: string; kind: string; starts_at: string | null; ends_at: string | null; color: string; text_color: string | null; active: boolean }): ShiftCode {
  return {
    id: row.id,
    code: row.code,
    label: row.label,
    time: timeLabel(row.starts_at, row.ends_at),
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    kind: row.kind as ShiftCode['kind'],
    color: row.color,
    textColor: row.text_color ?? contrastTextColor(row.color),
    active: row.active,
  }
}

/** Creates a new code, or updates an existing one when `input.id` is set. */
export async function saveShiftCode(supabase: SupabaseClient, propertyId: string, input: ShiftCodeSave): Promise<ShiftCode> {
  const values = {
    code: input.code,
    label: input.label,
    kind: input.kind,
    starts_at: input.startsAt,
    ends_at: input.endsAt,
    color: input.color,
    text_color: input.textColor,
  }
  const query = input.id
    ? supabase.from('shift_codes').update(values).eq('property_id', propertyId).eq('id', input.id)
    : supabase.from('shift_codes').insert({ ...values, property_id: propertyId, planning_unit_id: input.planningUnitId })
  const { data, error } = await query.select('id,code,label,kind,starts_at,ends_at,color,text_color,active').single()
  if (error) throw error
  return toShiftCode(data)
}

/**
 * Deletes a code outright when it was never used in a real shift; a code
 * referenced by any shift row (shifts.shift_code_id references shift_codes
 * ... on delete restrict) can't be deleted without destroying schedule
 * history, so it's archived (active: false) instead.
 */
export async function deleteOrArchiveShiftCode(supabase: SupabaseClient, propertyId: string, codeId: string): Promise<'deleted' | 'archived'> {
  const { error } = await supabase.from('shift_codes').delete().eq('property_id', propertyId).eq('id', codeId)
  if (!error) return 'deleted'
  if (error.code !== '23503') throw error
  const { error: archiveError } = await supabase.from('shift_codes').update({ active: false }).eq('property_id', propertyId).eq('id', codeId)
  if (archiveError) throw archiveError
  return 'archived'
}
