import { useEffect, useRef, useState } from 'react'
import { Navigate, Route, Routes, useSearchParams } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import { claimRequest, fetchMyProfile, touchPresence } from '@/lib/staff-api'
import { goOffDuty } from '@/lib/push'
import { unlockAudio } from '@/lib/beep'
import { useIdleLogout } from '@/hooks/use-idle-logout'
import { useLocale } from '@/lib/i18n/locale-context'
import type { StaffProfile } from '@/lib/staff-types'
import type { HousekeepingCapabilities, PlatformHotelSettings, PlatformStaffManagementLink } from '@/public/HousekeepingModule'
import { ToastProvider } from '@/components/toast-context'
import { DashboardHeader } from '@/staff/dashboard-header'
import { RequestQueue } from '@/staff/request-queue'
import { AdminHome } from '@/staff/admin/admin-home'
import { StaysPage } from '@/staff/stays/stays-page'

const IDLE_LOGOUT_MS = 8 * 60 * 60 * 1000
const PRESENCE_HEARTBEAT_MS = 5 * 60 * 1000

interface StaffAppProps {
  mode?: 'standalone' | 'embedded'
  expectedHotelId?: string
  basePath?: string
  capabilities?: HousekeepingCapabilities
  platformStaffManagement?: PlatformStaffManagementLink
  hotelSettings?: PlatformHotelSettings
  // Shell-supplied identity for a viewer with no staff_profiles row of their
  // own (Platform Admin's read-only operational view) -- see HousekeepingModule's
  // own doc comment. Skips fetchMyProfile() entirely; never persisted.
  sharedCoreNavigation?: boolean
  readOnlyProfile?: StaffProfile
  // Shell-supplied replacement for the queue's own completeRequest(id) --
  // see RequestRow's own doc comment. Omit for every ordinary embedding.
  onCompleteOverride?: (requestId: string) => Promise<void>
}

