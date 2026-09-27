import { useLocation, useNavigate } from 'react-router-dom'
import { BreadcrumbHeader } from '@homisuite/ui'
import { LanguageToggle } from '@/components/language-toggle'
import { TextSizeToggle } from '@/components/text-size-toggle'
import { NotificationSettingsToggle } from '@/components/notification-settings-toggle'
import { OnDutyToggle } from '@/staff/on-duty-toggle'
import { useLocale } from '@/lib/i18n/locale-context'
import { useHotelName } from '@/lib/hotel-branding-context'
import type { StaffProfile } from '@/lib/staff-types'

// The module-wide header for every top-level embedded page: a breadcrumb
// (hotel / current section) plus the Richieste/Soggiorni/Gestione switcher,
// in one banner -- replacing a separate PageHeader title per page, the same
// "Variazione D" grammar Turni uses for its own Operativo/Impostazioni row.
export function EmbeddedNav({ profile, basePath, staysAllowed, manageAllowed }: {
  profile: StaffProfile
  basePath: string
  staysAllowed: boolean
  manageAllowed: boolean
}) {
  const { t } = useLocale()
  const hotelName = useHotelName()
  const location = useLocation()
  const navigate = useNavigate()

  const requestPath = basePath
  const staysPath = `${basePath}/soggiorni`
  const adminPath = `${basePath}/admin`

  const items = [
    { value: requestPath, label: t('staff.nav.requests') },
    ...(staysAllowed ? [{ value: staysPath, label: t('staff.nav.stays') }] : []),
    ...(manageAllowed ? [{ value: adminPath, label: t('staff.nav.admin') }] : []),
  ]
  const active = manageAllowed && location.pathname.startsWith(adminPath)
    ? adminPath
    : staysAllowed && location.pathname.startsWith(staysPath)
      ? staysPath
      : requestPath
  const activeLabel = items.find((item) => item.value === active)?.label ?? items[0]!.label

  return (
    <BreadcrumbHeader
      breadcrumb={[hotelName, activeLabel]}
      switcher={{ items, value: active, onValueChange: (value) => navigate(value), 'aria-label': t('staff.nav.requests') }}
      actions={
        <>
          <OnDutyToggle profile={profile} dark={false} />
          <NotificationSettingsToggle align="right" />
          <TextSizeToggle align="right" />
          <LanguageToggle align="right" />
        </>
      }
    />
  )
}
