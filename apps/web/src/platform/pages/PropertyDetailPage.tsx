import { FormEvent, useEffect, useRef, useState, type RefObject } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { Pencil } from 'lucide-react'
import { Button, Modal } from '@homisuite/ui'
import type { PlatformProperty, PlatformPropertyModule } from '@homisuite/core-sdk'
import { core } from '../../core/client'
import { PageState } from '../../components/PageState'
import { Switch } from '../../components/Switch'
import { Field } from '../PlatformField'
import { usePlatformContext } from '../PlatformContext'

export function PropertyDetailPage() {
  const { organizationId, propertyId } = useParams<{ organizationId: string; propertyId: string }>()
  const navigate = useNavigate()
  const { selectedOrganization, selectProperty, hasPlatformPermission } = usePlatformContext()
  const [properties, setProperties] = useState<PlatformProperty[] | null>(null)
  const [modules, setModules] = useState<PlatformPropertyModule[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [reloadToken, setReloadToken] = useState(0)
  const [editing, setEditing] = useState(false)
  const editTriggerRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (!organizationId || !propertyId) return
    let cancelled = false
    setError(null)
    setModules(null)
    Promise.all([core.getPlatformProperties(organizationId), core.getPlatformPropertyModules(propertyId)])
      .then(([props, mods]) => {
        if (cancelled) return
        setProperties(props)
        setModules(mods)
        selectProperty(props.find((property) => property.id === propertyId) ?? null)
      })
      .catch((cause) => { if (!cancelled) setError(cause instanceof Error ? cause.message : 'Errore sconosciuto') })
    return () => { cancelled = true }
  }, [organizationId, propertyId, selectProperty, reloadToken])

  async function toggleModule(moduleSlug: string, nextEnabled: boolean) {
    if (!propertyId || !modules) return
    const previous = modules
    setModules(modules.map((module) => (module.slug === moduleSlug ? { ...module, enabled: nextEnabled } : module)))
    try {
      await core.setPlatformPropertyModule(propertyId, moduleSlug, nextEnabled)
    } catch (cause) {
      setModules(previous)
      setError(cause instanceof Error ? cause.message : 'Errore sconosciuto')
    }
  }

  const property = properties?.find((item) => item.id === propertyId)
  const propertyName = property?.name
  const canManage = hasPlatformPermission('platform.properties.manage')

  if (!organizationId || !propertyId) return null

  return (
    <>
      <p className="platform-breadcrumb">
        <button type="button" onClick={() => navigate('/admin')}>Organizzazioni</button>
        {' / '}
        <button type="button" onClick={() => navigate(`/admin/organizations/${organizationId}`)}>{selectedOrganization?.name ?? '…'}</button>
        {' / '}{propertyName ?? '…'}
      </p>
      <div className="platform-page-head">
        <div>
          <h1>{propertyName ?? 'Proprietà'}</h1>
          <p className="muted">Moduli abilitati per questa proprietà.</p>
        </div>
        {canManage && property ? (
          <Button ref={editTriggerRef} variant="secondary" onClick={() => setEditing(true)}>
            <Pencil size={16} /> Modifica
          </Button>
        ) : null}
      </div>
      {error ? <PageState kind="error" title="Operazione non riuscita." description={error} /> : null}
      {!error && !modules ? <PageState kind="loading" title="Caricamento…" /> : null}
      {modules && modules.length === 0 ? <PageState kind="empty" title="Nessun modulo registrato." /> : null}
      {modules && modules.length > 0 ? (
        <table className="platform-table">
          <thead>
            <tr><th>Modulo</th><th>Stato</th></tr>
          </thead>
          <tbody>
            {modules.map((module) => (
              <tr key={module.moduleId}>
                <td>{module.displayName}</td>
                <td>
                  {canManage ? (
                    <Switch
                      checked={module.enabled}
                      onChange={() => void toggleModule(module.slug, !module.enabled)}
                      aria-label={`Modulo ${module.displayName}`}
                    />
                  ) : (
                    <span className={`platform-badge${module.enabled ? ' enabled' : ''}`}>{module.enabled ? 'Abilitato' : 'Disabilitato'}</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
      {property ? (
        <EditPropertyModal
          open={editing}
          property={property}
          onClose={() => setEditing(false)}
          onSaved={() => { setEditing(false); setReloadToken((token) => token + 1) }}
          originRef={editTriggerRef}
        />
      ) : null}
    </>
  )
}

function EditPropertyModal({ open, property, onClose, onSaved, originRef }: {
  open: boolean
  property: PlatformProperty
  onClose: () => void
  onSaved: () => void
  originRef: RefObject<HTMLButtonElement | null>
}) {
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (saving) return
    const form = new FormData(event.currentTarget)
    const name = String(form.get('name') ?? '').trim()
    const timezone = String(form.get('timezone') ?? '').trim()
    const status = String(form.get('status') ?? '')
    setSaving(true)
    setError(null)
    try {
      await core.updatePlatformProperty(property.id, name, timezone, status)
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
      title="Modifica proprietà"
      onClose={onClose}
      dismissible={!saving}
      originRef={originRef}
      footer={<>
        <Button variant="secondary" onClick={onClose} disabled={saving}>Annulla</Button>
        <Button variant="primary" type="submit" form="edit-property-form" disabled={saving}>{saving ? 'Salvataggio…' : 'Salva'}</Button>
      </>}
    >
      <form id="edit-property-form" onSubmit={submit} className="modal-form">
        <Field label="Nome"><input name="name" required minLength={2} maxLength={120} defaultValue={property.name} autoFocus /></Field>
        <Field label="Fuso orario"><input name="timezone" required defaultValue={property.timezone} /></Field>
        <Field label="Stato" htmlFor="edit-property-status">
          <select id="edit-property-status" name="status" defaultValue={property.status}>
            <option value="active">Attiva</option>
            <option value="suspended">Sospesa</option>
          </select>
        </Field>
        {error ? <p className="form-error" role="alert">{error}</p> : null}
      </form>
    </Modal>
  )
}
