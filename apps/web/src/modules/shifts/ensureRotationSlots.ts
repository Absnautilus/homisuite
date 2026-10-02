import type { SupabaseClient } from '@supabase/supabase-js'
import { nextFreeRotationSlot } from '@homisuite/shifts-module'

export interface StaffProfileRow {
  id: string
  shift_type: string
  rest_mode: string
  fixed_rest_days: number[] | null
  rotation_slot: number | null
}

/**
 * Assigns a rotation_slot to any rotating-rest member of `unitStaffRows` who
 * doesn't have one yet -- the smallest integer not already used by another
 * profile at the PROPERTY (slots are unique property-wide, not per unit) --
 * and persists the new values. Returns a profileId -> slot map for the
 * members that got a new slot just now; callers fall back to the row's own
 * rotation_slot for everyone else.
 *
 * "Used" is scoped by rotation_slot being set, not by rest_mode: the DB's
 * uniqueness constraint (shift_staff_profiles_rotation_slot_unique) covers
 * every row with a non-null slot regardless of rest_mode, and a profile that
 * switched from rotating to fixed keeps its old slot value rather than
 * having it cleared. Filtering this query to rest_mode='rotating' missed
 * exactly that case -- the picker would offer a number that looked free but
 * was still held by a now-fixed profile, and the UPDATE below failed with a
 * 409 unique-violation that silently dropped the whole assignment for
 * whoever got that number next.
 */
export async function ensureRotationSlots(
  supabase: SupabaseClient,
  propertyId: string,
  unitStaffRows: StaffProfileRow[],
): Promise<Map<string, number>> {
  const { data: propertyRotating, error } = await supabase
    .from('shift_staff_profiles').select('id,rotation_slot').eq('property_id', propertyId).not('rotation_slot', 'is', null)
  if (error) throw error

  const usedSlots = new Set((propertyRotating ?? []).map((row) => row.rotation_slot).filter((slot): slot is number => slot != null))
  const newSlotByProfileId = new Map<string, number>()
  for (const staff of unitStaffRows) {
    if (staff.rest_mode === 'fixed' || staff.rotation_slot != null) continue
    const slot = nextFreeRotationSlot([...usedSlots].map((value) => ({ rotationSlot: value })))
    usedSlots.add(slot)
    newSlotByProfileId.set(staff.id, slot)
  }
  await Promise.all([...newSlotByProfileId.entries()].map(([id, rotationSlot]) =>
    supabase.from('shift_staff_profiles').update({ rotation_slot: rotationSlot }).eq('id', id).then(({ error: updateError }) => { if (updateError) throw updateError }),
  ))
  return newSlotByProfileId
}
