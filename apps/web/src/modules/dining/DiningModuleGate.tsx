import { useEffect, useState } from 'react'
import { supabase } from '../../core/client'
import { useDiningAccess } from './useDiningAccess'
import { DiningPage } from './DiningPage'

// Same shape as HousekeepingModuleGate: every non-"compatible" state
// explains itself, since a deep link can reach this gate directly even
// when the nav entry that normally leads here is hidden.
export function DiningModuleGate() {
  const access = useDiningAccess()
  const [canManage, setCanManage] = useState<boolean | null>(null)

  // current_staff_role() is the same function RLS itself evaluates, so
  // "can this person manage the directory" always matches what the server
  // will actually allow -- no separate, potentially-stale notion of role
  // to keep in sync (see HousekeepingModuleGate's own comment on exactly
  // this trap with staff_profiles.role).
  useEffect(() => {
    if (access.status !== 'compatible') return
    let cancelled = false
    void (async () => {
      try {
        const { data, error } = await (supabase.rpc('current_staff_role' as never) as unknown as Promise<{ data: string | null; error: Error | null }>)
        if (!cancelled) setCanManage(!error && (data === 'admin' || data === 'master'))
      } catch {
        if (!cancelled) setCanManage(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [access])

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
