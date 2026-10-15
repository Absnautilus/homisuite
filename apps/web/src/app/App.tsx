import { lazy, Suspense } from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'
import { ShellLayout } from '../components/ShellLayout'
import { PageState } from '../components/PageState'
import { HomePage } from '../pages/HomePage'
import { PlaceholderPage } from '../pages/PlaceholderPage'
import { ModulesPage } from '../pages/ModulesPage'
import { TeamPage } from '../pages/TeamPage'
import { SettingsPage } from '../pages/SettingsPage'
import { ResetPasswordPage } from '../pages/ResetPasswordPage'
import { PlatformProvider } from '../platform/PlatformContext'
import { PlatformLayout } from '../platform/PlatformLayout'
import { OperationalViewLayout } from '../platform/OperationalViewLayout'
import { OrganizationsPage } from '../platform/pages/OrganizationsPage'
import { OrganizationDetailPage } from '../platform/pages/OrganizationDetailPage'
import { PropertyDetailPage } from '../platform/pages/PropertyDetailPage'
import { AuditLogPage } from '../platform/pages/AuditLogPage'
import { SessionHistoryPage } from '../platform/pages/SessionHistoryPage'

const HousekeepingModuleGate = lazy(async () => {
  const module = await import('../modules/housekeeping/HousekeepingModuleGate')
  return { default: module.HousekeepingModuleGate }
})

const DiningModuleGate = lazy(async () => {
  const module = await import('../modules/dining/DiningModuleGate')
  return { default: module.DiningModuleGate }
})

const ShiftPlannerPage = lazy(async () => {
  const module = await import('../modules/shifts/ShiftPlannerPage')
  return { default: module.ShiftPlannerPage }
})

export function App() {
  return (
    <Routes>
      {/* Outside ShellLayout on purpose: this page handles its own transient
          recovery session and must render before ModuleRuntimeContext's
          signed-in/profile/property checks ever get a say. */}
      <Route path="reimposta-password" element={<ResetPasswordPage />} />
      {/* Platform Admin console -- also outside ShellLayout/ModuleRuntimeContext,
          same reasoning: a Platform Admin with zero hotel memberships must
          never hit ModuleRuntimeContext's "no-property" dead end just to
          reach /admin. PlatformProvider is its own, separate runtime (see
          PlatformContext.tsx) -- nothing here reads or writes the hotel
          shell's active-property state. */}
      <Route path="admin" element={<PlatformProvider><PlatformLayout /></PlatformProvider>}>
        <Route index element={<OrganizationsPage />} />
        <Route path="organizations/:organizationId" element={<OrganizationDetailPage />} />
        <Route path="organizations/:organizationId/properties/:propertyId" element={<PropertyDetailPage />} />
        {/* Operational view -- real module screens, read-only, under an
            explicitly opened operational session (OperationalViewLayout
            itself enforces this, redirecting back here otherwise). Reuses
            the exact same lazy ShiftPlannerPage the hotel shell route
            below renders for real staff -- only the data source feeding it
            differs (PlatformOperationalRuntimeProvider). */}
        <Route path="organizations/:organizationId/properties/:propertyId/view" element={<OperationalViewLayout />}>
          <Route path="turni" element={<Suspense fallback={<PageState kind="loading" title="Caricamento Turni…" />}><ShiftPlannerPage /></Suspense>} />
          <Route path="dining" element={<Suspense fallback={<PageState kind="loading" title="Caricamento Ristorazione…" />}><DiningModuleGate /></Suspense>} />
          <Route path="housekeeping" element={<Suspense fallback={<PageState kind="loading" title="Caricamento Housekeeping…" />}><HousekeepingModuleGate /></Suspense>} />
        </Route>
        <Route path="audit" element={<AuditLogPage />} />
        <Route path="sessions" element={<SessionHistoryPage />} />
      </Route>
      <Route element={<ShellLayout />}>
        <Route index element={<HomePage />} />
        <Route path="housekeeping/*" element={<Suspense fallback={<PageState kind="loading" title="Caricamento Housekeeping…" />}><HousekeepingModuleGate /></Suspense>} />
        <Route path="dining" element={<Suspense fallback={<PageState kind="loading" title="Caricamento Ristorazione…" />}><DiningModuleGate /></Suspense>} />
        <Route path="turni" element={<Suspense fallback={<PageState kind="loading" title="Caricamento Turni…" />}><ShiftPlannerPage /></Suspense>} />
        <Route path="transfer" element={<PlaceholderPage title="Transfer" />} />
        <Route path="modules" element={<ModulesPage />} />
        <Route path="team" element={<TeamPage />} />
        <Route path="settings" element={<SettingsPage />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
