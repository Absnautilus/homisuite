import type { SupabaseClient } from '@supabase/supabase-js'
import { nextFreeRotationSlot, type RestRotationProfile } from '@homisuite/shifts-module'
import { assertRowAffected } from './assertRowAffected'

export interface StaffProfileRow {
  id: string
  shift_type: string
  rest_mode: string
  fixed_rest_days: number[] | null
  rotation_slot: number | null
}

/**
 * Assigns a rotation_slot to any rotating-rest member of `unitStaffRows` who
 * doesn't have one yet -- the smallest integer that's both free at the
 * PROPERTY (slots are unique property-wide, not per unit) and doesn't land
 * a new hire on a weekday someone else in THIS unit already rests on -- and
 * persists the new values. Returns a profileId -> slot map for the members
 * that got a new slot just now; callers fall back to the row's own
 * rotation_slot for everyone else.
 *
 * Property-wide "used" is scoped by rotation_slot being set, not by
 * rest_mode: the DB's uniqueness constraint
 * (shift_staff_profiles_rotation_slot_unique) covers every row with a
 * non-null slot regardless of rest_mode, and a profile that switched from
 * rotating to fixed keeps its old slot value rather than having it cleared.
 * Filtering this query to rest_mode='rotating' missed exactly that case --
 * the picker would offer a number that looked free but was still held by a
 * now-fixed profile, and the UPDATE below failed with a 409
 * unique-violation that silently dropped the whole assignment for whoever
 * got that number next.
 *
 * The per-unit weekday check needs each member's role as scheduled in THIS
 * unit (shift_unit_members.assignment_profile_key -- what the "Tipo turno"
 * column in the Employees panel shows), not shift_staff_profiles.shift_type,
 * which is a leftover onboarding default ('day' for almost everyone): a
 * unit's real notturno/turnante pair would otherwise go unrecognized, and
 * the slot picker could still hand out a weekday already in use.
 */
export async function ensureRotationSlots(
  supabase: SupabaseClient,
  propertyId: string,
  planningUnitId: string,
  unitStaffRows: StaffProfileRow[],
  turnanteFollowsNotturno = true,
): Promise<Map<string, number>> {
  const memberIds = unitStaffRows.map((staff) => staff.id)
  const [{ data: propertyRotating, error: propertyError }, { data: unitMembers, error: unitMembersError }] = await Promise.all([
    supabase.from('shift_staff_profiles').select('id,rotation_slot').eq('property_id', propertyId).not('rotation_slot', 'is', null),
    memberIds.length > 0
      ? supabase.from('shift_unit_members').select('staff_profile_id,assignment_profile_key').eq('property_id', propertyId).eq('planning_unit_id', planningUnitId).in('staff_profile_id', memberIds)
      : Promise.resolve({ data: [], error: null }),
  ])
  if (propertyError) throw propertyError
  if (unitMembersError) throw unitMembersError

  const roleByStaffId = new Map((unitMembers ?? []).map((row) => [String(row.staff_profile_id), row.assignment_profile_key as string | null]))
  const unitProfiles: RestRotationProfile[] = unitStaffRows.map((staff) => ({
    id: staff.id,
    shiftType: (roleByStaffId.get(staff.id) ?? staff.shift_type) as RestRotationProfile['shiftType'],
    restMode: staff.rest_mode as RestRotationProfile['restMode'],
    fixedRestDays: staff.fixed_rest_days ?? [],
    rotationSlot: staff.rotation_slot,
  }))
  const profileById = new Map(unitProfiles.map((profile) => [profile.id, profile]))

  const usedSlots = new Set((propertyRotating ?? []).map((row) => row.rotation_slot).filter((slot): slot is number => slot != null))
  const newSlotByProfileId = new Map<string, number>()
  for (const staff of unitStaffRows) {
    if (staff.rest_mode === 'fixed' || staff.rotation_slot != null) continue
    const slot = nextFreeRotationSlot([...usedSlots].map((value) => ({ rotationSlot: value })), unitProfiles, turnanteFollowsNotturno)
    usedSlots.add(slot)
    newSlotByProfileId.set(staff.id, slot)
    // Feeds the very next iteration's weekday check -- two new hires in the
    // same batch must not collide with each other either.
    const profile = profileById.get(staff.id)
    if (profile) profile.rotationSlot = slot
  }
  await Promise.all([...newSlotByProfileId.entries()].map(([id, rotationSlot]) =>
    supabase.from('shift_staff_profiles').update({ rotation_slot: rotationSlot }).eq('id', id).select('id').maybeSingle().then(({ data, error: updateError }) => {
      if (updateError) throw updateError
      assertRowAffected(data, 'Profilo staff non trovato.')
    }),
  ))
  return newSlotByProfileId
}
