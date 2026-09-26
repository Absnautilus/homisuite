import { useEffect, useState } from 'react'
import { useModuleRuntime } from '../../core/ModuleRuntimeContext'
import { PageState } from '../../components/PageState'
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
    return <PageState kind="loading" title="Caricamento Ristorazione…" />
  }

  if (access.status === 'not-entitled') {
    return <PageState kind="unavailable" title="Ristorazione non è abilitata per questa struttura." />
  }

  if (access.status === 'no-mapping') {
    return <PageState kind="unavailable" title="Ristorazione non è ancora collegata a questa struttura." />
  }

  if (access.status === 'no-profile') {
    return (
      <PageState
        kind="unavailable"
        title="Non hai un profilo operativo per questa struttura."
        description="Gli accessi operativi si gestiscono da Team."
      />
    )
  }

  if (access.status === 'error') {
    return (
      <PageState
        kind="error"
        title="Impossibile caricare Ristorazione."
        description="Riprova tra qualche istante. Se il problema continua, contatta l'assistenza."
        action={{ label: 'Ricarica', onClick: () => window.location.reload() }}
      />
    )
  }

  return (
    <DiningPage
      hotelId={access.hotelId}
      hotelName={runtime.property?.name ?? 'Struttura'}
      canManage={Boolean(canManage)}
      staffProfileId={access.staffProfileId}
    />
  )
}
