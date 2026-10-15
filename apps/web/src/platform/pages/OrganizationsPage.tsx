import { FormEvent, useEffect, useRef, useState, type RefObject } from 'react'
import { useNavigate } from 'react-router-dom'
import { Plus } from 'lucide-react'
import { Button, Modal } from '@homisuite/ui'
import type { PlatformOrganization } from '@homisuite/core-sdk'
import { core } from '../../core/client'
import { PageState } from '../../components/PageState'
import { Field } from '../PlatformField'
import { usePlatformContext } from '../PlatformContext'

export function OrganizationsPage() {
  const navigate = useNavigate()
  const { hasPlatformPermission } = usePlatformContext()
  const [organizations, setOrganizations] = useState<PlatformOrganization[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const createTriggerRef = useRef<HTMLButtonElement>(null)

  const [reloadToken, setReloadToken] = useState(0)

  useEffect(() => {
    let cancelled = false
    core.getPlatformOrganizations()
      .then((result) => { if (!cancelled) setOrganizations(result) })
      .catch((cause) => { if (!cancelled) setError(cause instanceof Error ? cause.message : 'Errore sconosciuto') })
    return () => { cancelled = true }
  }, [reloadToken])

  const canManage = hasPlatformPermission('platform.organizations.manage')

  return (
    <>
      <div className="platform-page-head">
        <div>
          <h1>Organizzazioni</h1>
          <p className="muted">Tutte le organizzazioni clienti registrate su Homisuite.</p>
        </div>
        {canManage ? (
          <Button ref={createTriggerRef} variant="primary" onClick={() => setCreating(true)}>
            <Plus size={16} /> Nuova organizzazione
          </Button>
        ) : null}
      </div>
      {error ? <PageState kind="error" title="Impossibile caricare le organizzazioni." description={error} /> : null}
      {!error && !organizations ? <PageState kind="loading" title="Caricamento…" /> : null}
      {organizations && organizations.length === 0 ? <PageState kind="empty" title="Nessuna organizzazione registrata." /> : null}
      {organizations && organizations.length > 0 ? (
        <table className="platform-table">
          <thead>
            <tr><th>Nome</th><th>Slug</th><th>Creata il</th></tr>
          </thead>
          <tbody>
            {organizations.map((organization) => (
              <tr key={organization.id} className="clickable" onClick={() => navigate(`/admin/organizations/${organization.id}`)}>
                <td>{organization.name}</td>
                <td>{organization.slug}</td>
                <td>{new Date(organization.createdAt).toLocaleDateString('it-IT')}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
      <CreateOrganizationModal
        open={creating}
        onClose={() => setCreating(false)}
        onCreated={() => { setCreating(false); setReloadToken((token) => token + 1) }}
        originRef={createTriggerRef}
      />
    </>
  )
}

function CreateOrganizationModal({ open, onClose, onCreated, originRef }: {
  open: boolean
  onClose: () => void
  onCreated: () => void
  originRef: RefObject<HTMLButtonElement | null>
}) {
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (saving) return
    const form = new FormData(event.currentTarget)
    const name = String(form.get('name') ?? '').trim()
    const slug = String(form.get('slug') ?? '').trim()
    setSaving(true)
    setError(null)
    try {
      await core.createPlatformOrganization(name, slug)
      onCreated()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Errore sconosciuto')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      open={open}
      title="Nuova organizzazione"
      description="Crea una nuova organizzazione cliente."
      onClose={onClose}
      dismissible={!saving}
      originRef={originRef}
      footer={<>
        <Button variant="secondary" onClick={onClose} disabled={saving}>Annulla</Button>
        <Button variant="primary" type="submit" form="create-organization-form" disabled={saving}>{saving ? 'Creazione…' : 'Crea'}</Button>
      </>}
    >
      <form id="create-organization-form" onSubmit={submit} className="modal-form">
        <Field label="Nome"><input name="name" required minLength={2} maxLength={120} autoFocus /></Field>
        <Field label="Slug"><input name="slug" required minLength={2} maxLength={60} pattern="[a-z0-9][a-z0-9-]*[a-z0-9]" title="Solo lettere minuscole, numeri e trattini" /></Field>
        {error ? <p className="form-error" role="alert">{error}</p> : null}
      </form>
    </Modal>
  )
}
