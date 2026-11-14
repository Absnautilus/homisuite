import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import type { PropsWithChildren } from 'react'
import type { Session } from '@supabase/supabase-js'
import type { Membership, ModuleEntitlement, Profile, Property } from '@homisuite/core-sdk'
import { core, supabase } from './client'

type RuntimeStatus = 'loading' | 'signed-out' | 'no-property' | 'ready' | 'error'

interface ModuleRuntimeValue {
  status: RuntimeStatus
  error: Error | null
  session: Session | null
  profile: Profile | null
  properties: Property[]
  property: Property | null
  membership: Membership | null
  entitlements: ModuleEntitlement[]
  selectProperty: (propertyId: string) => void
  hasPermission: (permissionSlug: string) => Promise<boolean>
  // true only under PlatformOperationalRuntimeProvider -- lets a module's
  // own access gate (Dining's useDiningAccess, Housekeeping's StaffApp)
  // distinguish "real tenant staff with no operational profile yet" (a
  // real dead end) from "Admin Master's read-only operational view" (never
  // has one, never should), without that gate needing to import anything
  // Platform-Admin-specific itself. Always false for real hotel staff.
  isPlatformOperationalView: boolean
  // Set only under a "visualizza come" impersonation session (Fase C
  // follow-up, Part 2) -- null for a plain, read-only operational view.
  // Lets a module's write affordances (Housekeeping's "Completa" button
  // today) know whose functional authority to exercise, and route the
  // write through the impersonated RPC instead of erroring against RLS
  // Admin Master could never satisfy directly. Always null for real staff.
  platformActingAsMembershipId: string | null
  platformActingAsFullName: string | null
  refresh: () => Promise<void>
}

// Exported (not just the hook) so the Platform Admin operational view can
// supply an alternate value through this exact same context -- the real
// module screens (ShiftPlannerPage today) then render unmodified under
// either provider. See platform/PlatformOperationalRuntime.tsx.
export const ModuleRuntimeContext = createContext<ModuleRuntimeValue | null>(null)
export type { ModuleRuntimeValue }
const PROPERTY_STORAGE_KEY = 'hotsflow.activePropertyId'

export function ModuleRuntimeProvider({ children }: PropsWithChildren) {
  const [status, setStatus] = useState<RuntimeStatus>('loading')
  const [error, setError] = useState<Error | null>(null)
  const [session, setSession] = useState<Session | null>(null)
  const [profile, setProfile] = useState<Profile | null>(null)
  const [properties, setProperties] = useState<Property[]>([])
  const [property, setProperty] = useState<Property | null>(null)
  const [membership, setMembership] = useState<Membership | null>(null)
  const [entitlements, setEntitlements] = useState<ModuleEntitlement[]>([])
  // Read inside the onAuthStateChange callback below, which otherwise only
  // ever sees `session` as it was at the moment that effect was set up
  // (stale closure) -- a ref is the one thing in that closure guaranteed to
  // reflect the current value.
  const sessionRef = useRef<Session | null>(null)
  useEffect(() => { sessionRef.current = session }, [session])

  const load = useCallback(async () => {
    setStatus('loading')
    setError(null)
    try {
      const { data, error: sessionError } = await supabase.auth.getSession()
      if (sessionError) throw sessionError
      setSession(data.session)

      if (!data.session) {
        setProfile(null)
        setProperties([])
        setProperty(null)
        setMembership(null)
        setEntitlements([])
        setStatus('signed-out')
        return
      }

      const [nextProfile, nextProperties] = await Promise.all([
        core.getCurrentProfile(),
        core.getAccessibleProperties(),
      ])
      setProfile(nextProfile)
      setProperties(nextProperties)

      if (nextProperties.length === 0) {
        setProperty(null)
        setMembership(null)
        setEntitlements([])
        setStatus('no-property')
        return
      }

      const storedId = localStorage.getItem(PROPERTY_STORAGE_KEY)
      const selected = nextProperties.find((item) => item.id === storedId) ?? nextProperties[0]
      localStorage.setItem(PROPERTY_STORAGE_KEY, selected.id)
      setProperty(selected)

      const [nextMembership, nextEntitlements] = await Promise.all([
        core.getMembership(selected.id),
        core.getEnabledModules(selected.id),
      ])
      setMembership(nextMembership)
      setEntitlements(nextEntitlements)
      setStatus('ready')
    } catch (cause) {
      setError(cause instanceof Error ? cause : new Error('Unable to load Hotsflow runtime'))
      setStatus('error')
    }
  }, [])

  useEffect(() => {
    void load()
    const { data } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      // Supabase fires this for far more than an actual sign-in/out: a
      // silently-rotated access token (on a timer, and also the moment the
      // tab regains focus/visibility after being hidden) re-announces the
      // same session, and re-fetching a user's own data after a proxy-user
      // placeholder resolves re-announces it again. None of those are a
      // real session transition -- the person signed in before this fired
      // and is still signed in after it, under the same account. Running
      // the full `load()` for any of them anyway (which starts by setting
      // status back to 'loading') made ShellLayout swap the whole routed
      // page out for its skeleton, unmounting it and discarding anything
      // open or typed there but not yet saved, just from switching
      // tabs/apps and coming back -- including a modal mid-edit, or Turni's
      // own unsaved shift edits. Only reload when a session actually
      // appears or disappears (a real sign-in or sign-out); nothing this
      // context fetches (profile/properties/membership/entitlements)
      // depends on anything else these events carry, and `supabase` already
      // holds whatever token it needs internally regardless of what's kept
      // here.
      const hadSession = sessionRef.current !== null
      const hasSession = nextSession !== null
      if (hadSession === hasSession) return
      void load()
    })
    return () => data.subscription.unsubscribe()
  }, [load])

  const selectProperty = useCallback((propertyId: string) => {
    const selected = properties.find((item) => item.id === propertyId)
    if (!selected) return
    localStorage.setItem(PROPERTY_STORAGE_KEY, selected.id)
    setProperty(selected)
    setStatus('loading')
    Promise.all([core.getMembership(selected.id), core.getEnabledModules(selected.id)])
      .then(([nextMembership, nextEntitlements]) => {
        setMembership(nextMembership)
        setEntitlements(nextEntitlements)
        setStatus('ready')
      })
      .catch((cause) => {
        setError(cause instanceof Error ? cause : new Error('Unable to change property'))
        setStatus('error')
      })
  }, [properties])

  const hasPermission = useCallback(async (permissionSlug: string) => {
    if (!property) return false
    return core.hasPermission(property.id, permissionSlug)
  }, [property])

  const value = useMemo<ModuleRuntimeValue>(() => ({
    status,
    error,
    session,
    profile,
    properties,
    property,
    membership,
    entitlements,
    selectProperty,
    hasPermission,
    isPlatformOperationalView: false,
    platformActingAsMembershipId: null,
    platformActingAsFullName: null,
    refresh: load,
  }), [status, error, session, profile, properties, property, membership, entitlements, selectProperty, hasPermission, load])

  return <ModuleRuntimeContext.Provider value={value}>{children}</ModuleRuntimeContext.Provider>
}

export function useModuleRuntime(): ModuleRuntimeValue {
  const value = useContext(ModuleRuntimeContext)
  if (!value) throw new Error('useModuleRuntime must be used inside ModuleRuntimeProvider')
  return value
}
