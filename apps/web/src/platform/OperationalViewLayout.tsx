import { useEffect, useRef, useState } from 'react'
import { Navigate, Outlet, useLocation, useNavigate, useParams } from 'react-router-dom'
import { LogOut } from 'lucide-react'
import type { PlatformProperty } from '@homisuite/core-sdk'
import { core } from '../core/client'
import { PageState } from '../components/PageState'
import { usePlatformContext } from './PlatformContext'
import { PlatformOperationalRuntimeProvider } from './PlatformOperationalRuntime'

// The route wrapper every operational module view mounts under
// (organizations/:organizationId/properties/:propertyId/view/*). Verifies
// a session is actually open and scoped to THIS property before rendering
// anything real -- a deep link or a stale tab can never silently reach
// module data without one, regardless of what platform_operational_
// read_allowed() would separately enforce server-side.
export function OperationalViewLayout() {
  const { organizationId, propertyId } = useParams<{ organizationId: string; propertyId: string }>()
  const navigate = useNavigate()
  const location = useLocation()
  const { operationalSession, closeOperationalSession, refreshOperationalSession } = usePlatformContext()
  const [property, setProperty] = useState<PlatformProperty | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const expiryTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  const sessionMatches = operationalSession?.status === 'active' && operationalSession.propertyId === propertyId
  // The last path segment under .../view/ (turni, dining, housekeeping) --
  // good enough as an audit-trail module identifier without plumbing the
  // module's own `slug` down to this layout, which sits above the route
  // that actually resolves it.
  const moduleRoute = location.pathname.split('/').filter(Boolean).pop() ?? null

  useEffect(() => {
    if (!organizationId || !propertyId || !sessionMatches) return
    let cancelled = false
    core.getPlatformProperties(organizationId)
      .then((properties) => {
        if (cancelled) return
        setProperty(properties.find((item) => item.id === propertyId) ?? null)
      })
      .catch((cause) => { if (!cancelled) setLoadError(cause instanceof Error ? cause.message : 'Errore sconosciuto') })
    return () => { cancelled = true }
  }, [organizationId, propertyId, sessionMatches])

  // Schedules exactly one check at the session's own expiry instant (not a
  // poll): when it fires, re-reads the session server-side -- if it has
  // genuinely lapsed, the next render's sessionMatches/redirect below
  // takes over and sends the admin back with a clear reason, rather than
  // leaving module screens silently showing whatever they last loaded.
  useEffect(() => {
    if (!operationalSession) return
    const msRemaining = new Date(operationalSession.expiresAt).getTime() - Date.now()
    clearTimeout(expiryTimer.current)
    expiryTimer.current = setTimeout(() => { void refreshOperationalSession() }, Math.max(msRemaining, 0))
    return () => clearTimeout(expiryTimer.current)
  }, [operationalSession, refreshOperationalSession])

  // Logs one audit entry per module view actually entered under this
  // session (Fase C, PR C4) -- distinct from, and in addition to, the
  // session's own open/close/revoke entries, which only cover when "in
  // view" changed, not which module data was actually consulted while it
  // was. Fire-and-forget: a logging failure must never block rendering an
  // already-authorized read (platform_operational_read_allowed() via C2's
  // RLS already granted it independently), so errors are swallowed here,
  // not surfaced to the admin.
  useEffect(() => {
    if (!sessionMatches || !operationalSession || !moduleRoute) return
    void core.logPlatformOperationalView(operationalSession.id, moduleRoute).catch((cause) => {
      console.error('platform_log_operational_view failed', cause)
    })
  }, [sessionMatches, operationalSession, moduleRoute])

  if (!organizationId || !propertyId) return null

  if (!sessionMatches) {
    return (
      <Navigate
        to={`/admin/organizations/${organizationId}/properties/${propertyId}`}
        state={{ operationalSessionEnded: true }}
        replace
      />
    )
  }

  async function exitView() {
    await closeOperationalSession()
    navigate(`/admin/organizations/${organizationId}/properties/${propertyId}`)
  }

  if (loadError) return <PageState kind="error" title="Impossibile aprire la vista operativa." description={loadError} />
  if (!property) return <PageState kind="loading" title="Caricamento…" />

  return (
    <div className="platform-operational-shell">
      <div className="platform-operational-banner">
        <span><strong>ADMIN MASTER</strong> · {property.name} · Sola lettura</span>
        <button type="button" onClick={() => void exitView()}>
          <LogOut size={14} /> Torna alla console
        </button>
      </div>
      <div className="platform-operational-content">
        <PlatformOperationalRuntimeProvider property={property}>
          <Outlet />
        </PlatformOperationalRuntimeProvider>
      </div>
    </div>
  )
}
