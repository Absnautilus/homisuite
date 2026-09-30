import { useEffect, useState } from 'react'
import { useModuleRuntime } from '../../core/ModuleRuntimeContext'
import { core, supabase } from '../../core/client'
import { resolveHousekeepingAccess } from './resolveHousekeepingAccess'
import type { HousekeepingAccessState as ResolvedState } from './resolveHousekeepingAccess'

// Housekeeping is entitled per-property (guest_requests module flag) but the
// legacy staff app underneath still gates access per staff_profiles row at a
// specific legacy hotel_id (see StaffApp's expectedHotelId check in the
// embedded module). A property can be entitled without being bridged to a
// legacy hotel at all (no-mapping — e.g. a brand-new property), and a user
// can be entitled and mapped without having an operational profile at that
// specific hotel (no-profile — e.g. a master whose own account lives at a
// different hotel). Both are dead ends once inside the module, so the shell
// resolves the same three-step check up front to decide whether Housekeeping
// should even be offered in nav/Home, and to explain deep-link access
// clearly rather than showing an ambiguous blank screen. The actual
// entitled/mapped/profile-exists -> status decision lives in
// resolveHousekeepingAccess.ts as a pure, independently tested function;
// this hook only resolves the async inputs it needs.
export type HousekeepingAccessState = { status: 'loading' } | { status: 'error'; message: string } | ResolvedState

// This hook runs independently in both ShellLayout (nav visibility) and
// HousekeepingModuleGate (deep-link gating), and its own consumer remounts
// every time the module is left and re-entered -- without a shared cache,
// each of those redid the legacy-hotel-mapping + staff_profiles round trip
// and re-showed the loading skeleton for data that hadn't changed. Cached
// per property+user for the tab's lifetime; a real permission change only
// takes effect on reload, matching how the rest of the shell's entitlements
// already behave (see ModuleRuntimeContext).
const resolvedAccessCache = new Map<string, ResolvedState>()

function errorMessage(cause: unknown): string {
  if (cause && typeof cause === 'object') {
    const candidate = cause as { code?: unknown; message?: unknown; details?: unknown; hint?: unknown }
    return [candidate.code, candidate.message, candidate.details, candidate.hint]
      .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
      .join(' · ')
  }
  return cause instanceof Error ? cause.message : String(cause)
}

export function useHousekeepingAccess(): HousekeepingAccessState {
  const runtime = useModuleRuntime()

  const entitled = runtime.entitlements.some((item) => item.enabled && item.slug === 'guest_requests')
  const propertyId = runtime.property?.id ?? null
  const userId = runtime.session?.user.id ?? null
  const cacheKey = entitled ? (propertyId && userId ? `${propertyId}:${userId}` : null) : 'not-entitled'

  const [state, setState] = useState<HousekeepingAccessState>(() => (cacheKey && resolvedAccessCache.get(cacheKey)) || { status: 'loading' })

  useEffect(() => {
    if (cacheKey && resolvedAccessCache.has(cacheKey)) return

    let cancelled = false

    if (!entitled) {
      const resolved = resolveHousekeepingAccess({ entitled: false, legacyHotelId: null, hasCompatibleProfile: false })
      resolvedAccessCache.set('not-entitled', resolved)
      setState(resolved)
      return () => {
        cancelled = true
      }
    }
    if (!propertyId || !userId) {
      setState({ status: 'loading' })
      return () => {
        cancelled = true
      }
    }

    setState({ status: 'loading' })

    void core
      .getGuestRequestsLegacyHotelId(propertyId)
      .then(async (hotelId) => {
        if (cancelled) return
        if (!hotelId) {
          const resolved = resolveHousekeepingAccess({ entitled: true, legacyHotelId: null, hasCompatibleProfile: false })
          resolvedAccessCache.set(`${propertyId}:${userId}`, resolved)
          setState(resolved)
          return
        }
        const { data, error } = await supabase
          .from('staff_profiles')
          .select('id')
          .eq('auth_user_id', userId)
          .eq('hotel_id', hotelId)
          .eq('active', true)
          .maybeSingle()
        if (cancelled) return
        if (error) {
          // Logged, not shown -- HousekeepingModuleGate keeps the user-facing
          // message generic (see PageState there) so a raw Postgres/PostgREST
          // error never reaches the screen.
          console.error('useHousekeepingAccess', errorMessage(error))
          setState({ status: 'error', message: errorMessage(error) })
          return
        }
        const resolved = resolveHousekeepingAccess({ entitled: true, legacyHotelId: hotelId, hasCompatibleProfile: Boolean(data) })
        resolvedAccessCache.set(`${propertyId}:${userId}`, resolved)
        setState(resolved)
      })
      .catch((cause: unknown) => {
        if (cancelled) return
        console.error('useHousekeepingAccess', errorMessage(cause))
        setState({ status: 'error', message: errorMessage(cause) })
      })

    return () => {
      cancelled = true
    }
  }, [propertyId, entitled, userId, cacheKey])

  return state
}
