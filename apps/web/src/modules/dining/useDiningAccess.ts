import { useEffect, useState } from 'react'
import { useModuleRuntime } from '../../core/ModuleRuntimeContext'
import { core, supabase } from '../../core/client'
import { resolveDiningAccess } from './resolveDiningAccess'
import type { DiningAccessState as ResolvedState } from './resolveDiningAccess'

// Same three-step check as useHousekeepingAccess, for the same reason:
// Dining is entitled per-property (property_modules) but the legacy
// staff_profiles-scoped tables underneath still gate access per hotel_id, so
// the shell resolves entitlement/mapping/profile up front to decide whether
// Dining should even be offered in nav, and to explain a deep link clearly
// rather than showing a blank screen.
export type DiningAccessState = { status: 'loading' } | { status: 'error'; message: string } | ResolvedState

function errorMessage(cause: unknown): string {
  if (cause && typeof cause === 'object') {
    const candidate = cause as { code?: unknown; message?: unknown; details?: unknown; hint?: unknown }
    return [candidate.code, candidate.message, candidate.details, candidate.hint]
      .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
      .join(' · ')
  }
  return cause instanceof Error ? cause.message : String(cause)
}

export function useDiningAccess(): DiningAccessState {
  const runtime = useModuleRuntime()
  const [state, setState] = useState<DiningAccessState>({ status: 'loading' })

  const entitled = runtime.entitlements.some((item) => item.enabled && item.slug === 'dining')
  const propertyId = runtime.property?.id ?? null
  const userId = runtime.session?.user.id ?? null

  useEffect(() => {
    let cancelled = false

    if (!entitled) {
      setState(resolveDiningAccess({ entitled: false, legacyHotelId: null, staffProfileId: null }))
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
      .getDiningLegacyHotelId(propertyId)
      .then(async (hotelId) => {
        if (cancelled) return
        if (!hotelId) {
          setState(resolveDiningAccess({ entitled: true, legacyHotelId: null, staffProfileId: null }))
          return
        }
        // Database is still a hand-maintained pre-Fase-2 type map: this
        // three-.eq() chain resolves `data`'s row type to `never` (a known
        // supabase-js generic-inference limitation, not a real absence of
        // `id`) the moment a field is actually read off it -- the existing
        // Housekeeping equivalent never hit this because it only ever does
        // Boolean(data). Narrow row shape cast here until database.ts is
        // regenerated.
        const { data, error } = await supabase
          .from('staff_profiles')
          .select('id')
          .eq('auth_user_id', userId)
          .eq('hotel_id', hotelId)
          .eq('active', true)
          .maybeSingle() as { data: { id: string } | null; error: Error | null }
        if (cancelled) return
        if (error) {
          // Logged, not shown -- DiningModuleGate keeps the user-facing
          // message generic (see PageState there) so a raw Postgres/PostgREST
          // error never reaches the screen.
          console.error('useDiningAccess', errorMessage(error))
          setState({ status: 'error', message: errorMessage(error) })
          return
        }
        setState(resolveDiningAccess({ entitled: true, legacyHotelId: hotelId, staffProfileId: data?.id ?? null }))
      })
      .catch((cause: unknown) => {
        if (cancelled) return
        console.error('useDiningAccess', errorMessage(cause))
        setState({ status: 'error', message: errorMessage(cause) })
      })

    return () => {
      cancelled = true
    }
  }, [propertyId, entitled, userId])

  return state
}
