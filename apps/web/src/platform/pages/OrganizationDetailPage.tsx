import { FormEvent, useEffect, useRef, useState, type RefObject } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { Pencil, Plus } from 'lucide-react'
import { Button, Modal } from '@homisuite/ui'
import type { PlatformOrganization, PlatformProperty } from '@homisuite/core-sdk'
import { core } from '../../core/client'
import { PageState } from '../../components/PageState'
import { Field } from '../PlatformField'
import { usePlatformContext } from '../PlatformContext'

export function OrganizationDetailPage() {
  const { organizationId } = useParams<{ organizationId: string }>()
  const navigate = useNavigate()
  const { selectedOrganization, selectOrganization, hasPlatformPermission } = usePlatformContext()
  const [organizations, setOrganizations] = useState<PlatformOrganization[] | null>(null)
  const [properties, setProperties] = useState<PlatformProperty[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [reloadToken, setReloadToken] = useState(0)
  const [editing, setEditing] = useState(false)
  const [creatingProperty, setCreatingProperty] = useState(false)
  const editTriggerRef = useRef<HTMLButtonElement>(null)
  const createTriggerRef = useRef<HTMLButtonElement>(null)

  // The organization list call also resolves this page's own breadcrumb
  // name -- platform_list_organizations() is the only RPC that returns it,
  // and re-fetching it here (rather than requiring it be passed via router
  // state) keeps this page correct on a direct deep link too.
  useEffect(() => {
    if (!organizationId) return
    let cancelled = false
    setError(null)
    setProperties(null)
    Promise.all([core.getPlatformOrganizations(), core.getPlatformProperties(organizationId)])
      .then(([orgs, props]) => {
        if (cancelled) return
        setOrganizations(orgs)
        setProperties(props)
        selectOrganization(orgs.find((org) => org.id === organizationId) ?? null)
      })
      .catch((cause) => { if (!cancelled) setError(cause instanceof Error ? cause.message : 'Errore sconosciuto') })
    return () => { cancelled = true }
  }, [organizationId, selectOrganization, reloadToken])

  const organization = organizations?.find((org) => org.id === organizationId)
  const organizationName = organization?.name ?? selectedOrganization?.name
  const canManageOrg = hasPlatformPermission('platform.organizations.manage')
  const canManageProperties = hasPlatformPermission('platform.properties.manage')

  if (!organizationId) return null

  return (
    <>
      <p className="platform-breadcrumb">
        <button type="button" onClick={() => navigate('/admin')}>Organizzazioni</button> / {organizationName ?? '…'}
      </p>
      <div className="platform-page-head">
        <div>
          <h1>{organizationName ?? 'Organizzazione'}</h1>
          <p className="muted">Proprietà appartenenti a questa organizzazione.</p>
        </div>
        <div className="platform-page-head-actions">
          {canManageOrg ? (
            <Button ref={editTriggerRef} variant="secondary" onClick={() => setEditing(true)}>
              <Pencil size={16} /> Rinomina
            </Button>
          ) : null}
          {canManageProperties ? (
            <Button ref={createTriggerRef} variant="primary" onClick={() => setCreatingProperty(true)}>
              <Plus size={16} /> Nuova proprietà
            </Button>
          ) : null}
        </div>
      </div>
      {error ? <PageState kind="error" title="Impossibile caricare le proprietà." description={error} /> : null}
      {!error && !properties ? <PageState kind="loading" title="Caricamento…" /> : null}
      {properties && properties.length === 0 ? <PageState kind="empty" title="Nessuna proprietà per questa organizzazione." /> : null}
      {properties && properties.length > 0 ? (
        <table className="platform-table">
          <thead>
            <tr><th>Nome</th><th>Stato</th><th>Fuso orario</th></tr>
          </thead>
          <tbody>
            {properties.map((property) => (
              <tr key={property.id} className="clickable" onClick={() => navigate(`/admin/organizations/${organizationId}/properties/${property.id}`)}>
                <td>{property.name}</td>
                <td><span className="platform-badge">{property.status}</span></td>
                <td>{property.timezone}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
      {organization ? (
        <EditOrganizationModal
          open={editing}
          organization={organization}
          onClose={() => setEditing(false)}
          onSaved={() => { setEditing(false); setReloadToken((token) => token + 1) }}
          originRef={editTriggerRef}
        />
      ) : null}
      <CreatePropertyModal
        open={creatingProperty}
        organizationId={organizationId}
        onClose={() => setCreatingProperty(false)}
        onCreated={() => { setCreatingProperty(false); setReloadToken((token) => token + 1) }}
        originRef={createTriggerRef}
      />
    </>
  )
}

function EditOrganizationModal({ open, organization, onClose, onSaved, originRef }: {
  open: boolean
  organization: PlatformOrganization
  onClose: () => void
  onSaved: () => void
  originRef: RefObject<HTMLButtonElement | null>
}) {
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (saving) return
    const name = String(new FormData(event.currentTarget).get('name') ?? '').trim()
    setSaving(true)
    setError(null)
    try {
      await core.updatePlatformOrganization(organization.id, name)
      onSaved()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Errore sconosciuto')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      open={open}
      title="Rinomina organizzazione"
      onClose={onClose}
      dismissible={!saving}
      originRef={originRef}
      footer={<>
        <Button variant="secondary" onClick={onClose} disabled={saving}>Annulla</Button>
        <Button variant="primary" type="submit" form="edit-organization-form" disabled={saving}>{saving ? 'Salvataggio…' : 'Salva'}</Button>
      </>}
    >
      <form id="edit-organization-form" onSubmit={submit} className="modal-form">
        <Field label="Nome"><input name="name" required minLength={2} maxLength={120} defaultValue={organization.name} autoFocus /></Field>
        {error ? <p className="form-error" role="alert">{error}</p> : null}
      </form>
    </Modal>
  )
}

function CreatePropertyModal({ open, organizationId, onClose, onCreated, originRef }: {
  open: boolean
  organizationId: string
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
    const timezone = String(form.get('timezone') ?? '').trim()
    setSaving(true)
    setError(null)
    try {
      await core.createPlatformProperty(organizationId, name, slug, timezone || undefined)
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
      title="Nuova proprietà"
      onClose={onClose}
      dismissible={!saving}
      originRef={originRef}
      footer={<>
        <Button variant="secondary" onClick={onClose} disabled={saving}>Annulla</Button>
        <Button variant="primary" type="submit" form="create-property-form" disabled={saving}>{saving ? 'Creazione…' : 'Crea'}</Button>
      </>}
    >
      <form id="create-property-form" onSubmit={submit} className="modal-form">
        <Field label="Nome"><input name="name" required minLength={2} maxLength={120} autoFocus /></Field>
        <Field label="Slug"><input name="slug" required minLength={2} maxLength={60} pattern="[a-z0-9][a-z0-9-]*[a-z0-9]" title="Solo lettere minuscole, numeri e trattini" /></Field>
        <Field label="Fuso orario"><input name="timezone" placeholder="Europe/Rome" defaultValue="Europe/Rome" /></Field>
        {error ? <p className="form-error" role="alert">{error}</p> : null}
      </form>
    </Modal>
  )
}
