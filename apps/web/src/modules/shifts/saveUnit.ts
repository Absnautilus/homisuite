import type { SupabaseClient } from '@supabase/supabase-js'
import type { UnitSave, UnitSaveResult } from '@homisuite/shifts-module'

function slugify(name: string): string {
  const base = name.trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'unita'
  return `${base}-${Math.random().toString(36).slice(2, 7)}`
}

/**
 * Recomputes which staff are auto-included in a unit from its selected job
 * titles. A member whose inclusion is `explicit_include`/`explicit_exclude`
 * (a manual override) is never touched here. A `job_title`-sourced member no
 * longer matching is deactivated, not deleted -- `shifts.staff_profile_id`
 * references `shift_unit_members` `on delete cascade`, so deleting the
 * membership row would silently wipe that person's schedule history too.
 */
async function syncUnitMembership(supabase: SupabaseClient, propertyId: string, unitId: string, jobTitleIds: string[]): Promise<void> {
  const [{ data: staffDetails, error: staffDetailsError }, { data: existingMembers, error: membersError }] = await Promise.all([
    jobTitleIds.length === 0
      ? Promise.resolve({ data: [] as Array<{ profile_id: string }>, error: null })
      : supabase.from('property_staff_details').select('profile_id').eq('property_id', propertyId).in('job_title_id', jobTitleIds),
    supabase.from('shift_unit_members').select('id,staff_profile_id,inclusion_source,active').eq('property_id', propertyId).eq('planning_unit_id', unitId),
  ])
  if (staffDetailsError) throw staffDetailsError
  if (membersError) throw membersError

  const profileIds = [...new Set((staffDetails ?? []).map((row) => row.profile_id))]
  const { data: staffProfiles, error: staffProfilesError } = profileIds.length === 0
    ? { data: [] as Array<{ id: string }>, error: null }
    : await supabase.from('shift_staff_profiles').select('id').eq('property_id', propertyId).in('profile_id', profileIds)
  if (staffProfilesError) throw staffProfilesError
  const matchingStaffProfileIds = new Set((staffProfiles ?? []).map((row) => row.id))

  const existingByStaffId = new Map((existingMembers ?? []).map((row) => [row.staff_profile_id as string, row]))
  const toInsert: string[] = []
  const toReactivate: string[] = []
  const toDeactivate: string[] = []

  for (const staffProfileId of matchingStaffProfileIds) {
    const existing = existingByStaffId.get(staffProfileId)
    if (!existing) { toInsert.push(staffProfileId); continue }
    if (existing.inclusion_source === 'job_title' && !existing.active) toReactivate.push(existing.id)
  }
  for (const [staffProfileId, existing] of existingByStaffId) {
    if (existing.inclusion_source === 'job_title' && existing.active && !matchingStaffProfileIds.has(staffProfileId)) toDeactivate.push(existing.id)
  }

  await Promise.all([
    toInsert.length === 0 ? Promise.resolve() : supabase.from('shift_unit_members').insert(
      toInsert.map((staffProfileId) => ({ property_id: propertyId, planning_unit_id: unitId, staff_profile_id: staffProfileId, inclusion_source: 'job_title' as const, active: true })),
    ).then(({ error }) => { if (error) throw error }),
    toReactivate.length === 0 ? Promise.resolve() : supabase.from('shift_unit_members').update({ active: true }).in('id', toReactivate).then(({ error }) => { if (error) throw error }),
    toDeactivate.length === 0 ? Promise.resolve() : supabase.from('shift_unit_members').update({ active: false }).in('id', toDeactivate).then(({ error }) => { if (error) throw error }),
  ])
}

async function saveUnitJobTitles(supabase: SupabaseClient, propertyId: string, unitId: string, jobTitleIds: string[]): Promise<void> {
  const { data: existingLinks, error: existingLinksError } = await supabase
    .from('shift_unit_job_titles').select('job_title_id').eq('property_id', propertyId).eq('planning_unit_id', unitId)
  if (existingLinksError) throw existingLinksError

  const existingIds = new Set((existingLinks ?? []).map((row) => row.job_title_id as string))
  const nextIds = new Set(jobTitleIds)
  const toRemove = [...existingIds].filter((id) => !nextIds.has(id))
  const toAdd = [...nextIds].filter((id) => !existingIds.has(id))

  if (toRemove.length > 0) {
    const { error } = await supabase.from('shift_unit_job_titles').delete().eq('property_id', propertyId).eq('planning_unit_id', unitId).in('job_title_id', toRemove)
    if (error) throw error
  }
  if (toAdd.length > 0) {
    const { error } = await supabase.from('shift_unit_job_titles').insert(toAdd.map((jobTitleId) => ({ property_id: propertyId, planning_unit_id: unitId, job_title_id: jobTitleId })))
    if (error) throw error
  }

  await syncUnitMembership(supabase, propertyId, unitId, jobTitleIds)
}

/** Creates a new planning unit, or updates an existing one's name/job titles when `input.id` is set. */
export async function saveUnit(supabase: SupabaseClient, propertyId: string, input: UnitSave): Promise<UnitSaveResult> {
  let unitId = input.id
  if (unitId) {
    const { error } = await supabase.from('shift_planning_units').update({ name: input.name }).eq('property_id', propertyId).eq('id', unitId)
    if (error) throw error
  } else {
    const { data, error } = await supabase.from('shift_planning_units').insert({ property_id: propertyId, name: input.name, slug: slugify(input.name) }).select('id').single()
    if (error) throw error
    unitId = data.id as string
  }

  await saveUnitJobTitles(supabase, propertyId, unitId, input.includedJobTitleIds)
  return { id: unitId, name: input.name, includedJobTitleIds: input.includedJobTitleIds, status: 'active' }
}

export async function archiveUnit(supabase: SupabaseClient, propertyId: string, unitId: string): Promise<void> {
  const { error } = await supabase.from('shift_planning_units').update({ status: 'inactive' }).eq('property_id', propertyId).eq('id', unitId)
  if (error) throw error
}
