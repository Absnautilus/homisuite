import { useEffect, useRef, useState, type ChangeEvent, type FormEvent, type ReactNode } from 'react'
import { Bell, Building2, ChevronRight, Globe2, LockKeyhole, Puzzle, UserRound } from 'lucide-react'
import { Link } from 'react-router-dom'
import { LanguageToggle } from '../components/LanguageToggle'
import { Modal } from '../components/Modal'
import { GuestLinkRow } from '../components/GuestLinkRow'
import { NotificationsToggle } from '../components/NotificationsToggle'
import { PasswordField } from '../components/PasswordField'
import { Select } from '../components/Select'
import { core, supabase } from '../core/client'
import { useModuleRuntime } from '../core/ModuleRuntimeContext'
import { useHousekeepingAccess } from '../modules/housekeeping/useHousekeepingAccess'

export function SettingsPage() {
  const runtime = useModuleRuntime()
  const { hasPermission } = runtime
  const housekeepingAccess = useHousekeepingAccess()
  const propertyName = runtime.property?.name ?? 'Struttura'
  const profileName = runtime.profile?.fullName ?? 'Utente Homisuite'
  const [language, setLanguage] = useState(() => localStorage.getItem('homisuite.language') === 'en' ? 'en' : 'it')
  const [propertyOpen, setPropertyOpen] = useState(false)
  const [profileOpen, setProfileOpen] = useState(false)
  const [securityOpen, setSecurityOpen] = useState(false)
  const [canManageProperty, setCanManageProperty] = useState(false)

  useEffect(() => { void hasPermission('core.property.manage').then(setCanManageProperty).catch(() => setCanManageProperty(false)) }, [hasPermission])

  useEffect(() => {
    function syncLanguage(event: Event) {
      const next = (event as CustomEvent<string>).detail
      if (next === 'it' || next === 'en') setLanguage(next)
    }
    window.addEventListener('homisuite:language-change', syncLanguage)
    return () => window.removeEventListener('homisuite:language-change', syncLanguage)
  }, [])

  return (
    <div className="page-stack shell-page settings-page">
      <header className="page-heading">
        <p className="eyebrow">Homisuite</p>
        <h1>Impostazioni</h1>
        <p>Preferenze della struttura, del tuo account e dei moduli.</p>
      </header>

      <section className="settings-section">
        <div className="settings-section-title"><Building2 size={18} /><div><h2>Struttura</h2><p>Configurazione condivisa di {propertyName}.</p></div></div>
        <div className="settings-list shell-card">
          <SettingRow title="Informazioni struttura" detail={`${propertyName} · ${runtime.property?.timezone ?? 'Fuso orario non impostato'}`} onClick={canManageProperty ? () => setPropertyOpen(true) : undefined} status={canManageProperty ? undefined : 'Permesso richiesto'} />
          <SettingRow title="Preferenze operative" detail="Fuso orario, formati e impostazioni comuni" status="Non ancora disponibile" muted />
          {canManageProperty && <GuestLinkRow />}
        </div>
      </section>

      <section className="settings-section" id="account">
        <div className="settings-section-title"><UserRound size={18} /><div><h2>Account</h2><p>Preferenze personali valide in tutta la suite.</p></div></div>
        <div className="settings-list shell-card">
          <SettingRow icon={<UserRound size={17} />} title="Profilo" detail={profileName} onClick={() => setProfileOpen(true)} />
          <div className="settings-row settings-row-control">
            <span className="settings-row-main"><span className="settings-row-icon"><Globe2 size={17} /></span><span><strong>Lingua</strong><small>{language === 'en' ? 'English' : 'Italiano'}</small></span></span>
            <LanguageToggle />
          </div>
          <div className="settings-row settings-row-control">
            <span className="settings-row-main"><span className="settings-row-icon"><Bell size={17} /></span><span><strong>Notifiche</strong><small>Avvisi push di Homisuite su questo dispositivo</small></span></span>
            <NotificationsToggle />
          </div>
          <SettingRow icon={<LockKeyhole size={17} />} title="Sicurezza" detail="Cambia la password del tuo account" onClick={() => setSecurityOpen(true)} />
        </div>
      </section>

      <section className="settings-section">
        <div className="settings-section-title"><Puzzle size={18} /><div><h2>Impostazioni moduli</h2><p>Configurazioni specifiche, senza duplicare le preferenze globali.</p></div></div>
        <div className="settings-list shell-card">
          {housekeepingAccess.status === 'compatible' ? (
            <SettingRow title="Housekeeping" detail="Categorie, richieste e configurazione operativa" to="/housekeeping/admin/menu" />
          ) : (
            <SettingRow
              title="Housekeeping"
              detail="Categorie, richieste e configurazione operativa"
              status={housekeepingStatus(housekeepingAccess.status)}
              muted
            />
          )}
          <SettingRow title="Turni" detail="Disponibile dopo l'integrazione del modulo" status="Non ancora disponibile" muted />
          <SettingRow title="Transfer" detail="Disponibile dopo l'integrazione del modulo" status="Non ancora disponibile" muted />
        </div>
      </section>

      <PropertyModal open={propertyOpen} onClose={() => setPropertyOpen(false)} onSaved={async () => { setPropertyOpen(false); await runtime.refresh() }} />
      <ProfileModal open={profileOpen} onClose={() => setProfileOpen(false)} onSaved={async () => { setProfileOpen(false); await runtime.refresh() }} />
      <SecurityModal open={securityOpen} onClose={() => setSecurityOpen(false)} />
    </div>
  )
}

