import { LogOut } from 'lucide-react'
import { LanguageToggle } from '@/components/language-toggle'
import { NotificationSettingsToggle } from '@/components/notification-settings-toggle'
import { OnDutyToggle } from '@/staff/on-duty-toggle'
import { signOut } from '@/lib/staff-api'
import { useLocale } from '@/lib/i18n/locale-context'
import type { StaffProfile } from '@/lib/staff-types'

// The facchino tier (no manage, no queue-management capability) gets the
// bare minimum of shell around the queue -- no module switcher, no
// breadcrumb, just who's on shift, the controls that matter while working
// (on duty, notification volume, language) and a way out. ShellLayout
// strips its own chrome for the same tier; this is the module's half of
// that same "minimo indispensabile" shell.
export function MinimalTopBar({ profile }: { profile: StaffProfile }) {
  const { t } = useLocale()
  const initials = profile.name.trim().split(/\s+/).map((part) => part[0]).slice(0, 2).join('').toUpperCase()

  return (
    <div className="flex items-center justify-between gap-3 border-b border-line bg-surface px-4 py-3 sm:px-5">
      <div className="flex min-w-0 items-center gap-2.5">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-accent-soft text-sm font-bold text-accent">{initials}</span>
        <span className="truncate text-sm font-bold text-foreground">{profile.name}</span>
      </div>
      <div className="flex shrink-0 items-center gap-1.5">
        <OnDutyToggle profile={profile} dark={false} />
        <NotificationSettingsToggle align="right" />
        <LanguageToggle align="right" />
        <button
          type="button"
          onClick={() => void signOut()}
          title={t('staff.nav.logout')}
          aria-label={t('staff.nav.logout')}
          className="flex h-11 w-11 shrink-0 cursor-pointer items-center justify-center rounded-full text-muted transition-colors hover:bg-surface-2 hover:text-foreground"
        >
          <LogOut className="h-4.5 w-4.5" />
        </button>
      </div>
    </div>
  )
}
