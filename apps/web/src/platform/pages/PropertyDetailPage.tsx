import { FormEvent, useEffect, useRef, useState, type RefObject } from 'react'
import { useLocation, useNavigate, useParams } from 'react-router-dom'
import { Eye, Pencil, UserPlus } from 'lucide-react'
import { Button, Modal } from '@homisuite/ui'
import type { CoreRole, JobTitle, PlatformProperty, PlatformPropertyModule, PlatformTeamMember } from '@homisuite/core-sdk'
import { core } from '../../core/client'
import { PageState } from '../../components/PageState'
import { PasswordField } from '../../components/PasswordField'
import { Select } from '../../components/Select'
import { Switch } from '../../components/Switch'
import { Field } from '../PlatformField'
import { usePlatformContext } from '../PlatformContext'

// Modules with a wired, read-only operational view (Fase C, PR C3/C3b/C3c).
const OPERATIONAL_VIEW_ROUTES: Record<string, string> = { shifts: 'turni', dining: 'dining', guest_requests: 'housekeeping' }

export function PropertyDetailPage() {
  const { organizationId, propertyId } = useParams<{ organizationId: string; propertyId: string }>()
  const navigate = useNavigate()
  const location = useLocation()
  const { selectedOrganization, selectProperty, hasPlatformPermission, operationalSession, openOperationalSession, openImpersonationSession } = usePlatformContext()
  const [properties, setProperties] = useState<PlatformProperty[] | null>(null)
  const [modules, setModules] = useState<PlatformPropertyModule[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [reloadToken, setReloadToken] = useState(0)
  const [editing, setEditing] = useState(false)
  const [openingView, setOpeningView] = useState<string | null>(null)
  const editTriggerRef = useRef<HTMLButtonElement>(null)
  const sessionEnded = Boolean((location.state as { operationalSessionEnded?: boolean } | null)?.operationalSessionEnded)

  // Per-property team management (Fase C, PR C5) -- "crea nuovo utente (e
  // vedi utenti)", the first write capability past the console's original
  // read-only boundary. Loading the panel opens an operational session the
  // same way "Apri" already does for a module view -- a deliberate click,
  // reused if one is already active for this exact property.
  const [teamOpen, setTeamOpen] = useState(false)
  const [team, setTeam] = useState<PlatformTeamMember[] | null>(null)
  const [teamRoles, setTeamRoles] = useState<CoreRole[] | null>(null)
  const [teamJobTitles, setTeamJobTitles] = useState<JobTitle[] | null>(null)
  const [teamError, setTeamError] = useState<string | null>(null)
  const [loadingTeam, setLoadingTeam] = useState(false)
  const [createMemberOpen, setCreateMemberOpen] = useState(false)
  const newMemberTriggerRef = useRef<HTMLButtonElement>(null)
  const [viewingAs, setViewingAs] = useState<string | null>(null)

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

  async function openView(moduleSlug: string) {
    if (!propertyId || !organizationId) return
    const route = OPERATIONAL_VIEW_ROUTES[moduleSlug]
    if (!route) return
    setOpeningView(moduleSlug)
    try {
      await openOperationalSession(propertyId, 'Consultazione operativa dal pannello Admin Master')
      navigate(`/admin/organizations/${organizationId}/properties/${propertyId}/view/${route}`)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Errore sconosciuto')
    } finally {
      setOpeningView(null)
    }
  }

  // "Visualizza come" (Fase C follow-up, Part 2) -- opens an impersonation
  // session scoped to this one team member and jumps straight into
  // Housekeeping, the only module with a wired write so far. Writes made
  // from there execute with this person's functional authority but are
  // always attributed to Admin Master herself -- see
  // platform_impersonated_complete_guest_request's own doc comment.
  async function viewAs(membershipId: string) {
    if (!propertyId || !organizationId) return
    setViewingAs(membershipId)
    try {
      await openImpersonationSession(propertyId, membershipId, 'Visualizza come dal pannello Admin Master')
      navigate(`/admin/organizations/${organizationId}/properties/${propertyId}/view/housekeeping`)
    } catch (cause) {
      setTeamError(cause instanceof Error ? cause.message : 'Errore sconosciuto')
    } finally {
      setViewingAs(null)
    }
  }

  async function openTeamPanel() {
    if (!propertyId) return
    setTeamOpen(true)
    setLoadingTeam(true)
    setTeamError(null)
    try {
      if (!operationalSession || operationalSession.propertyId !== propertyId) {
        await openOperationalSession(propertyId, 'Gestione team dal pannello Admin Master')
      }
      const [members, roleList, jobTitleList] = await Promise.all([
        core.getPlatformPropertyTeam(propertyId),
        core.getPropertyRoles(),
        core.getJobTitles(propertyId),
      ])
      setTeam(members)
      setTeamRoles(roleList)
      setTeamJobTitles(jobTitleList)
    } catch (cause) {
      setTeamError(cause instanceof Error ? cause.message : 'Errore sconosciuto')
    } finally {
      setLoadingTeam(false)
    }
  }

  async function reloadTeam() {
    if (!propertyId) return
    try {
      setTeam(await core.getPlatformPropertyTeam(propertyId))
    } catch (cause) {
      setTeamError(cause instanceof Error ? cause.message : 'Errore sconosciuto')
    }
  }

  const property = properties?.find((item) => item.id === propertyId)
  const propertyName = property?.name
  const canManage = hasPlatformPermission('platform.properties.manage')
  const canOpenOperationalView = hasPlatformPermission('platform.support.read')
  const canManageTeam = hasPlatformPermission('platform.team.manage')
  const canImpersonate = hasPlatformPermission('platform.impersonation.write')
  // The only module with a wired impersonated write so far (Fase C
  // follow-up, Part 2) -- "Visualizza come" is offered only where it can
  // actually do something beyond the existing read-only mirror.
  const housekeepingEnabled = modules?.some((module) => module.slug === 'guest_requests' && module.enabled) ?? false

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
        <div style={{ display: 'flex', gap: 8 }}>
          {canManageTeam && !teamOpen ? (
            <Button variant="secondary" onClick={() => void openTeamPanel()}>
              <UserPlus size={16} /> Gestisci team
            </Button>
          ) : null}
          {canManage && property ? (
            <Button ref={editTriggerRef} variant="secondary" onClick={() => setEditing(true)}>
              <Pencil size={16} /> Modifica
            </Button>
          ) : null}
        </div>
      </div>
      {sessionEnded ? (
        <PageState
          kind="unavailable"
          title="La sessione operativa precedente è terminata."
          description="Apri di nuovo la vista operativa quando vuoi -- i tuoi privilegi restano invariati, è solo il contesto ad essere scaduto."
        />
      ) : null}
      {error ? <PageState kind="error" title="Operazione non riuscita." description={error} /> : null}
      {!error && !modules ? <PageState kind="loading" title="Caricamento…" /> : null}
      {modules && modules.length === 0 ? <PageState kind="empty" title="Nessun modulo registrato." /> : null}
      {modules && modules.length > 0 ? (
        <table className="platform-table">
          <thead>
            <tr><th>Modulo</th><th>Stato</th><th>Vista operativa</th></tr>
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
                <td>
                  {canOpenOperationalView && module.enabled && OPERATIONAL_VIEW_ROUTES[module.slug] ? (
                    <Button
                      variant="secondary"
                      size="sm"
                      disabled={openingView === module.slug}
                      onClick={() => void openView(module.slug)}
                    >
                      <Eye size={14} /> {openingView === module.slug ? 'Apertura…' : 'Apri'}
                    </Button>
                  ) : (
                    <span className="muted">—</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
      {teamOpen ? (
        <div className="platform-section">
          <div className="platform-page-head">
            <h2>Team</h2>
            <Button ref={newMemberTriggerRef} variant="secondary" onClick={() => setCreateMemberOpen(true)} disabled={loadingTeam}>
              <UserPlus size={16} /> Nuovo utente
            </Button>
          </div>
          {teamError ? <PageState kind="error" title="Operazione non riuscita." description={teamError} /> : null}
          {loadingTeam && !team ? <PageState kind="loading" title="Caricamento…" /> : null}
          {team && team.length === 0 ? <PageState kind="empty" title="Nessun membro del team." /> : null}
          {team && team.length > 0 ? (
            <table className="platform-table">
              <thead>
                <tr><th>Nome</th><th>Ruolo</th><th>Mansione</th><th>Stato</th><th>Azioni</th></tr>
              </thead>
              <tbody>
                {team.map((member) => (
                  <tr key={member.membershipId}>
                    <td>{member.fullName ?? '—'}</td>
                    <td>{member.roleDisplayName}</td>
                    <td>{member.jobTitleName ?? '—'}</td>
                    <td><span className={`platform-badge${member.status === 'active' ? ' enabled' : ''}`}>{member.status === 'active' ? 'Attivo' : member.status}</span></td>
                    <td>
                      {canImpersonate && housekeepingEnabled && member.status === 'active' ? (
                        <Button
                          variant="secondary"
                          size="sm"
                          disabled={viewingAs === member.membershipId}
                          onClick={() => void viewAs(member.membershipId)}
                        >
                          <Eye size={14} /> {viewingAs === member.membershipId ? 'Apertura…' : 'Visualizza come'}
                        </Button>
                      ) : (
                        <span className="muted">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : null}
        </div>
      ) : null}
      {propertyId && teamRoles && teamJobTitles ? (
        <CreateTeamMemberModal
          open={createMemberOpen}
          propertyId={propertyId}
          roles={teamRoles.filter((role) => role.scope === 'property')}
          jobTitles={teamJobTitles.filter((job) => job.active)}
          onClose={() => setCreateMemberOpen(false)}
          onCreated={reloadTeam}
          originRef={newMemberTriggerRef}
        />
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

function CreateTeamMemberModal({ open, propertyId, roles, jobTitles, onClose, onCreated, originRef }: {
  open: boolean
  propertyId: string
  roles: CoreRole[]
  jobTitles: JobTitle[]
  onClose: () => void
  onCreated: () => Promise<void>
  originRef: RefObject<HTMLButtonElement | null>
}) {
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [roleId, setRoleId] = useState('')
  const [jobId, setJobId] = useState('')
  const [created, setCreated] = useState<{ username: string; password: string } | null>(null)
  useEffect(() => { if (open) { setSaving(false); setError(null); setRoleId(''); setJobId(''); setCreated(null) } }, [open])

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!roleId) { setError('Seleziona un ruolo.'); return }
    const form = new FormData(event.currentTarget)
    const fullName = String(form.get('name'))
    const username = String(form.get('username'))
    const password = String(form.get('password'))
    const passwordConfirm = String(form.get('passwordConfirm'))
    if (password !== passwordConfirm) { setError('Le due password non coincidono.'); return }
    setSaving(true)
    setError(null)
    try {
      await core.createPlatformTeamMember({ propertyId, fullName, username, password, roleId, jobTitleId: jobId || null })
      await onCreated()
      setCreated({ username, password })
    } catch (cause) {
      setError(readablePlatformTeamError(cause))
      setSaving(false)
    }
  }

  if (created) {
    return (
      <Modal
        open={open}
        title="Utente creato"
        description="Comunica queste credenziali alla persona: non verranno mostrate di nuovo."
        onClose={onClose}
        originRef={originRef}
        footer={<Button variant="primary" onClick={onClose}>Chiudi</Button>}
      >
        <div className="modal-form">
          <Field label="Identificativo di accesso"><input readOnly value={created.username} onFocus={(event) => event.currentTarget.select()} /></Field>
          <Field label="Password"><input readOnly value={created.password} onFocus={(event) => event.currentTarget.select()} /></Field>
        </div>
      </Modal>
    )
  }

  return (
    <Modal
      open={open}
      title="Nuovo utente"
      description="Crea un account per questa proprietà -- senza passare da una membership ordinaria."
      onClose={onClose}
      dismissible={!saving}
      originRef={originRef}
      footer={<>
        <Button variant="secondary" onClick={onClose} disabled={saving}>Annulla</Button>
        <Button variant="primary" type="submit" form="create-platform-team-member-form" disabled={saving || roles.length === 0}>{saving ? 'Creazione…' : 'Crea utente'}</Button>
      </>}
    >
      <form className="modal-form" id="create-platform-team-member-form" onSubmit={submit}>
        <Field label="Nome e cognome"><input name="name" required minLength={2} maxLength={120} autoComplete="name" autoFocus /></Field>
        <Field label="Username"><input name="username" required minLength={3} maxLength={32} pattern="[a-z0-9][a-z0-9_-]{1,30}[a-z0-9]" title="Solo lettere minuscole, numeri, trattini e underscore" autoComplete="off" /></Field>
        <Field label="Password"><PasswordField name="password" required minLength={8} maxLength={72} autoComplete="new-password" /></Field>
        <Field label="Conferma password"><PasswordField name="passwordConfirm" required minLength={8} maxLength={72} autoComplete="new-password" /></Field>
        <Field label="Ruolo" htmlFor="create-team-role">
          <Select id="create-team-role" name="role" value={roleId} onChange={setRoleId}>
            <option value="" disabled>Seleziona ruolo</option>
            {roles.map((role) => <option key={role.id} value={role.id}>{role.displayName}</option>)}
          </Select>
        </Field>
        <Field label="Mansione" htmlFor="create-team-job">
          <Select id="create-team-job" name="job" value={jobId} onChange={setJobId}>
            <option value="">Da assegnare</option>
            {jobTitles.map((job) => <option key={job.id} value={job.id}>{job.name}</option>)}
          </Select>
        </Field>
        {error ? <p className="form-error" role="alert">{error}</p> : null}
      </form>
    </Modal>
  )
}

function readablePlatformTeamError(cause: unknown): string {
  const message = cause instanceof Error ? cause.message : ''
  if (/username_already_exists/i.test(message)) return 'Username già in uso in questa struttura.'
  if (/account_already_exists/i.test(message)) return 'Esiste già un account con questo identificativo.'
  if (/invalid_role/i.test(message)) return 'Ruolo non valido per questa proprietà.'
  if (/invalid_job_title/i.test(message)) return 'Mansione non valida per questa proprietà.'
  if (/forbidden|insufficient_privilege|42501/i.test(message)) return 'Non hai i permessi necessari per questa operazione.'
  if (/invalid_input/i.test(message)) return 'Dati non validi. Controlla i campi e riprova.'
  return 'Operazione non riuscita. Riprova.'
}
