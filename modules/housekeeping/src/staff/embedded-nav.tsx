import { useLocation, useNavigate } from 'react-router-dom'
import { Tabs } from '@homisuite/ui'
import { LanguageToggle } from '@/components/language-toggle'
import { TextSizeToggle } from '@/components/text-size-toggle'
import { NotificationSettingsToggle } from '@/components/notification-settings-toggle'
import { OnDutyToggle } from '@/staff/on-duty-toggle'
import { useLocale } from '@/lib/i18n/locale-context'
import type { StaffProfile } from '@/lib/staff-types'

// The module-wide switcher (Richieste/Soggiorni/Gestione) plus per-viewer
// preference controls, rendered by every top-level embedded page right
// below its own PageHeader -- the same placement Turni uses for its
// Operativo/Impostazioni Tabs, instead of a bar sitting above the heading.
export function EmbeddedNav({ profile, basePath, staysAllowed, manageAllowed }: {
  profile: StaffProfile
  basePath: string
  staysAllowed: boolean
  manageAllowed: boolean
}) {
  const { t } = useLocale()
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

  return (
    <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
      <Tabs items={items} value={active} onValueChange={(value) => navigate(value)} variant="surface" aria-label={t('staff.nav.requests')} />
      <div className="flex items-center gap-1">
        <OnDutyToggle profile={profile} dark={false} />
        <NotificationSettingsToggle align="right" />
        <TextSizeToggle align="right" />
        <LanguageToggle align="right" />
      </div>
    </div>
  )
}
