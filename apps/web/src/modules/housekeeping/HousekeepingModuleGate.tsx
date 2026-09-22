import { useEffect, useState } from 'react'
import { HousekeepingModule } from '@homisuite/housekeeping-module'
import '@homisuite/housekeeping-module/style.css'
import { supabase } from '../../core/client'
import { useModuleRuntime } from '../../core/ModuleRuntimeContext'
import { useHousekeepingAccess } from './useHousekeepingAccess'

// Deep links (typed URL, refresh, or a saved bookmark) reach this gate
// directly even when the nav/Home entry point that normally leads here is
// hidden (see useHousekeepingAccess) -- so every non-"compatible" state must
// explain itself rather than fall through to a blank or ambiguous screen.
export function HousekeepingModuleGate() {
  const runtime = useModuleRuntime()
  const { hasPermission } = runtime
  const access = useHousekeepingAccess()
  const propertyId = runtime.property?.id ?? null
  const [canManage, setCanManage] = useState<boolean | null>(null)
  const [canManageQueue, setCanManageQueue] = useState<boolean | null>(null)

  // Housekeeping's own staff_profiles.role is no longer meaningful for
  // authorization (every Team member bridged in via grant-housekeeping-access
  // gets role: 'admin' regardless of their real Homisuite role -- see that
  // function's own comment) and the module's legacy fallback for its
  // "Gestione" tab (staff_profiles.role again) inherits the same problem
  // whenever no capabilities prop is supplied. Resolving the real permission
  // here, the same one grant-housekeeping-access itself checks before
  // bridging anyone in, is what actually gates "Gestione" to admin/manager.
  useEffect(() => {
    if (!propertyId || !runtime.profile?.id) return
    const resolvedPropertyId = propertyId
    const resolvedProfileId = runtime.profile.id
    let cancelled = false

    async function resolveCapabilities() {
      try {
        const [manage, detailResult] = await Promise.all([
          hasPermission('core.staff.manage'),
          supabase
            .from('property_staff_details')
            .select('housekeeping_department, job_title_id')
            .eq('property_id', resolvedPropertyId)
            .eq('profile_id', resolvedProfileId)
            .maybeSingle(),
        ])

        let reception = detailResult.data?.housekeeping_department === 'reception'
        const jobTitleId = detailResult.data?.job_title_id
        if (!reception && jobTitleId) {
          const { data: jobTitle } = await supabase
            .from('property_job_titles')
            .select('name')
            .eq('id', jobTitleId)
            .maybeSingle()
          reception = jobTitle?.name.trim().toLocaleLowerCase('it') === 'reception'
        }

        if (!cancelled) {
          setCanManage(manage)
          setCanManageQueue(reception)
        }
      } catch {
        if (!cancelled) {
          setCanManage(false)
          setCanManageQueue(false)
        }
      }
    }

    void resolveCapabilities()
    return () => {
      cancelled = true
    }
  }, [propertyId, runtime.profile?.id, hasPermission])

  if (access.status === 'loading' || canManage === null || canManageQueue === null) {
    return <div className="runtime-state" role="status">Caricamento Housekeeping…</div>
  }

  if (access.status === 'not-entitled') {
    return <div className="runtime-state">Housekeeping non è abilitato per questa struttura.</div>
  }

  if (access.status === 'no-mapping') {
    return <div className="runtime-state">Housekeeping non è ancora collegato a questa struttura.</div>
  }

  if (access.status === 'no-profile') {
    return (
      <div className="runtime-state">
        Non hai un profilo operativo Housekeeping per questa struttura.
        <small>Gli accessi operativi si gestiscono da Team.</small>
      </div>
    )
  }

  if (access.status === 'error') {
    return (
      <div className="runtime-state" role="alert">
        <strong>Impossibile caricare Housekeeping.</strong>
        <small style={{ maxWidth: 720, textAlign: 'center', overflowWrap: 'anywhere' }}>{access.message || 'Errore sconosciuto'}</small>
      </div>
    )
  }

  const settings = runtime.property?.settings ?? {}
  return (
    <HousekeepingModule
      supabase={supabase}
      hotelId={access.hotelId}
      basePath="/housekeeping"
      capabilities={{ manage: canManage, staysView: canManageQueue, queueManage: canManageQueue }}
      platformStaffManagement={{
        href: '/team',
        label: 'Apri Team',
        description: 'Gli account e gli accessi si gestiscono una sola volta in Homisuite Team. Qui trovi il roster operativo di Housekeeping.',
      }}
      hotelSettings={{
        checkInTime: typeof settings.checkInTime === 'string' ? settings.checkInTime : null,
        checkOutTime: typeof settings.checkOutTime === 'string' ? settings.checkOutTime : null,
      }}
    />
  )
}