export function StaffApp({ mode = 'standalone', expectedHotelId, basePath = '/housekeeping', capabilities, platformStaffManagement, hotelSettings, readOnlyProfile, sharedCoreNavigation = false, onCompleteOverride }: StaffAppProps = {}) {
  const { t } = useLocale()
  const embedded = mode === 'embedded'
  const [loading, setLoading] = useState(true)
  const [profile, setProfile] = useState<StaffProfile | null>(null)
  const [searchParams, setSearchParams] = useSearchParams()
  // Set inside loadStandalone below, the one place that actually checks
  // the session -- read by the onAuthStateChange handler to tell a real
  // sign-in/out transition from Supabase just re-announcing the same
  // session (a rotated token, the tab regaining focus, ...). null until
  // the first loadStandalone() resolves.
  const hasSessionRef = useRef<boolean | null>(null)

  useEffect(() => {
    let cancelled = false

    async function loadProfile() {
      try {
        const p = await fetchMyProfile()
        if (!cancelled) setProfile(p)
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    if (readOnlyProfile) {
      setProfile(readOnlyProfile)
      setLoading(false)
      return () => {
        cancelled = true
      }
    }

    if (embedded) {
      void loadProfile()
      return () => {
        cancelled = true
      }
    }

    async function loadStandalone() {
      const { data } = await supabase.auth.getSession()
      hasSessionRef.current = data.session !== null
      if (!data.session) {
        if (!cancelled) {
          setProfile(null)
          setLoading(false)
        }
        return
      }
      await loadProfile()
    }

    void loadStandalone()
    const { data: sub } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      // Same reasoning as apps/web's ModuleRuntimeContext: this fires for
      // far more than an actual sign-in/out (a rotated token, the tab
      // regaining focus, ...), and reloading for every one of those flashed
      // this screen back to its own loading state on nothing that actually
      // changed. Only reload when a session actually appears or disappears.
      const hadSession = hasSessionRef.current
      const hasSession = nextSession !== null
      if (hadSession === hasSession) return
      setLoading(true)
      void loadStandalone()
    })
    return () => {
      cancelled = true
      sub.subscription.unsubscribe()
    }
  }, [embedded, readOnlyProfile])

  useEffect(() => {
    function onFirstPointer() {
      unlockAudio()
      document.removeEventListener('pointerdown', onFirstPointer)
    }
    document.addEventListener('pointerdown', onFirstPointer)
    return () => document.removeEventListener('pointerdown', onFirstPointer)
  }, [])

  // A shared/kiosk-style terminal (reception desk, housekeeping tablet) is
  // the common case this guards -- left signed in and "on duty" long after
  // whoever was using it has gone home. Skipped for readOnlyProfile: that's
  // Platform Admin looking in on someone else's queue, not a real staff
  // session to end. goOffDuty() is a no-op if the profile is already off
  // duty, so there's no need to track on_duty separately here.
  useIdleLogout(Boolean(profile?.active && !readOnlyProfile), IDLE_LOGOUT_MS, () => {
    void goOffDuty().catch(() => {})
    void supabase.auth.signOut()
  })

  // The idle timer above only ever fires if this tab keeps running for the
  // full 8h uninterrupted -- closing the laptop, quitting the browser, or
  // the device sleeping all skip it entirely, leaving on_duty stuck true
  // indefinitely with nothing to notice. This heartbeat is the other half:
  // proof to the server-side sweep (auto-off-duty-stale-presence) that a
  // session is genuinely still open, so it can flip on_duty off for anyone
  // whose heartbeat goes stale regardless of what their tab is doing.
  useEffect(() => {
    if (!profile?.active || readOnlyProfile) return
    void touchPresence().catch(() => {})
    const interval = window.setInterval(() => {
      void touchPresence().catch(() => {})
    }, PRESENCE_HEARTBEAT_MS)
    return () => window.clearInterval(interval)
  }, [profile?.active, readOnlyProfile])

  useEffect(() => {
    const claimId = searchParams.get('claim')
    if (!claimId || !profile) return
    // Best-effort: this runs from a push-notification deep link, outside
    // ToastProvider (rendered further down by this same component), so
    // there's no toast to surface a lost race or a real failure through --
    // either way the person lands on the queue and sees the request's
    // actual current state there. A rejection just needs to not go
    // unhandled; it doesn't need its own UI.
    claimRequest(claimId, profile.id)
      .catch((err) => console.error('claim-by-link failed', err))
      .finally(() => {
        const next = new URLSearchParams(searchParams)
        next.delete('claim')
        setSearchParams(next, { replace: true })
      })
  }, [searchParams, profile, setSearchParams])


  if (loading) {
    return (
      <div role="status" className="flex min-h-[16rem] items-center justify-center bg-background">
        <div aria-hidden="true" className="h-7 w-7 animate-spin rounded-full border-3 border-line-strong border-t-accent" />
        <span className="sr-only">{t('staff.availability.loading')}</span>
      </div>
    )
  }
  if (!profile) {
    if (embedded) {
      return <div className="rounded-lg border border-line bg-surface p-10 text-center text-sm text-muted">{t('staff.routeUnavailable')}</div>
    }
    return <div className="flex min-h-[16rem] items-center justify-center bg-surface-2 px-4 text-center text-sm text-muted">Accedi da Homisuite per usare Housekeeping.</div>
  }
  if (!profile.active) {
    return <div className="flex min-h-[16rem] items-center justify-center bg-surface-2 px-4 text-center text-sm text-muted">{t('staff.accountDisabled')}</div>
  }
  if (expectedHotelId && profile.hotel_id !== expectedHotelId) {
    return <div className="rounded-lg border border-line bg-surface p-10 text-center text-sm text-muted">{t('staff.routeUnavailable')}</div>
  }

  // Standalone keeps the legacy role/department contract. Embedded Hotsflow
  // uses capabilities resolved by Core; the fallback is intentionally kept
  // during migration so existing integrators are not broken.
  const legacyAdminLike = profile.role === 'admin' || profile.role === 'master'
  const legacyStaysAllowed = legacyAdminLike || profile.department === 'reception'
  const manageAllowed = embedded && capabilities ? capabilities.manage : legacyAdminLike
  const staysAllowed = embedded && capabilities ? capabilities.staysView : legacyStaysAllowed

  const queueManageAllowed = embedded && capabilities ? capabilities.queueManage : profile.department === 'reception'
  // A facchino -- no manage, no queue-management capability -- never reaches
  // soggiorni/admin (both gated below on staysAllowed/manageAllowed, which
  // are false here too) and sees a stripped RequestQueue header instead of
  // the full Richieste/Soggiorni/Gestione switcher; see MinimalTopBar.
  const isFacchino = embedded && !!capabilities && !capabilities.manage && !capabilities.queueManage
  // Only embedded routes get the module-wide Richieste/Soggiorni/Gestione
  // switcher below their PageHeader -- standalone mode keeps its own
  // DashboardHeader (a full top bar, logo included) unchanged.
  const embeddedNav = embedded ? { basePath, staysAllowed: sharedCoreNavigation ? false : staysAllowed, manageAllowed, minimal: isFacchino } : undefined
  const queueRoute = <Route index element={<RequestQueue profile={profile} canManageQueue={queueManageAllowed} embeddedNav={embeddedNav} onCompleteOverride={onCompleteOverride} />} />
  const staysRoute = sharedCoreNavigation && embedded && staysAllowed
    ? <Route path="soggiorni" element={<Navigate to="/settings/stays" replace />} />
    : staysAllowed ? <Route path="soggiorni" element={<StaysPage hotelId={profile.hotel_id} hotelSettings={hotelSettings} profile={profile} embeddedNav={embeddedNav} />} /> : null
  const adminRoute = manageAllowed ? (
    <Route
      path="admin/*"
      element={(
        <AdminHome
          profile={profile}
          basePath={`${basePath}/admin`}
          embedded
          platformStaffManagement={platformStaffManagement}
          hotelId={expectedHotelId}
          embeddedNav={embeddedNav}
          sharedCoreNavigation={sharedCoreNavigation}
        />
      )}
    />
  ) : null

  const routeContent = embedded ? (
    <Routes>
      {queueRoute}
      {staysRoute}
      {adminRoute}
      <Route path="*" element={<div className="rounded-lg border border-line bg-surface p-10 text-center text-sm text-muted">{t('staff.routeUnavailable')}</div>} />
    </Routes>
  ) : (
    <Routes>
      <Route path="/" element={<RequestQueue profile={profile} canManageQueue={queueManageAllowed} />} />
      {staysAllowed && <Route path="/soggiorni" element={<StaysPage hotelId={profile.hotel_id} />} />}
      {manageAllowed && <Route path="/admin/*" element={<AdminHome profile={profile} basePath="/admin" />} />}
      <Route path="*" element={<div className="rounded-lg border border-line bg-surface p-10 text-center text-sm text-muted">{t('staff.routeUnavailable')}</div>} />
    </Routes>
  )

  return (
    <ToastProvider>
      <div className={embedded ? undefined : 'min-h-full bg-surface-2'}>
        {embedded ? null : <DashboardHeader profile={profile} basePath="/staff" />}
        {embedded ? (
          <div className="pt-4">{routeContent}</div>
        ) : (
          <main className="mx-auto max-w-5xl px-4 py-6 sm:px-6">{routeContent}</main>
        )}
      </div>
    </ToastProvider>
  )
}
