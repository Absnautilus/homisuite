export { HousekeepingModule } from './public/HousekeepingModule'
export type {
  HousekeepingModuleProps,
  HousekeepingCapabilities,
  PlatformStaffManagementLink,
  PlatformHotelSettings,
} from './public/HousekeepingModule'
export type { StaffProfile } from './lib/staff-types'
// Exported standalone for Hotel Core's "Struttura e Team" PMS tab --
// PMS integration is structure-wide, not specific to the Housekeeping
// module, so it's reachable there instead of only from within Housekeeping's
// own admin nav (see admin-home.tsx's sharedCoreNavigation branch).
export { PmsIntegrationPage } from './staff/admin/pms-integration-page'
export { LocaleProvider } from './lib/i18n/locale-context'
// A standalone mount of PmsIntegrationPage never goes through
// HousekeepingModule (which calls this itself before rendering) -- without
// it, the module's internal client falls back to its own env vars, which a
// library package never has, and throws on first use.
export { configureSupabaseClient } from './lib/supabase'
// Lets the shell (ShellLayout, mounted above this module -- a React context
// here can't reach it) know whether "Modalità semplice" is on for this
// device, e.g. to relocate its own floating help button while the queue's
// minimal bar is showing instead of floating over it.
export { isSimpleModeEnabled, SIMPLE_MODE_CHANGE_EVENT } from './lib/simple-mode-context'
