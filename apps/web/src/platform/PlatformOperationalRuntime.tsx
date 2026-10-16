import { useCallback, useEffect, useMemo, useState } from 'react'
import type { PropsWithChildren } from 'react'
import type { ModuleEntitlement, PlatformProperty, Profile, Property, PropertyStatus } from '@homisuite/core-sdk'
import { core } from '../core/client'
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
  const [ready, setReady] = useState(false)

  const load = useCallback(() => {
    setReady(false)
    Promise.all([core.getPlatformPropertyModules(property.id), core.getCurrentProfile()])
      .then(([modules, nextProfile]) => {
        setEntitlements(modules.map(toModuleEntitlement))
        setProfile(nextProfile)
        setReady(true)
      })
      .catch(() => setReady(true))
  }, [property.id])

  useEffect(() => { load() }, [load])

  const hasPermission = useCallback(async (permissionSlug: string) => !permissionSlug.includes('manage'), [])

  const value = useMemo<ModuleRuntimeValue>(() => ({
    status: ready ? 'ready' : 'loading',
    error: null,
    session: null,
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
    refresh: async () => load(),
  }), [ready, profile, property, entitlements, hasPermission, load])

  return <ModuleRuntimeContext.Provider value={value}>{children}</ModuleRuntimeContext.Provider>
}
