import { useEffect, useState } from 'react'
import { useModuleRuntime } from '../../core/ModuleRuntimeContext'
import { useDiningAccess } from './useDiningAccess'
import { DiningPage } from './DiningPage'

// Same shape as HousekeepingModuleGate: every non-"compatible" state
// explains itself, since a deep link can reach this gate directly even
// when the nav entry that normally leads here is hidden.
export function DiningModuleGate() {
  const runtime = useModuleRuntime()
  const access = useDiningAccess()
  const propertyId = runtime.property?.id ?? null
  const [canManage, setCanManage] = useState<boolean | null>(null)

  // dining.manage is the same Core permission dining_categories_admin_write,
  // restaurants_admin_write and restaurant_hours_admin_write now evaluate
  // (see 20260922080500_dining_core_capability.sql), so "can this person
  // manage the directory" always matches what the server will actually
  // allow -- no separate, potentially-stale notion of role to keep in sync.
  // has_permission() already covers the old admin/master split on its own:
  // it matches a property-scoped membership (old "admin") or an org-wide
  // one (old "master") against the same permission grant.
  useEffect(() => {
    if (access.status !== 'compatible' || !propertyId) return
    let cancelled = false
    void runtime
      .hasPermission('dining.manage')
      .then((allowed) => {
        if (!cancelled) setCanManage(allowed)
      })
      .catch(() => {
        if (!cancelled) setCanManage(false)
      })
    return () => {
      cancelled = true
    }
  }, [access, propertyId, runtime])

  if (access.status === 'loading' || (access.status === 'compatible' && canManage === null)) {
    return <div className="runtime-state" role="status">Caricamento Ristorazione…</div>
  }

  if (access.status === 'not-entitled') {
    return <div className="runtime-state">Ristorazione non è abilitata per questa struttura.</div>
  }

  if (access.status === 'no-mapping') {
    return <div className="runtime-state">Ristorazione non è ancora collegata a questa struttura.</div>
  }

  if (access.status === 'no-profile') {
    return (
      <div className="runtime-state">
        Non hai un profilo operativo per questa struttura.
        <small>Gli accessi operativi si gestiscono da Team.</small>
      </div>
    )
  }

  if (access.status === 'error') {
    return (
      <div className="runtime-state" role="alert">
        <strong>Impossibile caricare Ristorazione.</strong>
        <small style={{ maxWidth: 720, textAlign: 'center', overflowWrap: 'anywhere' }}>{access.message || 'Errore sconosciuto'}</small>
      </div>
    )
  }

  return (
    <DiningPage
      hotelId={access.hotelId}
      canManage={Boolean(canManage)}
      staffProfileId={access.staffProfileId}
    />
  )
}
