import { Route, Routes } from 'react-router-dom'
import { ResetPasswordPage } from './pages/ResetPasswordPage'
import { AuthGate } from './AuthGate'

export function App() {
  return (
    <Routes>
      {/* Outside AuthGate on purpose, same reasoning as apps/web's own
          ResetPasswordPage route: this handles its own transient recovery
          session, reached straight from the invite/reset email link. */}
      <Route path="reimposta-password" element={<ResetPasswordPage />} />
      <Route path="*" element={<AuthGate />} />
    </Routes>
  )
}
