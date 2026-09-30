import type { SupabaseClient } from '@supabase/supabase-js'

export type ShiftRequestKind = 'absences' | 'preassignments'

export interface ShiftRequestRow {
  id: string
  kind: ShiftRequestKind
  date: string
  label: string
  status: string
  note?: string
}

export async function loadOwnShiftRequests(
  supabase: SupabaseClient,
  propertyId: string,
  planningUnitId: string,
  staffProfileId: string,
): Promise<ShiftRequestRow[]> {
  const [absence, preassignment] = await Promise.all([
    supabase.from('shift_absence_requests').select('id,starts_on,absence_kind,status,note,created_at').eq('property_id', propertyId).eq('planning_unit_id', planningUnitId).eq('staff_profile_id', staffProfileId).order('created_at', { ascending: false }),
    supabase.from('shift_preassignments').select('id,shift_date,status,note,created_at,shift_codes(code)').eq('property_id', propertyId).eq('planning_unit_id', planningUnitId).eq('staff_profile_id', staffProfileId).order('created_at', { ascending: false }),
  ])
  if (absence.error) throw absence.error
  if (preassignment.error) throw preassignment.error
  const absenceRows = (absence.data ?? []).map((row) => ({ id: String(row.id), kind: 'absences' as const, date: String(row.starts_on), label: String(row.absence_kind), status: String(row.status), note: row.note ? String(row.note) : undefined }))
  const preRows = (preassignment.data ?? []).map((row) => {
    const related = Array.isArray(row.shift_codes) ? row.shift_codes[0] : row.shift_codes
    return { id: String(row.id), kind: 'preassignments' as const, date: String(row.shift_date), label: String(related?.code ?? 'Turno'), status: String(row.status), note: row.note ? String(row.note) : undefined }
  })
  return [...absenceRows, ...preRows].sort((a, b) => b.date.localeCompare(a.date))
}

export async function createAbsenceRequest(
  supabase: SupabaseClient, propertyId: string, planningUnitId: string, staffProfileId: string,
  input: { date: string; absenceKind: string; note?: string },
) {
  const { error } = await supabase.from('shift_absence_requests').insert({
    property_id: propertyId, planning_unit_id: planningUnitId, staff_profile_id: staffProfileId,
    starts_on: input.date, ends_on: input.date, absence_kind: input.absenceKind, status: 'pending', note: input.note || null,
  })
  if (error) throw error
}

export async function createPreassignmentRequest(
  supabase: SupabaseClient, propertyId: string, planningUnitId: string, staffProfileId: string, profileId: string,
  input: { date: string; shiftCodeId: string; note?: string },
) {
  const { error } = await supabase.from('shift_preassignments').insert({
    property_id: propertyId, planning_unit_id: planningUnitId, staff_profile_id: staffProfileId,
    shift_code_id: input.shiftCodeId, shift_date: input.date, locked: true, status: 'pending',
    note: input.note || null, created_by: profileId,
  })
  if (error) throw error
}
