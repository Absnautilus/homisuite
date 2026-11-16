import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from './types/database'
import type { ModuleEntitlement } from './types/domain'

interface PropertyModuleWithModule {
  enabled: boolean
  testing_access: boolean
  modules: {
    id: string
    slug: string
    display_name: string
    status: string
  } | null
}

// Only enabled modules — this answers "what should this property see at
// all?", not "what exists on the platform". A module that's registered but
// switched off for this property is simply absent from the result, same as
// property_modules.enabled = false is meant to behave everywhere else.
//
// enabled = true alone isn't enough once a module carries a rollout stage
// (modules.status, same values and meaning as the Moduli settings page and
// the Platform Admin console use): in_development never reaches a regular
// property no matter what property_modules says, and testing only does for
// a property explicitly opted in (testing_access) -- otherwise a Platform
// Admin reclassifying a module while it's mid-build or mid-trial would
// silently light it up for every property that happens to carry a stale
// enabled=true row. beta/active/deprecated are unaffected (deprecated is a
// sunset notice, not an access gate -- a property already using it keeps
// seeing it).
export async function getEnabledModules(client: SupabaseClient<Database>, propertyId: string): Promise<ModuleEntitlement[]> {
  const { data, error } = await client
    .from('property_modules')
    .select('enabled, testing_access, modules(id, slug, display_name, status)')
    .eq('property_id', propertyId)
    .eq('enabled', true)
    .returns<PropertyModuleWithModule[]>()
  if (error) throw error

  return (data ?? [])
    .filter((row): row is PropertyModuleWithModule & { modules: NonNullable<PropertyModuleWithModule['modules']> } => row.modules !== null)
    .filter((row) => row.modules.status !== 'in_development' && (row.modules.status !== 'testing' || row.testing_access))
    .map((row) => ({
      moduleId: row.modules.id,
      slug: row.modules.slug,
      displayName: row.modules.display_name,
      enabled: row.enabled,
    }))
}
