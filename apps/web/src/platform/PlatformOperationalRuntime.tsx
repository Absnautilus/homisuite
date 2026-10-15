import { useCallback, useEffect, useMemo, useState } from 'react'
import type { PropsWithChildren } from 'react'
import type { Session } from '@supabase/supabase-js'
import type { ModuleEntitlement, PlatformProperty, Profile, Property, PropertyStatus } from '@homisuite/core-sdk'
import { core, supabase } from '../core/client'
import { ModuleRuntimeContext, type ModuleRuntimeValue } from '../core/ModuleRuntimeContext'

// Feeds the real module screens (ShiftPlannerPage today -- Dining/
// Housekeeping both need one more module-specific change before they can
// follow, see the PR description) through the EXACT SAME context those
// screens already read for real hotel staff (useModuleRuntime/
// ModuleRuntimeContext) -- only the data source differs here:
//   - property: the operational session's property (passed in, already
//     resolved by the route), never the hotel shell's own localStorage-
//     remembered active property.
//   - entitlements: platform_list_property_modules(), the admin-facing
//     read RPC from B2 -- property_modules' own RLS (has_property_access)
//     doesn't recognize her, so the ordinary getEnabledModules() query
//     would silently return nothing.
//   - hasPermission: recognizes only *.view-tier slugs, never a *.manage
//     one. This is a client-side convenience so a module's own screen
//     doesn't render write affordances that would only error out on
//     click -- the real enforcement is server-side RLS (PR C2), regardless
//     of what this returns.
function toModuleEntitlement(module: { moduleId: string; slug: string; displayName: string; enabled: boolean }): ModuleEntitlement {
  return { moduleId: module.moduleId, slug: module.slug, displayName: module.displayName, enabled: module.enabled }
}

function toProperty(property: PlatformProperty): Property {
  return {
    id: property.id,
    organizationId: property.organizationId,
    name: property.name,
    slug: property.slug,
    timezone: property.timezone,
    status: property.status as PropertyStatus,
    settings: {},
  }
}

export function PlatformOperationalRuntimeProvider({ property, children }: PropsWithChildren<{ property: PlatformProperty }>) {
  const [entitlements, setEntitlements] = useState<ModuleEntitlement[]>([])
  const [profile, setProfile] = useState<Profile | null>(null)
  const [session, setSession] = useState<Session | null>(null)
  const [ready, setReady] = useState(false)

  const load = useCallback(() => {
    setReady(false)
    Promise.all([core.getPlatformPropertyModules(property.id), core.getCurrentProfile(), supabase.auth.getSession()])
      .then(([modules, nextProfile, { data }]) => {
        setEntitlements(modules.map(toModuleEntitlement))
        setProfile(nextProfile)
        // Admin Master's own real auth session -- not null. A module gate
        // that independently derives identity from auth.uid() (Dining's
        // useDiningAccess, Housekeeping's fetchMyProfile) needs the real
        // session to even ask the question; isPlatformOperationalView below
        // is the signal that tells it to answer differently than it would
        // for real tenant staff, not an absent session forcing it to stall.
        setSession(data.session)
        setReady(true)
      })
      .catch(() => setReady(true))
  }, [property.id])

  useEffect(() => { load() }, [load])

  const hasPermission = useCallback(async (permissionSlug: string) => !permissionSlug.includes('manage'), [])

  const value = useMemo<ModuleRuntimeValue>(() => ({
    status: ready ? 'ready' : 'loading',
    error: null,
    session,
    profile,
    properties: [toProperty(property)],
    property: toProperty(property),
    membership: null,
    entitlements,
    // A single property per operational view, chosen by opening a session
    // for it -- there is no in-page switcher; "cambiare hotel" means
    // closing this session and opening a new one from the console.
    selectProperty: () => {},
    hasPermission,
    isPlatformOperationalView: true,
    refresh: async () => load(),
  }), [ready, session, profile, property, entitlements, hasPermission, load])

  return <ModuleRuntimeContext.Provider value={value}>{children}</ModuleRuntimeContext.Provider>
}
