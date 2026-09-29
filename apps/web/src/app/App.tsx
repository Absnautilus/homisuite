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
