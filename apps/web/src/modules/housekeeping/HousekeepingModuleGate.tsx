import { useEffect, useState } from 'react'
import { HousekeepingModule } from '@homisuite/housekeeping-module'
import type { StaffProfile } from '@homisuite/housekeeping-module'
import '@homisuite/housekeeping-module/style.css'
import { core, supabase } from '../../core/client'
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
  const [canUseCoreInventory, setCanUseCoreInventory] = useState(false)
  useEffect(() => {
    let active = true
    Promise.all([runtime.hasPermission('core.property.manage'), runtime.hasPermission('core.staff.manage')])
      .then(([property, staff]) => { if (active) setCanUseCoreInventory(property || staff) })
      .catch(() => { if (active) setCanUseCoreInventory(false) })
    return () => { active = false }
  }, [runtime.hasPermission, runtime.property?.id])

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
  const actingAsMembershipId = runtime.platformActingAsMembershipId
  // Housekeeping's own embedded chrome (EmbeddedNav's Richieste/Soggiorni/
  // Gestione switcher, AdminHome's Camere/Menu/Disponibilità/... tabs) builds
  // its internal nav targets by string-concatenating onto `basePath` and
  // calling react-router's navigate() with the result -- and because those
  // targets start with '/', navigate() treats them as absolute from the site
  // root, not relative to wherever this gate is actually mounted. Hardcoding
  // '/housekeeping' here (the module's own default) is only correct for the
  // real, root-mounted route. Under Admin Master's operational view this gate
  // is mounted nested, at .../admin/organizations/:id/properties/:id/view/
  // housekeeping/* (see App.tsx) -- so every one of those internal tab clicks
  // was navigating to the real top-level /housekeeping instead, exactly the
  // same route-escaping bug HomePage's module cards had (see its own navPath
  // comment), just one level deeper and inside the module itself rather than
  // the shell. Passing the actual mounted prefix as basePath fixes every one
  // of those sites at once, with no change needed inside the housekeeping
  // package itself, since they already all key off this same prop.
  const basePath = runtime.isPlatformOperationalView && runtime.property
    ? `/admin/organizations/${runtime.property.organizationId}/properties/${runtime.property.id}/view/housekeeping`
    : '/housekeeping'
  // Admin Master's operational view (Fase C, C3c) never has, and must never
  // be given, a real staff_profiles row -- this synthetic object is
  // client-side only, scoped to this render, and never written back to the
  // database. See HousekeepingModule's own readOnlyProfile doc comment.
  // When "viewing as" a specific team member (Part 2), her name replaces
  // the generic "Admin Master" label -- the module renders as if logged in
  // as that person, even though every write still goes out as Admin Master.
  const readOnlyProfile: StaffProfile | undefined = runtime.isPlatformOperationalView
    ? {
        id: 'platform-admin-operational-view',
        hotel_id: access.hotelId,
        auth_user_id: runtime.session?.user.id ?? 'platform-admin-operational-view',
        name: actingAsMembershipId ? (runtime.platformActingAsFullName ?? 'Membro del team') : 'Admin Master',
        role: 'operatore',
        department: null,
        active: true,
        on_duty: false,
      }
    : undefined
  // The one write wired so far (Fase C follow-up, Part 2): completing an
  // in-progress guest request. Routed through the impersonated RPC instead
  // of the module's own completeRequest(), which Admin Master's browser
  // session could never satisfy via RLS directly -- see that RPC's own
  // doc comment for the attribution contract (always Admin Master in
  // platform_audit_log, never the viewed-as person).
  const onCompleteOverride = actingAsMembershipId
    ? (requestId: string) => core.completeGuestRequestAsPlatformImpersonation(requestId, actingAsMembershipId)
    : undefined
  return (
    <HousekeepingModule
      supabase={supabase}
      hotelId={access.hotelId}
      hotelName={runtime.property?.name ?? 'Struttura'}
      basePath={basePath}
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
      readOnlyProfile={readOnlyProfile}
      sharedCoreNavigation={!runtime.isPlatformOperationalView && canUseCoreInventory}
      onCompleteOverride={onCompleteOverride}
    />
  )
}