function housekeepingStatus(status: ReturnType<typeof useHousekeepingAccess>['status']): string {
  if (status === 'loading') return 'Verifica disponibilità…'
  if (status === 'not-entitled') return 'Non abilitato'
  if (status === 'no-mapping') return 'Non collegato'
  if (status === 'no-profile') return 'Profilo operativo richiesto'
  if (status === 'error') return 'Disponibilità non verificabile'
  return ''
}

type SettingRowProps = {
  title: string
  detail: string
  icon?: ReactNode
  muted?: boolean
  status?: string
  to?: string
  onClick?: () => void
}

function SettingRow({ title, detail, icon, muted = false, status, to, onClick }: SettingRowProps) {
  const content = (
    <>
      <span className="settings-row-main">{icon ? <span className="settings-row-icon">{icon}</span> : null}<span><strong>{title}</strong><small>{detail}</small></span></span>
      {to || onClick ? <ChevronRight size={17} /> : <span className="settings-row-status">{status}</span>}
    </>
  )

  if (to) return <Link className="settings-row" to={to}>{content}</Link>
  if (onClick) return <button className="settings-row" type="button" onClick={onClick}>{content}</button>
  return <div className={`settings-row settings-row-static${muted ? ' muted' : ''}`}>{content}</div>
}

const LOGO_BUCKET = 'property-logos'
const LOGO_MAX_BYTES = 2 * 1024 * 1024
const DEFAULT_BRAND_COLOR = '#9c4fc7'
const HEX_COLOR_RE = /^#[0-9a-fA-F]{6}$/

// Paired with a plain text input (see BrandColorField below) rather than the
// swatch alone -- input[type=color] has no way to type or paste a known hex
// value, only to pick one visually.
function BrandColorField({ value, onChange }: { value: string; onChange: (hex: string) => void }) {
  const [text, setText] = useState(value)
  useEffect(() => setText(value), [value])

  function onTextChange(next: string) {
    setText(next)
    if (HEX_COLOR_RE.test(next)) onChange(next)
  }

  return (
    <div className="form-field">
      <span>Colore del marchio</span>
      <div className="brand-color-picker">
        <input
          type="color"
          value={HEX_COLOR_RE.test(text) ? text : DEFAULT_BRAND_COLOR}
          onChange={(e) => onTextChange(e.target.value)}
          aria-label="Colore del marchio"
        />
        <input
          type="text"
          value={text}
          onChange={(e) => onTextChange(e.target.value)}
          maxLength={7}
          placeholder={DEFAULT_BRAND_COLOR}
          spellCheck={false}
        />
        {value !== DEFAULT_BRAND_COLOR && (
          <button type="button" className="link-button" onClick={() => onChange(DEFAULT_BRAND_COLOR)}>
            Ripristina predefinito
          </button>
        )}
      </div>
      <small>Usato nell'app ospite al posto del viola Homisuite predefinito.</small>
    </div>
  )
}

