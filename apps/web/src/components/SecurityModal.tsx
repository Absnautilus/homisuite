import { useEffect, useState, type FormEvent } from 'react'
import { Button, Modal } from '@homisuite/ui'
import { supabase } from '../core/client'
import { useModuleRuntime } from '../core/ModuleRuntimeContext'
import { PasswordField } from './PasswordField'

export function SecurityModal({ open, onClose }: { open: boolean; onClose: () => void }) {
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
