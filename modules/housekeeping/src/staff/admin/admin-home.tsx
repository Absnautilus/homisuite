import { useLocation, useNavigate } from 'react-router-dom'
import { PageHeader, SlidePanel, Tabs } from '@homisuite/ui'
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
  embeddedNav?: { basePath: string; staysAllowed: boolean; manageAllowed: boolean }
}

export function AdminHome({ profile, basePath, embedded = false, platformStaffManagement, hotelId, embeddedNav }: AdminHomeProps) {
  const { t } = useLocale()
  const navigate = useNavigate()
  const hotelName = useHotelName()
  const location = useLocation()
  const operationalHotelId = hotelId ?? profile.hotel_id
  // One ordered, left-to-right list drives the nav (primary/secondary
  // split below), which pane is active, and SlidePanel's slide direction
  // (a tab later in this array slides in from the right, earlier from the
  // left) -- all three read the same match()/order so they can't disagree.
  const tabs = [
    {
      to: basePath,
      label: t('staff.admin.tabStaff'),
      match: (p: string) => p === basePath || p === `${basePath}/`,
      element: embedded ? (
        <OperatorsPage profile={profile} platformStaffManagement={platformStaffManagement} hotelId={hotelId} />
      ) : (
        <OperatorsPage profile={profile} />
      ),
    },
    { to: `${basePath}/camere`, label: t('staff.admin.tabRooms'), match: (p: string) => p.startsWith(`${basePath}/camere`), element: <RoomsPage hotelId={operationalHotelId} /> },
    { to: `${basePath}/menu`, label: t('staff.admin.tabMenu'), match: (p: string) => p.startsWith(`${basePath}/menu`), element: <ItemsPage hotelId={operationalHotelId} /> },
    { to: `${basePath}/disponibilita`, label: t('staff.admin.tabAvailability'), match: (p: string) => p.startsWith(`${basePath}/disponibilita`), element: <AvailabilityPage hotelId={operationalHotelId} /> },
    { to: `${basePath}/statistiche`, label: t('staff.admin.tabStats'), match: (p: string) => p.startsWith(`${basePath}/statistiche`), element: <StatsPage hotelId={operationalHotelId} /> },
    { to: `${basePath}/archivio`, label: t('staff.admin.tabArchive'), match: (p: string) => p.startsWith(`${basePath}/archivio`), element: <ArchivePage hotelId={operationalHotelId} /> },
    { to: `${basePath}/pms`, label: t('staff.admin.tabPms'), match: (p: string) => p.startsWith(`${basePath}/pms`), element: <PmsIntegrationPage profile={profile} /> },
  ]
  const activeTab = tabs.find((tab) => tab.match(location.pathname))
  const navItems = tabs.map((tab) => ({ value: tab.to, label: tab.label }))


  return (
    <div className="min-w-0">
      {embeddedNav ? (
        <EmbeddedNav profile={profile} {...embeddedNav} />
      ) : (
        <PageHeader eyebrow={hotelName} title={t('staff.nav.admin')} description={t('staff.admin.subtitle')} />
      )}
      <Tabs
        items={navItems}
        value={activeTab?.to ?? basePath}
        onValueChange={(value) => navigate(value)}
        variant="surface"
        scrollIntoView
        className="admin-nav"
        aria-label={t('staff.nav.admin')}
      />
      <SlidePanel activeKey={activeTab?.to ?? location.pathname} order={tabs.map((tab) => tab.to)}>
        {activeTab?.element ?? null}
      </SlidePanel>
    </div>
  )
}