function PropertyModal({ open, onClose, onSaved }: { open: boolean; onClose: () => void; onSaved: () => Promise<void> }) {
  const runtime = useModuleRuntime()
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [timezone, setTimezone] = useState('Europe/Rome')
  const [brandColor, setBrandColor] = useState(DEFAULT_BRAND_COLOR)
  const [logoBusy, setLogoBusy] = useState(false)
  const [logoError, setLogoError] = useState<string | null>(null)
  const logoInputRef = useRef<HTMLInputElement>(null)
  useEffect(() => {
    if (!open) return
    setSaving(false); setError(null); setLogoError(null)
    setTimezone(runtime.property?.timezone ?? 'Europe/Rome')
    const savedBrandColor = runtime.property?.settings.brandColor
    setBrandColor(typeof savedBrandColor === 'string' && HEX_COLOR_RE.test(savedBrandColor) ? savedBrandColor : DEFAULT_BRAND_COLOR)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, runtime.property?.timezone])

  const logoUpdatedAt = typeof runtime.property?.settings.logoUpdatedAt === 'string' ? runtime.property.settings.logoUpdatedAt : null
  const logoUrl = runtime.property && logoUpdatedAt
    ? `${supabase.storage.from(LOGO_BUCKET).getPublicUrl(`${runtime.property.id}/logo.png`).data.publicUrl}?v=${encodeURIComponent(logoUpdatedAt)}`
    : null

  async function onLogoChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    if (logoInputRef.current) logoInputRef.current.value = ''
    if (!file || !runtime.property) return
    if (file.type !== 'image/png') { setLogoError('Il logo deve essere un file PNG.'); return }
    if (file.size > LOGO_MAX_BYTES) { setLogoError('Il file supera i 2 MB consentiti.'); return }
    setLogoBusy(true); setLogoError(null)
    try {
      const { error: uploadError } = await supabase.storage.from(LOGO_BUCKET)
        .upload(`${runtime.property.id}/logo.png`, file, { upsert: true, contentType: 'image/png' })
      if (uploadError) throw uploadError
      await core.updateProperty(runtime.property.id, {
        name: runtime.property.name,
        timezone: runtime.property.timezone,
        settings: { ...runtime.property.settings, logoUpdatedAt: new Date().toISOString() },
      })
      await runtime.refresh()
    } catch { setLogoError('Non è stato possibile caricare il logo.') } finally { setLogoBusy(false) }
  }

  async function onLogoRemove() {
    if (!runtime.property) return
    setLogoBusy(true); setLogoError(null)
    try {
      const { error: removeError } = await supabase.storage.from(LOGO_BUCKET).remove([`${runtime.property.id}/logo.png`])
      if (removeError) throw removeError
      const settings = { ...runtime.property.settings }
      delete settings.logoUpdatedAt
      await core.updateProperty(runtime.property.id, { name: runtime.property.name, timezone: runtime.property.timezone, settings })
      await runtime.refresh()
    } catch { setLogoError('Non è stato possibile rimuovere il logo.') } finally { setLogoBusy(false) }
  }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!runtime.property) return
    const form = new FormData(event.currentTarget)
    setSaving(true); setError(null)
    try {
      const checkInTime = String(form.get('checkInTime') ?? '').trim() || null
      const checkOutTime = String(form.get('checkOutTime') ?? '').trim() || null
      const address = String(form.get('address') ?? '').trim() || null
      const phone = String(form.get('phone') ?? '').trim() || null
      const publicEmail = String(form.get('publicEmail') ?? '').trim() || null
      const website = String(form.get('website') ?? '').trim() || null
      const instagram = String(form.get('instagram') ?? '').trim() || null
      const facebook = String(form.get('facebook') ?? '').trim() || null
      const wifiNetwork = String(form.get('wifiNetwork') ?? '').trim() || null
      const wifiPassword = String(form.get('wifiPassword') ?? '').trim() || null
      const breakfastHours = String(form.get('breakfastHours') ?? '').trim() || null
      const barHours = String(form.get('barHours') ?? '').trim() || null
      await core.updateProperty(runtime.property.id, {
        name: String(form.get('name')),
        timezone,
        settings: {
          ...runtime.property.settings,
          checkInTime, checkOutTime, address, phone, publicEmail, website, instagram, facebook,
          wifiNetwork, wifiPassword, breakfastHours, barHours,
          brandColor: brandColor === DEFAULT_BRAND_COLOR ? null : brandColor,
        },
      })
      await onSaved()
    } catch { setError('Non è stato possibile aggiornare la struttura.'); setSaving(false) }
  }
  const checkInDefault = typeof runtime.property?.settings.checkInTime === 'string' ? runtime.property.settings.checkInTime : ''
  const checkOutDefault = typeof runtime.property?.settings.checkOutTime === 'string' ? runtime.property.settings.checkOutTime : ''
  const addressDefault = typeof runtime.property?.settings.address === 'string' ? runtime.property.settings.address : ''
  const phoneDefault = typeof runtime.property?.settings.phone === 'string' ? runtime.property.settings.phone : ''
  const publicEmailDefault = typeof runtime.property?.settings.publicEmail === 'string' ? runtime.property.settings.publicEmail : ''
  const websiteDefault = typeof runtime.property?.settings.website === 'string' ? runtime.property.settings.website : ''
  const instagramDefault = typeof runtime.property?.settings.instagram === 'string' ? runtime.property.settings.instagram : ''
  const facebookDefault = typeof runtime.property?.settings.facebook === 'string' ? runtime.property.settings.facebook : ''
  const wifiNetworkDefault = typeof runtime.property?.settings.wifiNetwork === 'string' ? runtime.property.settings.wifiNetwork : ''
  const wifiPasswordDefault = typeof runtime.property?.settings.wifiPassword === 'string' ? runtime.property.settings.wifiPassword : ''
  const breakfastHoursDefault = typeof runtime.property?.settings.breakfastHours === 'string' ? runtime.property.settings.breakfastHours : ''
  const barHoursDefault = typeof runtime.property?.settings.barHours === 'string' ? runtime.property.settings.barHours : ''
  return <Modal open={open} title="Informazioni struttura" description="Dati condivisi da tutti i moduli Homisuite." onClose={onClose} footer={<><button className="btn btn-secondary" type="button" onClick={onClose}>Annulla</button><button className="btn btn-primary" type="submit" form="property-form" disabled={saving}>{saving ? 'Salvataggio…' : 'Salva'}</button></>}>
    <form className="modal-form" id="property-form" onSubmit={submit}>
      <div className="form-field">
        <span>Logo struttura</span>
        <div className="logo-picker">
          {logoUrl ? <img src={logoUrl} alt="" className="logo-picker-preview" /> : <div className="logo-picker-placeholder" aria-hidden="true" />}
          <div className="logo-picker-actions">
            <button className="btn btn-secondary" type="button" onClick={() => logoInputRef.current?.click()} disabled={logoBusy}>
              {logoBusy ? 'Attendere…' : logoUrl ? 'Cambia logo' : 'Carica logo'}
            </button>
            {logoUrl ? <button className="link-button" type="button" onClick={onLogoRemove} disabled={logoBusy}>Rimuovi</button> : null}
            <input ref={logoInputRef} type="file" accept="image/png" hidden onChange={onLogoChange} />
          </div>
        </div>
        <small>PNG, sfondo trasparente consigliato · max 2 MB</small>
        {logoError ? <p className="form-error" role="alert">{logoError}</p> : null}
      </div>
      <label className="form-field"><span>Nome struttura</span><input name="name" required minLength={2} maxLength={120} defaultValue={runtime.property?.name} /></label>
      <label className="form-field" htmlFor="property-timezone"><span>Fuso orario</span><Select id="property-timezone" name="timezone" value={timezone} onChange={setTimezone}><option value="Europe/Rome">Europa — Roma</option><option value="Europe/London">Europa — Londra</option><option value="Europe/Amsterdam">Europa — Amsterdam</option><option value="America/Mexico_City">America — Città del Messico</option><option value="America/New_York">America — New York</option></Select></label>
      <label className="form-field"><span>Orario check-in predefinito</span><input name="checkInTime" type="time" defaultValue={checkInDefault} /></label>
      <label className="form-field"><span>Orario check-out predefinito</span><input name="checkOutTime" type="time" defaultValue={checkOutDefault} /></label>
      <p className="form-section-title">Contatti pubblici</p>
      <label className="form-field"><span>Indirizzo</span><input name="address" maxLength={200} defaultValue={addressDefault} placeholder="Via delle Terme, 12 · 30100 Venezia" /></label>
      <label className="form-field"><span>Telefono</span><input name="phone" type="tel" maxLength={40} defaultValue={phoneDefault} placeholder="+39 041 123 4567" /></label>
      <label className="form-field"><span>Email pubblica</span><input name="publicEmail" type="email" maxLength={200} defaultValue={publicEmailDefault} placeholder="info@tuohotel.it" /></label>
      <label className="form-field"><span>Sito web</span><input name="website" type="url" maxLength={200} defaultValue={websiteDefault} placeholder="https://tuohotel.it" /></label>
      <label className="form-field"><span>Instagram</span><input name="instagram" maxLength={200} defaultValue={instagramDefault} placeholder="@tuohotel" /></label>
      <label className="form-field"><span>Facebook</span><input name="facebook" maxLength={200} defaultValue={facebookDefault} placeholder="facebook.com/tuohotel" /></label>
      <p className="form-section-title">Info per gli ospiti</p>
      <label className="form-field"><span>Rete WiFi</span><input name="wifiNetwork" maxLength={100} defaultValue={wifiNetworkDefault} placeholder="Hotel-Guest" /></label>
      <label className="form-field"><span>Password WiFi</span><input name="wifiPassword" maxLength={100} defaultValue={wifiPasswordDefault} placeholder="benvenuto2026" /></label>
      <label className="form-field"><span>Orario colazione</span><input name="breakfastHours" maxLength={100} defaultValue={breakfastHoursDefault} placeholder="7:30 – 10:30" /></label>
      <label className="form-field"><span>Orario bar</span><input name="barHours" maxLength={100} defaultValue={barHoursDefault} placeholder="11:00 – 23:00" /></label>
      <BrandColorField value={brandColor} onChange={setBrandColor} />
      {error ? <p className="form-error" role="alert">{error}</p> : null}
    </form>
  </Modal>
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
  return <Modal open={open} title="Profilo" description="Questi dati sono visibili agli altri membri del team." onClose={onClose} footer={<><button className="btn btn-secondary" type="button" onClick={onClose}>Annulla</button><button className="btn btn-primary" type="submit" form="profile-form" disabled={saving}>{saving ? 'Salvataggio…' : 'Salva'}</button></>}>
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
    return <Modal open={open} title="Password aggiornata" description="Usa la nuova password dal prossimo accesso." onClose={onClose} footer={<button className="btn btn-primary" type="button" onClick={onClose}>Chiudi</button>}>
      <p>La password del tuo account è stata cambiata.</p>
    </Modal>
  }
  return <Modal open={open} title="Cambia password" description="Serve la password attuale per confermare l'identità." onClose={onClose} footer={<><button className="btn btn-secondary" type="button" onClick={onClose}>Annulla</button><button className="btn btn-primary" type="submit" form="security-form" disabled={saving}>{saving ? 'Salvataggio…' : 'Aggiorna'}</button></>}>
    <form className="modal-form" id="security-form" onSubmit={submit}>
      <label className="form-field"><span>Password attuale</span><PasswordField name="current" required autoComplete="current-password" /></label>
      <label className="form-field"><span>Nuova password</span><PasswordField name="next" required minLength={8} maxLength={72} autoComplete="new-password" /></label>
      <label className="form-field"><span>Conferma nuova password</span><PasswordField name="confirm" required minLength={8} maxLength={72} autoComplete="new-password" /></label>
      {error ? <p className="form-error" role="alert">{error}</p> : null}
    </form>
  </Modal>
}
