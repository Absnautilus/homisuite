import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { Bell, Settings, Sparkles } from 'lucide-react'
import { Modal } from '@homisuite/ui'
import { isSimpleModeEnabled, setSimpleModeEnabled, SIMPLE_MODE_CHANGE_EVENT } from '@homisuite/housekeeping-module'
import { useModuleRuntime } from '../core/ModuleRuntimeContext'
import { NotificationsToggle } from './NotificationsToggle'
import { ProfileModal } from './ProfileModal'
import { SecurityModal } from './SecurityModal'
import { SettingRow } from '../pages/SettingsPage'
import { Switch } from './Switch'

// Same slot id as HELP_SLOT_ID in HelpButton.tsx, next to it in the minimal
// bar's own top row (see minimal-top-bar.tsx). Docked-only, unlike the help
// button: outside "Modalità semplice" the ordinary Settings page already
// covers all of this, so there's nothing to float when there's no slot.
const SETTINGS_SLOT_ID = 'hk-minimal-bar-settings-slot'

// Opens in place, over the Housekeeping screen itself, instead of sending
// someone through the shell to the real Settings page -- the whole point of
// "Modalità semplice" is staying on this one screen. Deliberately a narrower
// slice of that page: only what a shared-device queue worker ever needs to
// touch (their own name, their password, and the two mode switches), reusing
// its own Profilo/Sicurezza modals unchanged so this never drifts from how
// the real page does the same two things.
export function SimplifiedSettingsButton({ dock }: { dock: boolean }) {
  const runtime = useModuleRuntime()
  const [open, setOpen] = useState(false)
  const [profileOpen, setProfileOpen] = useState(false)
  const [securityOpen, setSecurityOpen] = useState(false)
  const [simpleMode, setSimpleMode] = useState(() => isSimpleModeEnabled())
  const [slot, setSlot] = useState<HTMLElement | null>(null)

  useEffect(() => {
    if (!dock) {
      setSlot(null)
      return
    }
    const existing = document.getElementById(SETTINGS_SLOT_ID)
    if (existing) setSlot(existing)
    const observer = new MutationObserver(() => {
      const found = document.getElementById(SETTINGS_SLOT_ID)
      setSlot((current) => (found === current ? current : found))
    })
    observer.observe(document.body, { childList: true, subtree: true })
    return () => observer.disconnect()
  }, [dock])

  // Stays in sync if the flag is flipped from elsewhere (e.g. the top row's
  // own SimpleModeToggle) while this panel is open.
  useEffect(() => {
    function onChange() {
      setSimpleMode(isSimpleModeEnabled())
    }
    window.addEventListener(SIMPLE_MODE_CHANGE_EVENT, onChange)
    return () => window.removeEventListener(SIMPLE_MODE_CHANGE_EVENT, onChange)
  }, [])

  if (!dock || !slot) return null

  const profileName = runtime.profile?.fullName ?? 'Utente Homisuite'

  return (
    <>
      {createPortal(
        <button type="button" className="help-fab-inline" aria-label="Impostazioni" title="Impostazioni" onClick={() => setOpen(true)}>
          <Settings size={18} />
        </button>,
        slot,
      )}

      <Modal open={open} title="Impostazioni" description="Account e preferenze di questo dispositivo." onClose={() => setOpen(false)}>
        <div className="settings-list">
          <SettingRow title="Profilo" detail={profileName} onClick={() => setProfileOpen(true)} />
          <SettingRow title="Sicurezza" detail="Cambia la password del tuo account" onClick={() => setSecurityOpen(true)} />
          <div className="settings-row settings-row-control">
            <span className="settings-row-main">
              <span className="settings-row-icon"><Sparkles size={17} /></span>
              <span><strong>Modalità semplice</strong><small>Schermata richieste, senza il resto del menu</small></span>
            </span>
            <Switch
              checked={simpleMode}
              onChange={() => {
                const next = !simpleMode
                setSimpleMode(next)
                setSimpleModeEnabled(next)
              }}
              aria-label="Modalità semplice"
            />
          </div>
          <div className="settings-row settings-row-control">
            <span className="settings-row-main">
              <span className="settings-row-icon"><Bell size={17} /></span>
              <span><strong>Notifiche</strong><small>Avvisi push di Homisuite su questo dispositivo</small></span>
            </span>
            <NotificationsToggle />
          </div>
        </div>
      </Modal>

      <ProfileModal open={profileOpen} onClose={() => setProfileOpen(false)} onSaved={async () => { setProfileOpen(false); await runtime.refresh() }} />
      <SecurityModal open={securityOpen} onClose={() => setSecurityOpen(false)} />
    </>
  )
}
