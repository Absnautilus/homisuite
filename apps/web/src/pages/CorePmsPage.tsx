import { ModuleNav } from '@homisuite/ui'
import { configureSupabaseClient, LocaleProvider, PmsIntegrationPage } from '@homisuite/housekeeping-module'
import type { StaffProfile } from '@homisuite/housekeeping-module'
import '@homisuite/housekeeping-module/style.css'
import { PageState } from '../components/PageState'
import { supabase } from '../core/client'
import { useModuleRuntime } from '../core/ModuleRuntimeContext'
import { useCoreHotel, useStructureNav } from './HotelCorePages'

// Mounting PmsIntegrationPage on its own, outside HousekeepingModule (which
// would normally do this itself before rendering), leaves the package's
// internal client un-injected -- it then falls back to its own env vars,
// which a library package never has, and throws on first use.
configureSupabaseClient(supabase)

// This whole page is lazy-loaded from App.tsx specifically so the
// @homisuite/housekeeping-module dependency it pulls in (PmsIntegrationPage,
// its own Tailwind UI kit, admin-api) lands in a separate chunk rather than
// bloating the main bundle every property pays for, the same reasoning
// DiningModuleGate/ShiftPlannerPage/SmartInboxPage are already lazy.
export function CorePmsPage() {
  const runtime = useModuleRuntime()
  const nav = useStructureNav()
  const { hotelId, error: accessError, loading } = useCoreHotel()

  // role: 'admin' is the same compatibility role every Core-bridged staff
  // profile gets for Housekeeping (see grant-housekeeping-access) -- it just
  // needs to read as "not master" here so PmsIntegrationPage renders its
  // single-property form instead of the platform-wide hotel switcher.
  const profile: StaffProfile = {
    id: runtime.profile?.id ?? '',
    hotel_id: hotelId ?? '',
    auth_user_id: runtime.session?.user.id ?? '',
    name: runtime.profile?.fullName ?? 'Staff',
    role: 'admin',
    department: null,
    active: true,
    on_duty: false,
  }

  return (
    <div className="page-stack">
      <ModuleNav propertyName={runtime.property?.name ?? 'Struttura'} moduleName="Struttura e Team" items={nav.items} value={nav.value} onValueChange={nav.onValueChange} ariaLabel="Struttura e Team" />
      {loading ? <PageState kind="loading" title="Verifica accesso alla struttura…" /> : null}
      {accessError ? <PageState kind="error" title="Impossibile accedere a Struttura e Team." description={accessError} /> : null}
      {hotelId ? (
        <section className="shell-card">
          <LocaleProvider>
            <PmsIntegrationPage profile={profile} />
          </LocaleProvider>
        </section>
      ) : null}
    </div>
  )
}
