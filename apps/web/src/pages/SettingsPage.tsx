import { useEffect, useState, type FormEvent, type ReactNode } from 'react'
import { Button, Modal, PageHeader, Tabs } from '@homisuite/ui'
import { Bell, ChevronRight, Globe2, LockKeyhole, SunMoon, UserRound } from 'lucide-react'
import { Link } from 'react-router-dom'
import { LanguageToggle } from '../components/LanguageToggle'
import { NotificationsToggle } from '../components/NotificationsToggle'
import { PageState } from '../components/PageState'
import { PasswordField } from '../components/PasswordField'
import { ThemeToggle } from '../components/ThemeToggle'
import { core, supabase } from '../core/client'
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
  const [tab, setTab] = useState<'account' | 'piani'>('account')
  const [language, setLanguage] = useState(() => localStorage.getItem('homisuite.language') === 'en' ? 'en' : 'it')
  const [theme, setTheme] = useState(() => resolveTheme(readStoredThemePreference()))
  const [profileOpen, setProfileOpen] = useState(false)
  const [securityOpen, setSecurityOpen] = useState(false)

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

function ProfileModal({ open, onClose, onSaved }: { open: boolean; onClose: () => void; onSaved: () => Promise<void> }) {
  const runtime = useModuleRuntime()
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => { if (open) { setSaving(false); setError(null) } }, [open])
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const form = new FormData(event.currentTarget); setSaving(true); setError(null)
    try {
      await core.updateCurrentProfile({ fullName: String(form.get('name')), avatarUrl: String(form.get('avatar')).trim() || null })
      await onSaved()
    } catch { setError('Non è stato possibile aggiornare il profilo.'); setSaving(false) }
  }
  return <Modal open={open} title="Profilo" description="Questi dati sono visibili agli altri membri del team." onClose={onClose} footer={<><Button variant="secondary" onClick={onClose}>Annulla</Button><Button variant="primary" type="submit" form="profile-form" disabled={saving}>{saving ? 'Salvataggio…' : 'Salva'}</Button></>}>
    <form className="modal-form" id="profile-form" onSubmit={submit}>
      <label className="form-field"><span>Nome e cognome</span><input name="name" required minLength={2} maxLength={120} defaultValue={runtime.profile?.fullName} autoComplete="name" /></label>
      <label className="form-field"><span>Email account</span><input value={runtime.session?.user.email ?? ''} readOnly /></label>
      <label className="form-field"><span>URL immagine profilo (facoltativo)</span><input name="avatar" type="url" defaultValue={runtime.profile?.avatarUrl ?? ''} /></label>
      {error ? <p className="form-error" role="alert">{error}</p> : null}
    </form>
  </Modal>
}

function SecurityModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const runtime = useModuleRuntime()
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState(false)
  useEffect(() => { if (open) { setSaving(false); setError(null); setDone(false) } }, [open])

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const email = runtime.session?.user.email
    if (!email) { setError('Sessione non valida. Ricarica la pagina.'); return }
    const form = new FormData(event.currentTarget)
    const currentPassword = String(form.get('current'))
    const newPassword = String(form.get('next'))
    const confirmPassword = String(form.get('confirm'))
    if (newPassword !== confirmPassword) { setError('Le due password non coincidono.'); return }
    setSaving(true); setError(null)
    try {
      // Re-check the current password before changing it -- updateUser only
      // needs an active session, it wouldn't otherwise ask for it.
      const { error: reauthError } = await supabase.auth.signInWithPassword({ email, password: currentPassword })
      if (reauthError) { setError('Password attuale non corretta.'); setSaving(false); return }
      const { error: updateError } = await supabase.auth.updateUser({ password: newPassword })
      if (updateError) throw updateError
      setDone(true)
    } catch { setError('Non è stato possibile aggiornare la password.'); setSaving(false) }
  }

  if (done) {
    return <Modal open={open} title="Password aggiornata" description="Usa la nuova password dal prossimo accesso." onClose={onClose} footer={<Button variant="primary" onClick={onClose}>Chiudi</Button>}>
      <p>La password del tuo account è stata cambiata.</p>
    </Modal>
  }
  return <Modal open={open} title="Cambia password" description="Serve la password attuale per confermare l'identità." onClose={onClose} footer={<><Button variant="secondary" onClick={onClose}>Annulla</Button><Button variant="primary" type="submit" form="security-form" disabled={saving}>{saving ? 'Salvataggio…' : 'Aggiorna'}</Button></>}>
    <form className="modal-form" id="security-form" onSubmit={submit}>
      <label className="form-field"><span>Password attuale</span><PasswordField name="current" required autoComplete="current-password" /></label>
      <label className="form-field"><span>Nuova password</span><PasswordField name="next" required minLength={8} maxLength={72} autoComplete="new-password" /></label>
      <label className="form-field"><span>Conferma nuova password</span><PasswordField name="confirm" required minLength={8} maxLength={72} autoComplete="new-password" /></label>
      {error ? <p className="form-error" role="alert">{error}</p> : null}
    </form>
  </Modal>
}
