import { useEffect, useState, type FormEvent } from 'react'
import { Button, Modal } from '@homisuite/ui'
import { core } from '../core/client'
import { useModuleRuntime } from '../core/ModuleRuntimeContext'

export function ProfileModal({ open, onClose, onSaved }: { open: boolean; onClose: () => void; onSaved: () => Promise<void> }) {
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
