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
