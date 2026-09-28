import { useLocation, useNavigate } from 'react-router-dom'
import { ModuleNav } from '@homisuite/ui'
import { BedDouble, Inbox, Settings2 } from 'lucide-react'
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
    { value: requestPath, label: t('staff.nav.requests'), icon: <Inbox />, attention: active !== requestPath },
    ...(staysAllowed ? [{ value: staysPath, label: t('staff.nav.stays'), icon: <BedDouble /> }] : []),
    ...(manageAllowed ? [{ value: adminPath, label: t('staff.nav.admin'), icon: <Settings2 /> }] : []),
  ]
  const active = manageAllowed && location.pathname.startsWith(adminPath)
    ? adminPath
    : staysAllowed && location.pathname.startsWith(staysPath)
      ? staysPath
      : requestPath

  return (
    <ModuleNav
      propertyName={hotelName}
      moduleName={t('department.housekeeping')}
      items={items}
      value={active}
      onValueChange={(value) => navigate(value)}
      ariaLabel={t('staff.nav.requests')}
      actions={
        <>
          <span className="hk-module-duty-desktop"><OnDutyToggle profile={profile} dark={false} /></span>
          <NotificationSettingsToggle align="right" />
          <TextSizeToggle align="right" />
          <LanguageToggle align="right" />
        </>
      }
    />
  )
}
