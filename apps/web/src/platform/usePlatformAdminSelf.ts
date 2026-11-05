import { useEffect, useState } from 'react'
import { core } from '../core/client'

// A deliberately tiny, independent read -- NOT a reuse of PlatformContext,
// which is its own separate runtime by design (see PlatformContext.tsx's
// own doc comment: "no shared state ... never bleeds into the ordinary
// hotel-staff shell"). This hook exists only to answer one question for the
// ordinary shell -- "does this signed-in account also hold a Platform Admin
// identity?" -- so AccountMenu can offer a way back to /admin. It never
// reads MFA/suspension/permissions, never opens or touches an operational
// session, and a failure here (RPC error, signed out) just means the link
// stays hidden, never a thrown error in the ordinary shell.
export function usePlatformAdminSelf(): { isAdmin: boolean } {
  const [isAdmin, setIsAdmin] = useState(false)

  useEffect(() => {
    let cancelled = false
    core
      .getPlatformAdminSelfStatus()
      .then((status) => {
        if (!cancelled) setIsAdmin(status.isAdmin)
      })
      .catch(() => {
        if (!cancelled) setIsAdmin(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  return { isAdmin }
}
