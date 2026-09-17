import { Link, useLocation } from 'react-router-dom'
import { SlidePanel } from '@homisuite/ui'
import { cn } from '@/lib/cn'
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
}

const moreLabels = {
  it: 'Altro',
  en: 'More',
  fr: 'Autres',
  de: 'Mehr',
  es: 'Más',
  pt: 'Mais',
  ja: 'その他',
  bn: 'আরও',
  hi: 'और',
  ar: 'المزيد',
  zh: '更多',
  ru: 'Ещё',
} as const

export function AdminHome({ profile, basePath, embedded = false, platformStaffManagement, hotelId }: AdminHomeProps) {
  const { t, locale } = useLocale()
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
  const primaryTabs = tabs.slice(0, 4)
  const secondaryTabs = tabs.slice(4)
  const secondaryActive = secondaryTabs.some((tab) => tab.match(location.pathname))
  const activeTab = tabs.find((tab) => tab.match(location.pathname))

  return (
    <div className="min-w-0">
      <nav
        className="mb-5 flex w-fit max-w-full items-start gap-1 rounded-md bg-surface-2 p-1"
        aria-label={t('staff.nav.admin')}
      >
        <div className="flex min-w-0 flex-1 gap-1 overflow-x-auto overscroll-x-contain [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {primaryTabs.map((tab) => {
            const active = tab.match(location.pathname)
            return (
              <Link
                key={tab.to}
                to={tab.to}
                aria-current={active ? 'page' : undefined}
                className={cn('admin-tab', active && 'active')}
              >
                {tab.label}
              </Link>
            )
          })}
        </div>
        <details className="group relative shrink-0">
          <summary
            className={cn(
              'admin-tab flex cursor-pointer list-none items-center gap-1.5 [&::-webkit-details-marker]:hidden',
              secondaryActive && 'active',
            )}
          >
            {moreLabels[locale]}
            <svg
              viewBox="0 0 20 20"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              className="h-3.5 w-3.5 transition-transform group-open:rotate-180"
              aria-hidden="true"
            >
              <path d="m6 8 4 4 4-4" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </summary>
          <div className="absolute right-0 z-30 mt-2 min-w-52 rounded-md border border-line bg-surface p-1.5 shadow-lg">
            {secondaryTabs.map((tab) => {
              const active = tab.match(location.pathname)
              return (
                <Link
                  key={tab.to}
                  to={tab.to}
                  aria-current={active ? 'page' : undefined}
                  className={cn(
                    'block rounded-sm px-3 py-2 text-sm font-semibold text-muted transition-colors hover:bg-surface-2 hover:text-foreground',
                    active && 'bg-accent-soft text-accent',
                  )}
                  onClick={(event) => event.currentTarget.closest('details')?.removeAttribute('open')}
                >
                  {tab.label}
                </Link>
              )
            })}
          </div>
        </details>
      </nav>
      <SlidePanel activeKey={activeTab?.to ?? location.pathname} order={tabs.map((tab) => tab.to)}>
        {activeTab?.element ?? null}
      </SlidePanel>
    </div>
  )
}
