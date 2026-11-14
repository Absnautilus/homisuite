import { useEffect, useState, type ReactNode } from 'react'
import { PageHeader, Tabs, useRememberedState, useRememberedTab } from '@homisuite/ui'
import { Bell, ChevronRight, Globe2, LockKeyhole, SunMoon, UserRound } from 'lucide-react'
import { Link } from 'react-router-dom'
import { LanguageToggle } from '../components/LanguageToggle'
import { NotificationsToggle } from '../components/NotificationsToggle'
import { PageState } from '../components/PageState'
import { ProfileModal } from '../components/ProfileModal'
import { SecurityModal } from '../components/SecurityModal'
import { ThemeToggle } from '../components/ThemeToggle'
import { useModuleRuntime } from '../core/ModuleRuntimeContext'
import { readStoredThemePreference, resolveTheme, subscribeThemeChange } from '../lib/theme'

// ThemeToggle below is now a 2-way light/dark switch, not a 3-way
// light/dark/system one -- this sublabel has to track the same *resolved*
// value it does, or the two would read differently for the same state
// (this label said "Sistema" while the toggle highlighted "Chiaro" or
// "Scuro", whichever the OS resolved to -- the mismatch that prompted
// simplifying ThemeToggle in the first place).
const THEME_LABELS = { light: 'Chiaro', dark: 'Scuro' } as const

export function SettingsPage() {
  const runtime = useModuleRuntime()
  const profileName = runtime.profile?.fullName ?? 'Utente Homisuite'
  const [tab, setTab] = useRememberedTab('settings.tab', 'account')
  const [language, setLanguage] = useState(() => localStorage.getItem('homisuite.language') === 'en' ? 'en' : 'it')
  const [theme, setTheme] = useState(() => resolveTheme(readStoredThemePreference()))
  const [profileOpen, setProfileOpen] = useRememberedState('settings.profileOpen', false)
  const [securityOpen, setSecurityOpen] = useRememberedState('settings.securityOpen', false)

  useEffect(() => {
    function syncLanguage(event: Event) {
      const next = (event as CustomEvent<string>).detail
      if (next === 'it' || next === 'en') setLanguage(next)
    }
    window.addEventListener('homisuite:language-change', syncLanguage)
    return () => window.removeEventListener('homisuite:language-change', syncLanguage)
  }, [])

  useEffect(() => subscribeThemeChange(() => setTheme(resolveTheme(readStoredThemePreference()))), [])

  return (
    <div className="page-stack settings-page">
      <PageHeader eyebrow="Homisuite" title="Impostazioni" description="Il tuo account e i piani della struttura." />

      <Tabs
        aria-label="Sezioni Impostazioni"
        items={[
          { value: 'account', label: 'Account' },
          { value: 'piani', label: 'Piani e pagamenti' },
        ]}
        value={tab}
        onValueChange={(next) => setTab(next as 'account' | 'piani')}
      />

      {tab === 'account' ? (
        <section className="settings-section" id="account" data-tour="settings-account">
          <div className="settings-list shell-card">
            <SettingRow icon={<UserRound size={17} />} title="Profilo" detail={profileName} onClick={() => setProfileOpen(true)} />
            <div className="settings-row settings-row-control">
              <span className="settings-row-main"><span className="settings-row-icon"><Globe2 size={17} /></span><span><strong>Lingua</strong><small>{language === 'en' ? 'English' : 'Italiano'}</small></span></span>
              <LanguageToggle />
            </div>
            <div className="settings-row settings-row-control">
              <span className="settings-row-main"><span className="settings-row-icon"><SunMoon size={17} /></span><span><strong>Tema</strong><small>{THEME_LABELS[theme]}</small></span></span>
              <ThemeToggle />
            </div>
            <div className="settings-row settings-row-control">
              <span className="settings-row-main"><span className="settings-row-icon"><Bell size={17} /></span><span><strong>Notifiche</strong><small>Avvisi push di Homisuite su questo dispositivo</small></span></span>
              <NotificationsToggle />
            </div>
            <SettingRow icon={<LockKeyhole size={17} />} title="Sicurezza" detail="Cambia la password del tuo account" onClick={() => setSecurityOpen(true)} />
          </div>
        </section>
      ) : (
        <PageState kind="unavailable" title="Non ancora disponibile" description="Piano attivo, fatturazione e metodi di pagamento saranno gestiti da qui." />
      )}

      <ProfileModal open={profileOpen} onClose={() => setProfileOpen(false)} onSaved={async () => { setProfileOpen(false); await runtime.refresh() }} />
      <SecurityModal open={securityOpen} onClose={() => setSecurityOpen(false)} />
    </div>
  )
}

export type SettingRowProps = {
  title: string
  detail: string
  icon?: ReactNode
  muted?: boolean
  status?: string
  to?: string
  onClick?: () => void
}

export function SettingRow({ title, detail, icon, muted = false, status, to, onClick }: SettingRowProps) {
  const content = (
    <>
      <span className="settings-row-main">{icon ? <span className="settings-row-icon">{icon}</span> : null}<span><strong>{title}</strong><small>{detail}</small></span></span>
      {to || onClick ? (
        <ChevronRight size={17} />
      ) : (
        <span className="settings-row-status">
          {status}
        </span>
      )}
    </>
  )

  if (to) return <Link className="settings-row" to={to}>{content}</Link>
  if (onClick) return <button className="settings-row" type="button" onClick={onClick}>{content}</button>
  return <div className={`settings-row settings-row-static${muted ? ' muted' : ''}`}>{content}</div>
}
