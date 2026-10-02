import type { SupabaseClient } from '@supabase/supabase-js'

export interface RotationSlotUpdate { staffProfileId: string; rotationSlot: number }
export interface SaveInferredRotationSlotsResult { applied: string[]; skipped: string[] }

/**
 * Persists rotation slots inferred from a manually-filled month ("Imposta
 * rotazione da questo mese"), refusing any that would collide with a slot
 * already held by someone else at the property -- including another update
 * in this same batch, e.g. two people inferred to the exact same weekday
 * pattern. The DB's uniqueness constraint covers every profile regardless
 * of rest_mode (see ensureRotationSlots), so a collision here would
 * otherwise surface as an opaque 409 instead of a clear "skipped" result.
 */
export async function saveInferredRotationSlots(
  supabase: SupabaseClient,
  propertyId: string,
  updates: RotationSlotUpdate[],
): Promise<SaveInferredRotationSlotsResult> {
  if (updates.length === 0) return { applied: [], skipped: [] }

  const updatingIds = new Set(updates.map((update) => update.staffProfileId))
  const { data: others, error } = await supabase
    .from('shift_staff_profiles').select('id,rotation_slot').eq('property_id', propertyId).not('rotation_slot', 'is', null)
  if (error) throw error
  const takenByOthers = new Set((others ?? []).filter((row) => !updatingIds.has(row.id)).map((row) => row.rotation_slot as number))

  const applied: string[] = []
  const skipped: string[] = []
  const claimedThisBatch = new Set<number>()
  for (const update of updates) {
    if (takenByOthers.has(update.rotationSlot) || claimedThisBatch.has(update.rotationSlot)) {
      skipped.push(update.staffProfileId)
      continue
    }
    claimedThisBatch.add(update.rotationSlot)
    const { error: updateError } = await supabase.from('shift_staff_profiles')
      .update({ rotation_slot: update.rotationSlot }).eq('property_id', propertyId).eq('id', update.staffProfileId)
    if (updateError) throw updateError
    applied.push(update.staffProfileId)
  }
  return { applied, skipped }
}
