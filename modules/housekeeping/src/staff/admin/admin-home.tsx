import { useEffect } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { Archive, BedDouble, ChartNoAxesColumnIncreasing, ClipboardList, Plug, UsersRound } from 'lucide-react'
import { PageHeader, Tabs } from '@homisuite/ui'
import { EmbeddedNav } from '@/staff/embedded-nav'
import { useHotelName } from '@/lib/hotel-branding-context'
import { RoomsPage } from '@/staff/admin/rooms-page'
import { OperatorsPage } from '@/staff/admin/operators-page'
import { ItemsPage } from '@/staff/admin/items-page'
import { PmsIntegrationPage } from '@/staff/admin/pms-integration-page'
import { ArchivePage } from '@/staff/admin/archive-page'
import { StatsPage } from '@/staff/admin/stats-page'
import { AvailabilityPage } from '@/staff/admin/availability-page'
import { useLocale } from '@/lib/i18n/locale-context'
import type { StaffProfile } from '@/lib/staff-types'
import type { PlatformStaffManagementLink } from '@/public/HousekeepingModule'

interface AdminHomeProps {
  profile: StaffProfile
  // No default: it must be the real absolute path AdminHome is mounted
  // at (both callers already pass it explicitly) -- a wrong fallback
  // here silently breaks tab matching/content resolution, which now
  // share the same match() functions (see the `tabs` array below).
  basePath: string
  embedded?: boolean
  platformStaffManagement?: PlatformStaffManagementLink
  /** Embedded mode only: scopes the operators roster to this hotel. */
  hotelId?: string
  sharedCoreNavigation?: boolean
  embeddedNav?: { basePath: string; staysAllowed: boolean; manageAllowed: boolean }
}

export function AdminHome({ profile, basePath, embedded = false, platformStaffManagement, hotelId, embeddedNav, sharedCoreNavigation = false }: AdminHomeProps) {
  const { t } = useLocale()
  const navigate = useNavigate()
  const hotelName = useHotelName()
  const location = useLocation()
  const operationalHotelId = hotelId ?? profile.hotel_id
  useEffect(() => {
    if (!sharedCoreNavigation) return
    if (location.pathname.startsWith(`${basePath}/camere`)) navigate('/settings/rooms', { replace: true })
    else if (location.pathname === basePath || location.pathname === `${basePath}/`) navigate(`${basePath}/menu`, { replace: true })
  }, [sharedCoreNavigation, location.pathname, basePath, navigate])
  // One list drives both the nav (primary/secondary split below) and
  // which pane is visible -- the nav and the content can't disagree since
  // both read the same match(). The icon lives on each tab's own entry
  // (rather than a second, index-matched array built separately) so
  // adding, removing or reordering a tab can't silently desync its icon
  // from its label the way a parallel array could.
  const tabs = [
    ...(!sharedCoreNavigation ? [{
      to: basePath,
      label: t('staff.admin.tabStaff'),
      icon: <UsersRound />,
      match: (p: string) => p === basePath || p === `${basePath}/`,
      element: embedded ? (
        <OperatorsPage profile={profile} platformStaffManagement={platformStaffManagement} hotelId={hotelId} />
      ) : (
        <OperatorsPage profile={profile} />
      ),
    },
    { to: `${basePath}/camere`, label: t('staff.admin.tabRooms'), icon: <BedDouble />, match: (p: string) => p.startsWith(`${basePath}/camere`), element: <RoomsPage hotelId={operationalHotelId} /> },
    ] : []),
    { to: `${basePath}/menu`, label: t('staff.admin.tabMenu'), icon: <ClipboardList />, match: (p: string) => p.startsWith(`${basePath}/menu`), element: <ItemsPage hotelId={operationalHotelId} /> },
    { to: `${basePath}/disponibilita`, label: t('staff.admin.tabAvailability'), icon: <UsersRound />, match: (p: string) => p.startsWith(`${basePath}/disponibilita`), element: <AvailabilityPage hotelId={operationalHotelId} /> },
    { to: `${basePath}/statistiche`, label: t('staff.admin.tabStats'), icon: <ChartNoAxesColumnIncreasing />, match: (p: string) => p.startsWith(`${basePath}/statistiche`), element: <StatsPage hotelId={operationalHotelId} /> },
    { to: `${basePath}/archivio`, label: t('staff.admin.tabArchive'), icon: <Archive />, match: (p: string) => p.startsWith(`${basePath}/archivio`), element: <ArchivePage hotelId={operationalHotelId} /> },
    // Properties on Hotel Core's shared navigation reach PMS integration
    // from Struttura e Team now (it's structure-wide, not Housekeeping-
    // specific) -- standalone/legacy-embedded deployments, which have no
    // Struttura e Team to move it to, keep it here unchanged.
    ...(!sharedCoreNavigation ? [{ to: `${basePath}/pms`, label: t('staff.admin.tabPms'), icon: <Plug />, match: (p: string) => p.startsWith(`${basePath}/pms`), element: <PmsIntegrationPage profile={profile} /> }] : []),
  ]
  const activeTab = tabs.find((tab) => tab.match(location.pathname))
  const selectedTab = activeTab?.to ?? (sharedCoreNavigation ? `${basePath}/menu` : basePath)
  const navItems = tabs.map((tab) => ({ value: tab.to, label: tab.label, icon: tab.icon }))


  return (
    <div className="min-w-0">
      {embeddedNav ? (
        <EmbeddedNav
          profile={profile}
          {...embeddedNav}
          secondary={{
            items: navItems,
            value: selectedTab,
            onValueChange: (value) => navigate(value),
            ariaLabel: t('staff.nav.admin'),
            scrollIntoView: true,
          }}
        />
      ) : (
        <PageHeader eyebrow={hotelName} title={t('staff.nav.admin')} description={t('staff.admin.subtitle')} />
      )}
      {!embeddedNav ? (
        <Tabs
          items={navItems}
          value={activeTab?.to ?? basePath}
          onValueChange={(value) => navigate(value)}
          variant="surface"
          scrollIntoView
          className="admin-nav"
          aria-label={t('staff.nav.admin')}
        />
      ) : null}
      {/* Every pane stays mounted and only toggles `hidden` -- the same
          pattern Turni's own tab switcher uses (ShiftPlannerModule.tsx) --
          instead of a route-driven single `element` that unmounted and
          remounted whichever page wasn't active. Each admin page fetches
          its own data independently on mount with no cache, so leaving
          the previous page (and its already-loaded data) in the DOM
          rather than destroying it is what makes switching back to it
          instant instead of flashing through a loading state again. */}
      {tabs.map((tab) => (
        <div key={tab.to} hidden={tab.to !== selectedTab}>{tab.element}</div>
      ))}
    </div>
  )
}
