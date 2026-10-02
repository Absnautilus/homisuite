import type { SupabaseClient } from '@supabase/supabase-js'

export interface ShiftAvailableTeamMember {
  profileId: string
  name: string
  jobTitle?: string
}

type Row = Record<string, unknown>

function related(value: unknown): Row | undefined {
  if (Array.isArray(value)) return value[0] as Row | undefined
  return value && typeof value === 'object' ? value as Row : undefined
}

/**
 * Team members for this property who don't have a Turni staff profile yet --
 * the pool "Aggiungi da Team" picks from. A Team member only becomes
 * schedulable once explicitly added here; nothing creates that link
 * automatically when they're added to Team itself.
 */
export async function loadAvailableTeamMembers(supabase: SupabaseClient, propertyId: string): Promise<ShiftAvailableTeamMember[]> {
  const [{ data: staffDetails, error: staffDetailsError }, { data: existingStaff, error: existingStaffError }] = await Promise.all([
    // property_staff_details has two FKs into profiles (profile_id and
    // created_by), so the embed needs an explicit constraint hint -- left
    // bare, PostgREST can't tell which relationship to embed and rejects
    // the whole query (PGRST201), which is exactly what was happening here.
    supabase.from('property_staff_details').select('profile_id,profiles!property_staff_details_profile_id_fkey(full_name),property_job_titles(name)').eq('property_id', propertyId).eq('employment_status', 'active'),
    supabase.from('shift_staff_profiles').select('profile_id').eq('property_id', propertyId),
  ])
  if (staffDetailsError) throw staffDetailsError
  if (existingStaffError) throw existingStaffError

  const alreadyOnboarded = new Set((existingStaff ?? []).map((row) => row.profile_id as string))
  return (staffDetails ?? [])
    .filter((row) => !alreadyOnboarded.has(row.profile_id as string))
    .map((row) => {
      const profile = related(row.profiles)
      const jobTitle = related(row.property_job_titles)
      return {
        profileId: String(row.profile_id),
        name: typeof profile?.full_name === 'string' ? profile.full_name : 'Dipendente',
        jobTitle: typeof jobTitle?.name === 'string' ? jobTitle.name : undefined,
      }
    })
    .sort((a, b) => a.name.localeCompare(b.name))
}
