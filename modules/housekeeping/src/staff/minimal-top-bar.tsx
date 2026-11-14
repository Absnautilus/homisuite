import type { ReactNode } from 'react'
import { LogOut } from 'lucide-react'
import { LanguageToggle } from '@/components/language-toggle'
import { NotificationSettingsToggle } from '@/components/notification-settings-toggle'
import { SimpleModeToggle } from '@/components/simple-mode-toggle'
import { TextSizeToggle } from '@/components/text-size-toggle'
import { OnDutyToggle } from '@/staff/on-duty-toggle'
import { signOut } from '@/lib/staff-api'
import { useLocale } from '@/lib/i18n/locale-context'
import type { StaffProfile } from '@/lib/staff-types'

// Identity + the one way out share the top row, uncontested -- a name never
// has to fight an icon row for space. Everything else is "how do I want
// this device to behave right now", grouped into its own labeled row below
// (same icon-over-label grammar as the shell's own mobile tab bar) instead
// of competing icons squeezed next to the name.
function BarAction({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-1 py-1">
      {children}
      <span className="px-0.5 text-center text-[10px] leading-tight font-bold text-muted">{label}</span>
    </div>
  )
}

// The facchino tier (no manage, no queue-management capability) gets the
// bare minimum of shell around the queue -- no module switcher, no
// breadcrumb, just who's on shift, the controls that matter while working
// (on duty, notification volume, language, text size) and a way out.
// ShellLayout strips its own chrome for the same tier; this is the
// module's half of that same "minimo indispensabile" shell. Also reused,
// with `simpleModeToggle`, as "Modalità semplice"'s own bar for roles that
// opted into it -- same bare-minimum look, with the toggle itself next to
// Esci (a mode switch, not a day-to-day comfort setting) so they can
// switch back. No way back into the shell from here at all (there used to
// be a back arrow to "/") -- "/" is itself a shell route, and the whole
// point of this bar for both tiers is never routing through the shell.
export function MinimalTopBar({ profile, simpleModeToggle = false }: { profile: StaffProfile; simpleModeToggle?: boolean }) {
  const { t } = useLocale()
  const initials = profile.name.trim().split(/\s+/).map((part) => part[0]).slice(0, 2).join('').toUpperCase()

  return (
    <div className="border-b border-line bg-surface">
      <div className="flex items-center justify-between gap-3 px-4 py-3 sm:px-5">
        <span
          role="img"
          aria-label={profile.name}
          title={profile.name}
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-accent-soft text-sm font-bold text-accent"
        >
          {initials}
        </span>
        <div className="flex shrink-0 items-center gap-1">
          {simpleModeToggle && <SimpleModeToggle />}
          {/* Both slots below are filled by apps/web components (HelpButton,
              SimplifiedSettingsButton) that live outside this module
              entirely and portal their real trigger in here when docked --
              real flex siblings of Esci, not fixed-position guesses. See
              HELP_SLOT_ID / SETTINGS_SLOT_ID in those files. `contents`
              keeps each wrapper itself out of the box model so the
              portaled button isn't nested a level deeper than its
              neighbors. Both stay empty for any other consumer of this
              bar, since only those two shell-owned components ever target
              these ids. Impostazioni opens in place here (no navigation,
              see SimplifiedSettingsButton) rather than sending someone
              back through the shell just to reach it. */}
          <span id="hk-minimal-bar-help-slot" className="contents" />
          <span id="hk-minimal-bar-settings-slot" className="contents" />
          <button
            type="button"
            onClick={() => void signOut()}
            title={t('staff.nav.logout')}
            aria-label={t('staff.nav.logout')}
            className="flex h-10 w-10 shrink-0 cursor-pointer items-center justify-center rounded-full text-muted transition-colors hover:bg-surface-2 hover:text-foreground"
          >
            <LogOut className="h-4.5 w-4.5" />
          </button>
        </div>
      </div>
      {/* Pinned to the viewport bottom, like the shell's own mobile tab bar
          -- the actions it holds (turno, notifiche, lingua, dimensione
          testo) are things to reach at any scroll position, not a header
          that scrolls away with the top identity row. Each menu now opens
          *upward* (menuClassName) since there's no room below it. */}
      <div
        className="fixed inset-x-0 bottom-0 z-30 grid auto-cols-fr grid-flow-col gap-1 border-t border-line bg-surface px-2 pt-1.5"
        style={{ paddingBottom: 'max(6px, env(safe-area-inset-bottom))' }}
      >
        <BarAction label={t('staff.onDuty.label')}>
          <OnDutyToggle profile={profile} dark={false} />
        </BarAction>
        <BarAction label={t('staff.notifSettings.label')}>
          <NotificationSettingsToggle align="center" menuClassName="mt-0 mb-2 bottom-full" />
        </BarAction>
        <BarAction label={t('staff.language.label')}>
          <LanguageToggle align="center" menuClassName="mt-0 mb-2 bottom-full" />
        </BarAction>
        <BarAction label={t('uiScale.label')}>
          {/* Last column, close to the right edge -- centering the menu
              under it would run it off-screen; anchor its right edge to
              the trigger's instead, same as the account menus already do
              for a control near the edge. */}
          <TextSizeToggle align="right" menuClassName="mt-0 mb-2 bottom-full" />
        </BarAction>
      </div>
    </div>
  )
}
