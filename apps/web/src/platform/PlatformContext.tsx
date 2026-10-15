import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import type { PropsWithChildren } from 'react'
import type { Session } from '@supabase/supabase-js'
import type { PlatformAdminStatus, PlatformOperationalSession, PlatformOrganization, PlatformProperty } from '@homisuite/core-sdk'
import { core, supabase } from '../core/client'

// Deliberately a SEPARATE runtime from ModuleRuntimeContext -- no shared
// state, no shared localStorage key, no reuse of its "first accessible
// property" fallback. A Platform Admin's selected organization/property is
// an explicit console choice, never an automatic one, and never bleeds
// into (or out of) the ordinary hotel-staff shell's own active property.
// See docs/platform-admin-architecture.md, "Utenti con doppia identità".

export type PlatformRuntimeStatus = 'loading' | 'signed-out' | 'not-admin' | 'suspended' | 'mfa-required' | 'ready' | 'error'

interface PlatformContextValue {
  status: PlatformRuntimeStatus
  error: Error | null
  adminStatus: PlatformAdminStatus | null
  selectedOrganization: PlatformOrganization | null
  selectedProperty: PlatformProperty | null
  selectOrganization: (organization: PlatformOrganization | null) => void
  selectProperty: (property: PlatformProperty | null) => void
  hasPlatformPermission: (slug: string) => boolean
  // The operational context (Fase C) -- scoping/audit/safety on top of the
  // standing read right above, never the authorization itself. null means
  // "no property currently in view", not "no access". See
  // docs/platform-admin-operational-context.md.
  operationalSession: PlatformOperationalSession | null
  openOperationalSession: (propertyId: string, reason?: string) => Promise<void>
  closeOperationalSession: () => Promise<void>
  refreshOperationalSession: () => Promise<void>
  refresh: () => Promise<void>
}

const PlatformContext = createContext<PlatformContextValue | null>(null)

export function PlatformProvider({ children }: PropsWithChildren) {
  const [status, setStatus] = useState<PlatformRuntimeStatus>('loading')
  const [error, setError] = useState<Error | null>(null)
  const [adminStatus, setAdminStatus] = useState<PlatformAdminStatus | null>(null)
  const [selectedOrganization, setSelectedOrganization] = useState<PlatformOrganization | null>(null)
  const [selectedProperty, setSelectedProperty] = useState<PlatformProperty | null>(null)
  const [operationalSession, setOperationalSession] = useState<PlatformOperationalSession | null>(null)
  // Guards against logging a console-access event on every re-render /
  // refresh() call once already 'ready' this session -- one real access,
  // one real log entry, not one per poll.
  const consoleAccessLogged = useRef(false)

  const load = useCallback(async () => {
    setStatus('loading')
    setError(null)
    try {
      const { data, error: sessionError } = await supabase.auth.getSession()
      if (sessionError) throw sessionError
      const session: Session | null = data.session

      if (!session) {
        setAdminStatus(null)
        setStatus('signed-out')
        return
      }

      const next = await core.getPlatformAdminSelfStatus()
      setAdminStatus(next)

      if (!next.isAdmin) {
        setStatus('not-admin')
        return
      }
      if (next.status === 'suspended') {
        setStatus('suspended')
        return
      }
      if (!next.mfaSatisfied) {
        setStatus('mfa-required')
        return
      }

      if (!consoleAccessLogged.current) {
        consoleAccessLogged.current = true
        // Best-effort: a failure here must never block entering the
        // console -- the access itself already happened.
        void core.logPlatformConsoleAccess().catch(() => {})
      }
      // Best-effort, same reasoning: an admin with no permission/MFA never
      // reaches here at all (both are rechecked live by the RPC itself on
      // every subsequent call regardless), so a failure to load today's
      // session is never a reason to block the console from opening.
      void core.getMyPlatformOperationalSession().then(setOperationalSession).catch(() => {})
      setStatus('ready')
    } catch (cause) {
      setError(cause instanceof Error ? cause : new Error('Unable to load the Platform Admin console'))
      setStatus('error')
    }
  }, [])

  const refreshOperationalSession = useCallback(async () => {
    const next = await core.getMyPlatformOperationalSession()
    setOperationalSession(next)
  }, [])

  const openOperationalSession = useCallback(async (propertyId: string, reason?: string) => {
    await core.openPlatformOperationalSession(propertyId, reason)
    await refreshOperationalSession()
  }, [refreshOperationalSession])

  const closeOperationalSession = useCallback(async () => {
    if (!operationalSession) return
    await core.closePlatformOperationalSession(operationalSession.id)
    setOperationalSession(null)
  }, [operationalSession])

  useEffect(() => {
    void load()
    const { data } = supabase.auth.onAuthStateChange((event) => {
      // Same reasoning as ModuleRuntimeContext: a token refresh is not a
      // real sign-in/out and must not flash the console back to its
      // loading skeleton.
      if (event === 'TOKEN_REFRESHED') return
      consoleAccessLogged.current = false
      void load()
    })
    return () => data.subscription.unsubscribe()
  }, [load])

  const hasPlatformPermission = useCallback(
    (slug: string) => adminStatus?.permissions.includes(slug) ?? false,
    [adminStatus],
  )

  const selectOrganization = useCallback((organization: PlatformOrganization | null) => {
    setSelectedOrganization(organization)
    setSelectedProperty(null)
  }, [])

  const selectProperty = useCallback((property: PlatformProperty | null) => {
    setSelectedProperty(property)
  }, [])

  const value = useMemo<PlatformContextValue>(() => ({
    status,
    error,
    adminStatus,
    selectedOrganization,
    selectedProperty,
    selectOrganization,
    selectProperty,
    hasPlatformPermission,
    operationalSession,
    openOperationalSession,
    closeOperationalSession,
    refreshOperationalSession,
    refresh: load,
  }), [status, error, adminStatus, selectedOrganization, selectedProperty, selectOrganization, selectProperty, hasPlatformPermission, operationalSession, openOperationalSession, closeOperationalSession, refreshOperationalSession, load])

  return <PlatformContext.Provider value={value}>{children}</PlatformContext.Provider>
}

export function usePlatformContext(): PlatformContextValue {
  const value = useContext(PlatformContext)
  if (!value) throw new Error('usePlatformContext must be used inside PlatformProvider')
  return value
}
