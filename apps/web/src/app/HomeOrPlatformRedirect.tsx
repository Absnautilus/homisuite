import { Navigate } from 'react-router-dom'
import { PageState } from '../components/PageState'
import { HomePage } from '../pages/HomePage'
import { usePlatformAdminSelf } from '../platform/usePlatformAdminSelf'

// A Platform Admin (technical staff or "admin master") lands straight in
// the Platform Admin console instead of the ordinary hotel shell's Home --
// they manage modules/organizations platform-wide, not day-to-day
// property work, so the regular Home is the wrong default for them.
// AccountMenu's own manual "torna a /admin" link stays for the reverse
// trip, and for anyone who isn't a Platform Admin this renders Home exactly
// as before (checked starts false, so there's no flash of this redirect
// firing incorrectly before the check resolves).
export function HomeOrPlatformRedirect() {
  const { isAdmin, checked } = usePlatformAdminSelf()

  if (!checked) return <PageState kind="loading" title="Caricamento…" variant="fullscreen" />
  if (isAdmin) return <Navigate to="/admin" replace />
  return <HomePage />
}
