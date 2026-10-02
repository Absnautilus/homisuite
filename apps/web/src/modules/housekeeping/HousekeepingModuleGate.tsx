import { HousekeepingModule } from '@homisuite/housekeeping-module'
import '@homisuite/housekeeping-module/style.css'
import { supabase } from '../../core/client'
import { useModuleRuntime } from '../../core/ModuleRuntimeContext'
import { PageState } from '../../components/PageState'
import { useHousekeepingAccess } from './useHousekeepingAccess'
import { useHousekeepingCapabilities } from './useHousekeepingCapabilities'

// Deep links (typed URL, refresh, or a saved bookmark) reach this gate
// directly even when the nav/Home entry point that normally leads here is
// hidden (see useHousekeepingAccess) -- so every non-"compatible" state must
// explain itself rather than fall through to a blank or ambiguous screen.
export function HousekeepingModuleGate() {
  const runtime = useModuleRuntime()
  const access = useHousekeepingAccess()
  // Housekeeping's own staff_profiles.role is no longer meaningful for
  // authorization (every Team member bridged in via grant-housekeeping-access
  // gets role: 'admin' regardless of their real Homisuite role -- see that
  // function's own comment) and the module's legacy fallback for its
  // "Gestione" tab (staff_profiles.role again) inherits the same problem
  // whenever no capabilities prop is supplied. Resolving the real permission
  // here, the same one grant-housekeeping-access itself checks before
  // bridging anyone in, is what actually gates "Gestione" to admin/manager.
  // Shared with ShellLayout (which uses it to decide full vs. minimal chrome
  // for a facchino) via useHousekeepingCapabilities, so both read the same
  // cached resolution instead of querying twice.
  const capabilities = useHousekeepingCapabilities()

  if (access.status === 'loading' || capabilities === null) {
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
      hotelName={runtime.property?.name ?? 'Struttura'}
      basePath="/housekeeping"
      capabilities={{ manage: capabilities.manage, staysView: capabilities.manage || capabilities.queueManage, queueManage: capabilities.queueManage }}
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
