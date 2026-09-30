import type { SupabaseClient } from '@supabase/supabase-js'

export async function createShiftSwapRequest(
  supabase: SupabaseClient, propertyId: string, planningUnitId: string, requesterStaffProfileId: string,
  requestedShiftId: string, targetStaffProfileId: string, offeredShiftId: string, note?: string,
) {
  const { error } = await supabase.from('shift_swap_requests').insert({
    property_id: propertyId, planning_unit_id: planningUnitId, requester_staff_profile_id: requesterStaffProfileId,
    requested_shift_id: requestedShiftId, target_staff_profile_id: targetStaffProfileId, offered_shift_id: offeredShiftId,
    status: 'pending', note: note || null,
  })
  if (error) throw error
}

export async function respondShiftSwap(supabase: SupabaseClient, requestId: string, accept: boolean) {
  const { error } = await supabase.rpc('respond_shift_swap', { p_request_id: requestId, p_accept: accept })
  if (error) throw error
}

export async function decidePreassignment(supabase: SupabaseClient, requestId: string, approve: boolean) {
  const { error } = await supabase.rpc('decide_shift_preassignment', { p_request_id: requestId, p_approve: approve })
  if (error) throw error
}

export interface ShiftRequestItem { id: string; status: string; date: string; label: string; note?: string | null }

export async function createAbsenceRequest(supabase: SupabaseClient, propertyId: string, planningUnitId: string, staffProfileId: string, date: string, absenceKind: string, note?: string) {
  const { error } = await supabase.from('shift_absence_requests').insert({ property_id: propertyId, planning_unit_id: planningUnitId, staff_profile_id: staffProfileId, starts_on: date, ends_on: date, absence_kind: absenceKind, status: 'pending', note: note || null })
  if (error) throw error
}

export async function createPreassignmentRequest(supabase: SupabaseClient, propertyId: string, planningUnitId: string, staffProfileId: string, shiftCodeId: string, date: string, note?: string) {
  const { error } = await supabase.from('shift_preassignments').insert({ property_id: propertyId, planning_unit_id: planningUnitId, staff_profile_id: staffProfileId, shift_code_id: shiftCodeId, shift_date: date, status: 'pending', locked: true, note: note || null })
  if (error) throw error
}

export async function listMyShiftRequests(supabase: SupabaseClient, propertyId: string, planningUnitId: string, staffProfileId: string) {
  const [absence, preassignment, swap] = await Promise.all([
    supabase.from('shift_absence_requests').select('id,status,starts_on,absence_kind,note').eq('property_id', propertyId).eq('planning_unit_id', planningUnitId).eq('staff_profile_id', staffProfileId).order('created_at', { ascending: false }),
    supabase.from('shift_preassignments').select('id,status,shift_date,note,shift_codes(code)').eq('property_id', propertyId).eq('planning_unit_id', planningUnitId).eq('staff_profile_id', staffProfileId).order('created_at', { ascending: false }),
    supabase.from('shift_swap_requests').select('id,status,note,requested_shift_id').eq('property_id', propertyId).eq('planning_unit_id', planningUnitId).eq('requester_staff_profile_id', staffProfileId).order('created_at', { ascending: false }),
  ])
  if (absence.error) throw absence.error
  if (preassignment.error) throw preassignment.error
  if (swap.error) throw swap.error
  return { absences: absence.data ?? [], preassignments: preassignment.data ?? [], swaps: swap.data ?? [] }
}

export async function decideAbsenceRequest(supabase: SupabaseClient, requestId: string, approve: boolean) {
  const { data: user, error: userError } = await supabase.auth.getUser()
  if (userError || !user.user) throw userError ?? new Error('Not authenticated')
  const { error } = await supabase.from('shift_absence_requests').update({
    status: approve ? 'approved' : 'rejected', decided_by: user.user.id, decided_at: new Date().toISOString(),
  }).eq('id', requestId)
  if (error) throw error
}

export async function loadShiftRequestInbox(supabase: SupabaseClient, propertyId: string) {
  const [absence, preassignment, swap] = await Promise.all([
    supabase.from('shift_absence_requests').select('id,planning_unit_id,staff_profile_id,starts_on,ends_on,absence_kind,status,note').eq('property_id', propertyId).eq('status', 'pending').order('created_at'),
    supabase.from('shift_preassignments').select('id,planning_unit_id,staff_profile_id,shift_date,status,note,shift_codes(code)').eq('property_id', propertyId).eq('status', 'pending').order('created_at'),
    supabase.from('shift_swap_requests').select('id,planning_unit_id,requester_staff_profile_id,target_staff_profile_id,status,note').eq('property_id', propertyId).in('status', ['pending','accepted']).order('created_at'),
  ])
  if (absence.error) throw absence.error
  if (preassignment.error) throw preassignment.error
  if (swap.error) throw swap.error
  return { absences: absence.data ?? [], preassignments: preassignment.data ?? [], swaps: swap.data ?? [] }
}
