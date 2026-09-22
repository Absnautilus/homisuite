import { useEffect, useState } from 'react'
import { HousekeepingModule } from '@homisuite/housekeeping-module'
import '@homisuite/housekeeping-module/style.css'
import { supabase } from '../../core/client'
import { useModuleRuntime } from '../../core/ModuleRuntimeContext'
import { PageState } from '../../components/PageState'
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
            .select('name, sees_full_queue')
            .eq('id', jobTitleId)
            .maybeSingle()
          // sees_full_queue is the mansione-level flag Turni's own model uses
          // for "this job title sees everything regardless of routing" (see
          // 20260917120000_request_categories_job_titles) -- checking it
          // here, not just a literal name match on "reception", is what
          // actually recognizes a property's own differently-named front
          // desk mansione (e.g. "Front Desk", "Receptionist") as operational.
          reception = jobTitle?.sees_full_queue === true || jobTitle?.name.trim().toLocaleLowerCase('it') === 'reception'
        }

        if (!cancelled) {
          setCanManage(manage)
          setCanManageQueue(reception)
        }
      } catch (cause) {
        console.error('HousekeepingModuleGate: capability resolution failed', cause)
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
    return <PageState kind="loading" title="Caricamento Housekeeping…" />
  }

  if (access.status === 'not-entitled') {
    return <PageState kind="unavailable" title="Housekeeping non è abilitato per questa struttura." />
  }

  if (access.status === 'no-mapping') {
    return <PageState kind="unavailable" title="Housekeeping non è ancora collegato a questa struttura." />
  }

  if (access.status === 'no-profile') {
    return (
      <PageState
        kind="unavailable"
        title="Non hai un profilo operativo Housekeeping per questa struttura."
        description="Gli accessi operativi si gestiscono da Team."
      />
    )
  }

  if (access.status === 'error') {
    return (
      <PageState
        kind="error"
        title="Impossibile caricare Housekeeping."
        description="Riprova tra qualche istante. Se il problema continua, contatta l'assistenza."
        action={{ label: 'Ricarica', onClick: () => window.location.reload() }}
      />
    )
  }

  const settings = runtime.property?.settings ?? {}
  return (
    <HousekeepingModule
      supabase={supabase}
      hotelId={access.hotelId}
      basePath="/housekeeping"
      capabilities={{ manage: canManage, staysView: canManage || canManageQueue, queueManage: canManageQueue }}
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
