import { Link, useLocation } from 'react-router-dom'
import type { ComponentType, SVGProps } from 'react'
import { LogOut, Settings } from 'lucide-react'
import { LogoMark } from '@/components/logo'
import { LanguageToggle } from '@/components/language-toggle'
import { TextSizeToggle } from '@/components/text-size-toggle'
import { NotificationSettingsToggle } from '@/components/notification-settings-toggle'
import { IconBedEmpty, IconInboxEmpty } from '@/components/empty-state'
import { OnDutyToggle } from '@/staff/on-duty-toggle'
import { cn } from '@/lib/cn'
import { signOut } from '@/lib/staff-api'
import { useLocale } from '@/lib/i18n/locale-context'
import type { StaffProfile } from '@/lib/staff-types'

interface DashboardHeaderProps {
  profile: StaffProfile
  basePath?: string
}

// Standalone-only now: the embedded Shell integration gets its
// Richieste/Soggiorni/Gestione switcher from EmbeddedNav instead, rendered
// by each top-level page below its own PageHeader (see embedded-nav.tsx).
export function DashboardHeader({ profile, basePath = '/staff' }: DashboardHeaderProps) {
  const { t } = useLocale()
  const location = useLocation()
  const roleLabel = profile.role === 'master' ? t('role.master') : profile.role === 'admin' ? t('role.admin') : profile.department ? t(`department.${profile.department}`) : t('role.operatore')
  const legacyAdminLike = profile.role === 'admin' || profile.role === 'master'
  const staysAllowed = legacyAdminLike || profile.department === 'reception'
  const manageAllowed = legacyAdminLike
  const initials = profile.name.trim().split(/\s+/).map((p) => p[0]).slice(0, 2).join('').toUpperCase()

  const requestPath = basePath
  const staysPath = `${basePath}/soggiorni`
  const adminPath = `${basePath}/admin`

  return (
    <div className="bg-background px-3 pt-3 sm:px-6 sm:pt-4">
      <div className="mx-auto flex max-w-5xl items-center gap-1 rounded-full bg-accent py-1.5 pr-2 pl-3 text-white shadow-md">
        <Link to="/staff" className="flex shrink-0 items-center gap-2 rounded-full py-1.5 pr-2 hover:opacity-80">
          <LogoMark className="h-5 w-5 text-white" mouthColor="var(--accent)" />
          <span className="hidden font-head text-sm font-extrabold sm:inline">RoomCall</span>
        </Link>
        <div className="mx-1 hidden h-5 w-px shrink-0 bg-white/15 sm:block" />
        <nav className="flex shrink-0 items-center gap-0.5">
          <NavLink to={requestPath} label={t('staff.nav.requests')} icon={IconInboxEmpty} active={location.pathname === requestPath || location.pathname === `${requestPath}/`} />
          {staysAllowed && <NavLink to={staysPath} label={t('staff.nav.stays')} icon={IconBedEmpty} active={location.pathname.startsWith(staysPath)} />}
          {manageAllowed && <NavLink to={adminPath} label={t('staff.nav.admin')} icon={Settings} active={location.pathname.startsWith(adminPath)} />}
        </nav>
        <div className="flex-1" />
        <OnDutyToggle profile={profile} dark />
        <NotificationSettingsToggle dark align="right" />
        <TextSizeToggle dark align="right" />
        <LanguageToggle dark align="right" />
        <div className="mx-1 hidden h-5 w-px shrink-0 bg-white/15 sm:block" />
        <div className="hidden items-center gap-2 rounded-full bg-white/10 py-1 pr-3 pl-1 sm:flex">
          <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-white text-[0.625rem] font-bold text-accent">{initials}</span>
          <div className="leading-tight"><p className="text-[0.5625rem] font-bold tracking-wide text-white/50 uppercase">{roleLabel}</p><p className="truncate text-xs font-semibold">{profile.name}</p></div>
        </div>
        <button type="button" onClick={() => void signOut()} title={t('staff.nav.logout')} aria-label={t('staff.nav.logout')} className="flex h-11 w-11 shrink-0 cursor-pointer items-center justify-center rounded-full text-white/70 hover:bg-white/10 hover:text-white"><LogOut className="h-4 w-4" /></button>
      </div>
    </div>
  )
}

function NavLink({ to, label, icon: Icon, active }: { to: string; label: string; icon: ComponentType<SVGProps<SVGSVGElement>>; active: boolean }) {
  return <Link to={to} title={label} className={cn('flex min-h-11 items-center gap-1.5 rounded-full px-2.5 py-1.5 text-xs font-bold transition-colors sm:px-3.5 sm:text-sm', active ? 'bg-white/15 text-white' : 'text-white/60 hover:bg-white/10 hover:text-white')}><Icon className="h-4 w-4 shrink-0" /><span className="hidden sm:inline">{label}</span></Link>
}
