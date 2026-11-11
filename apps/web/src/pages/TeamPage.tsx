import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent, type FormEvent, type ReactNode } from 'react'
import type { CoreRole, JobTitle, MemberPermissionStatus, ModuleEntitlement, TeamMember } from '@homisuite/core-sdk'
import { Button, Modal, ModuleNav, Tabs, useRememberedState } from '@homisuite/ui'
import { Boxes, BriefcaseBusiness, Building2, KeyRound, Pencil, Plus, ShieldCheck, Trash2, UserPlus, Users } from 'lucide-react'
import { GuestLinkRow } from '../components/GuestLinkRow'
import { PageState } from '../components/PageState'
import { PasswordField } from '../components/PasswordField'
import { useConfirm } from '../components/ConfirmDialog'
import { Select } from '../components/Select'
import { Switch } from '../components/Switch'
import { core, supabase } from '../core/client'
import { useModuleRuntime } from '../core/ModuleRuntimeContext'
import { getPropertyLogoUrl } from '../core/propertyLogo'
import { buildTeamMemberUpdateInput } from './teamMemberPayload'
import { useStructureNav } from './HotelCorePages'
import { SettingRow } from './SettingsPage'

const suggestedJobs = [
  'Reception', 'Facchino', 'Cameriere/a ai piani', 'Bar', 'Cameriere colazione',
  'Governante', 'Addetto/a alle prenotazioni', 'Bar Manager', 'Front Office Manager',
  'Sales Manager', 'Rooms Division Manager',
]

type TeamState = { members: TeamMember[]; roles: CoreRole[]; jobTitles: JobTitle[]; canManage: boolean }
const emptyTeam: TeamState = { members: [], roles: [], jobTitles: [], canManage: false }

const UNASSIGNED_JOB_LABEL = 'Da assegnare'

export function TeamPage() {
  const runtime = useModuleRuntime()
  const nav = useStructureNav()
  const { hasPermission } = runtime
  const property = runtime.property
  const [team, setTeam] = useState<TeamState>(emptyTeam)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [createOpen, setCreateOpen] = useRememberedState('team.createOpen', false)
  // Modals remember just the record's id, not the TeamMember/JobTitle
  // object itself -- the object held across a remount could be stale, so
  // the actual modal prop is always re-derived below from the freshly
  // (re)loaded team.members/team.jobTitles.
  const [editingId, setEditingId] = useRememberedState<string | null>('team.editingMemberId', null)
  const [resettingPasswordId, setResettingPasswordId] = useRememberedState<string | null>('team.resettingPasswordMemberId', null)
  const [jobEditorKey, setJobEditorKey] = useRememberedState<string | null>('team.jobEditorKey', null)
  const [togglingId, setTogglingId] = useState<string | null>(null)
  const [removingId, setRemovingId] = useState<string | null>(null)
  const [modulesForId, setModulesForId] = useRememberedState<string | null>('team.modulesForMemberId', null)
  const [confirmDialog, confirm] = useConfirm()
  const anyModuleEntitled = runtime.entitlements.some((item) => item.enabled)
  const [canManageProperty, setCanManageProperty] = useState(false)
  const [propertyOpen, setPropertyOpen] = useRememberedState('team.propertyOpen', false)

  const editing = team.members.find((member) => member.membership.id === editingId) ?? null
  const resettingPassword = team.members.find((member) => member.membership.id === resettingPasswordId) ?? null
  const jobEditor = jobEditorKey === 'new' ? 'new' : team.jobTitles.find((job) => job.id === jobEditorKey) ?? null
  const modulesFor = team.members.find((member) => member.membership.id === modulesForId) ?? null
  function setEditing(member: TeamMember | null) { setEditingId(member?.membership.id ?? null) }
  function setResettingPassword(member: TeamMember | null) { setResettingPasswordId(member?.membership.id ?? null) }
  function setJobEditor(job: JobTitle | 'new' | null) { setJobEditorKey(job === 'new' ? 'new' : job?.id ?? null) }
  function setModulesFor(member: TeamMember | null) { setModulesForId(member?.membership.id ?? null) }

  useEffect(() => { void hasPermission('core.property.manage').then(setCanManageProperty).catch(() => setCanManageProperty(false)) }, [hasPermission])

  // Optimistic, matching the Moduli popup (#41) and Housekeeping's own
  // toggles (#45): flip the row immediately instead of waiting for
  // updateTeamMember's round trip. The earlier fix here (patch the one row
  // instead of a full loadTeam() reload) removed the *extra* network calls
  // but still held the switch `disabled` for this member's own request,
  // which was long enough to show the browser's not-allowed cursor --
  // exactly the same class of lag this pattern already fixes elsewhere.
  // togglingId still guards against a second click landing mid-request; it
  // just no longer disables the control to do it.
  async function onToggleAccess(member: TeamMember) {
    if (!property || togglingId === member.membership.id) return
    const next = member.membership.status === 'active' ? 'suspended' : 'active'
    setTogglingId(member.membership.id)
    setTeam((current) => ({
      ...current,
      members: current.members.map((m) =>
        m.membership.id === member.membership.id ? { ...m, membership: { ...m.membership, status: next } } : m,
      ),
    }))
    try {
      await core.updateTeamMember({ membershipId: member.membership.id, profileId: member.profile.id, propertyId: property.id, membershipStatus: next })
    } catch (cause) {
      setTeam((current) => ({
        ...current,
        members: current.members.map((m) =>
          m.membership.id === member.membership.id ? { ...m, membership: { ...m.membership, status: member.membership.status } } : m,
        ),
      }))
      setError(readableError(cause))
    } finally {
      setTogglingId(null)
    }
  }

  async function onRemoveMember(member: TeamMember) {
    const ok = await confirm({
      title: `Rimuovere ${member.profile.fullName}?`,
      description: 'La persona verrà rimossa dal team di questa struttura.',
      confirmLabel: 'Rimuovi',
    })
    if (!ok) return
    setRemovingId(member.membership.id)
    try {
      await core.archiveTeamMember({ membershipId: member.membership.id })
      await loadTeam({ silent: true })
    } catch (cause) {
      setError(readableError(cause))
    } finally {
      setRemovingId(null)
    }
  }

  // silent=true skips the loading flag: used after a mutation (toggle,
  // create, remove, job title change...) refreshes the list in place
  // instead of blanking the whole table and showing "Caricamento…" again,
  // which felt like the page lagging on every single click. Only the very
  // first load, and the error-banner's own retry, still show it.
  const loadTeam = useCallback(async (options?: { silent?: boolean }) => {
    if (!property) return
    if (!options?.silent) setLoading(true)
    setError(null)
    try {
      const [members, roles, jobTitles, canManage] = await Promise.all([
        core.getTeamMembers(property.id), core.getPropertyRoles(), core.getJobTitles(property.id),
        hasPermission('core.staff.manage'),
      ])
      setTeam({ members, roles, jobTitles, canManage })
    } catch (cause) { setError(readableError(cause)) }
    finally { if (!options?.silent) setLoading(false) }
  }, [property, hasPermission])

  useEffect(() => { void loadTeam() }, [loadTeam])

  const currentMember = team.members.find((member) => member.profile.id === runtime.profile?.id)
  const assignableRoles = team.roles.filter((role) => role.rank < (currentMember?.role.rank ?? 0))
  const propertyName = property?.name ?? 'Struttura'

  // Grouped by Mansione (job title) -- the label already shown per-row in
  // the "Mansione" column, not the Housekeeping "Reparto" field (a
  // different, Housekeeping-only concept scoped to guest_requests
  // visibility; see ModulesModal). Always groups: unlike Reparto, Mansione
  // exists for every property regardless of which modules are active.
  const memberGroups = useMemo(() => {
    const byLabel = new Map<string, TeamMember[]>()
    for (const member of team.members) {
      const label = member.jobTitle?.name ?? UNASSIGNED_JOB_LABEL
      const list = byLabel.get(label)
      if (list) list.push(member)
      else byLabel.set(label, [member])
    }
    return [...byLabel.entries()]
      .sort(([left], [right]) => {
        if (left === UNASSIGNED_JOB_LABEL) return 1
        if (right === UNASSIGNED_JOB_LABEL) return -1
        return left.localeCompare(right)
      })
      .map(([label, members]) => ({ key: label, label, members }))
  }, [team.members])

  function renderMemberRow(member: TeamMember) {
    const isSelf = member.profile.id === runtime.profile?.id
    const orgWide = member.membership.propertyId == null
    return (
      <div className="team-row" role="row" key={member.membership.id}>
        <span className="team-person" role="cell"><span className="mini-avatar">{initials(member.profile.fullName)}</span><strong>{member.profile.fullName}</strong></span>
        <span role="cell" className="team-role-cell" data-label="Accesso">
          {roleLabel(member.role.slug, member.role.displayName)}
          {member.membership.username ? <><br /><small className="muted">{member.membership.username}</small></> : null}
        </span>
        <span role="cell" className={member.jobTitle ? 'team-job-cell' : 'team-job-cell muted'} data-label="Mansione">{member.jobTitle?.name ?? 'Da assegnare'}</span>
        <span role="cell" className="team-status-cell" data-label="Stato">
          <Switch
            checked={member.membership.status === 'active'}
            onChange={() => onToggleAccess(member)}
            disabled={!team.canManage || isSelf || orgWide}
            aria-label={`Stato accesso di ${member.profile.fullName}`}
          />
          {member.employmentStatus === 'inactive' ? <small className="muted">Fuori organico</small> : null}
        </span>
        <span role="cell" className="team-row-actions">
          {team.canManage ? (
            <>
              <button className="row-action" type="button" onClick={() => setEditing(member)} aria-label={`Modifica ${member.profile.fullName}`} title="Modifica">
                <Pencil size={15} />
              </button>
              {member.membership.username ? (
                <button className="row-action" type="button" onClick={() => setResettingPassword(member)} aria-label={`Reimposta pin di ${member.profile.fullName}`} title="Reimposta pin">
                  <KeyRound size={15} />
                </button>
              ) : <span className="row-action-slot" aria-hidden="true" />}
              {anyModuleEntitled && !orgWide ? (
                <button
                  className="row-action"
                  type="button"
                  onClick={() => setModulesFor(member)}
                  aria-label={`Moduli di ${member.profile.fullName}`}
                  title="Moduli"
                >
                  <Boxes size={15} />
                </button>
              ) : <span className="row-action-slot" aria-hidden="true" />}
              <button
                className="row-action danger"
                type="button"
                onClick={() => onRemoveMember(member)}
                disabled={isSelf || orgWide || removingId === member.membership.id}
                aria-label={`Rimuovi ${member.profile.fullName}`}
                title={isSelf ? 'Non puoi rimuovere te stesso' : orgWide ? 'Gli accessi organizzazione si gestiscono a livello di organizzazione' : 'Rimuovi'}
              >
                <Trash2 size={15} />
              </button>
            </>
          ) : null}
        </span>
      </div>
    )
  }

  return (
    <div className="page-stack team-page">
      <ModuleNav propertyName={propertyName} moduleName="Struttura e Team" items={nav.items} value={nav.value} onValueChange={nav.onValueChange} ariaLabel="Struttura e Team" />

      {canManageProperty && (
        <section className="settings-section" data-tour="settings-property">
          <div className="settings-section-title"><Building2 size={18} /><div><h2>Struttura</h2><p>Configurazione condivisa di {propertyName}.</p></div></div>
          <div className="settings-list shell-card">
            <SettingRow title="Informazioni struttura" detail={`${propertyName} · ${property?.timezone ?? 'Fuso orario non impostato'}`} onClick={() => setPropertyOpen(true)} />
            <GuestLinkRow />
          </div>
        </section>
      )}

      <section className="shell-card team-principle-card">
        <div className="icon-tile"><ShieldCheck size={20} /></div>
        <div><strong>Accesso e mansione sono separati</strong><p>Il ruolo Homisuite decide cosa si può fare nel software. La mansione descrive il lavoro reale in hotel e può essere personalizzata dalla struttura.</p></div>
      </section>

      {error ? <div className="shell-alert error" role="alert">{error}<button type="button" onClick={() => void loadTeam()}>Riprova</button></div> : null}

      <section className="shell-card" data-tour="team-table">
        <div className="section-heading split">
          <div><h2>Persone</h2><p>Il team collegato a {propertyName}.</p></div>
          <span style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <span className="status-chip">{loading ? 'Caricamento…' : `${team.members.length} ${team.members.length === 1 ? 'profilo' : 'profili'}`}</span>
            {team.canManage ? <button className="primary-action" type="button" data-tour="team-add" onClick={() => setCreateOpen(true)}><UserPlus size={17} /> Crea profilo</button> : null}
          </span>
        </div>
        <div className="team-table" role="table" aria-label="Team">
          <div className="team-row team-row-head" role="row">
            <span role="columnheader">Persona</span>
            <span role="columnheader">Accesso Homisuite</span>
            <span role="columnheader">Mansione</span>
            <span role="columnheader">Stato</span>
            <span role="columnheader" aria-hidden="true" />
          </div>
          {!loading && memberGroups.map((group) => (
            <div key={group.key}>
              <div className="team-group-heading" role="row">
                <span role="columnheader">{group.label}</span>
                <span className="status-chip">{group.members.length}</span>
              </div>
              {group.members.map(renderMemberRow)}
            </div>
          ))}
        </div>
        {!loading && team.members.length === 0 ? <PageState kind="empty" icon={Users} title="Nessuna persona collegata a questa struttura." /> : null}
      </section>

      <section className="shell-card" data-tour="team-jobs">
        <div className="section-heading split">
          <div><h2>Mansioni della struttura</h2><p>Attiva solo quelle utili o creane di specifiche per l’hotel.</p></div>
          {team.canManage ? <button className="secondary-action" type="button" onClick={() => setJobEditor('new')}><Plus size={16} /> Nuova mansione</button> : null}
        </div>
        <div className="job-role-grid">
          {team.jobTitles.filter((job) => job.active).map((job) => team.canManage
            ? <button className="job-role-chip active" type="button" key={job.id} onClick={() => setJobEditor(job)}><BriefcaseBusiness size={15} /><span>{job.name}</span><Pencil size={12} /></button>
            : <div className="job-role-chip active" key={job.id}><BriefcaseBusiness size={15} /><span>{job.name}</span></div>)}
          {team.jobTitles.filter((job) => job.active).length === 0 ? <span className="muted">Nessuna mansione attiva.</span> : null}
        </div>
        {team.canManage ? <SuggestedJobs existing={team.jobTitles} propertyId={property?.id ?? ''} onChanged={() => loadTeam({ silent: true })} /> : null}
      </section>

      <CreateProfileModal open={createOpen} propertyId={property?.id ?? ''} roles={assignableRoles} jobTitles={team.jobTitles.filter((job) => job.active)} onClose={() => setCreateOpen(false)} onCreated={() => loadTeam({ silent: true })} />
      <EditMemberModal member={editing} roles={assignableRoles} jobTitles={team.jobTitles.filter((job) => job.active)} currentProfileId={runtime.profile?.id ?? ''} propertyId={property?.id ?? ''} onClose={() => setEditing(null)} onSaved={async () => { setEditing(null); await loadTeam({ silent: true }) }} />
      <ResetPasswordModal member={resettingPassword} onClose={() => setResettingPassword(null)} />
      <JobModal job={jobEditor} propertyId={property?.id ?? ''} onClose={() => setJobEditor(null)} onSaved={async () => { setJobEditor(null); await loadTeam({ silent: true }) }} />
      <ModulesModal member={modulesFor} propertyId={property?.id ?? ''} entitlements={runtime.entitlements} onClose={() => { setModulesFor(null); void loadTeam({ silent: true }) }} />
      <PropertyModal open={propertyOpen} onClose={() => setPropertyOpen(false)} onSaved={async () => { setPropertyOpen(false); await runtime.refresh() }} />
      {confirmDialog}
    </div>
  )
}

function CreateProfileModal({ open, propertyId, roles, jobTitles, onClose, onCreated }: { open: boolean; propertyId: string; roles: CoreRole[]; jobTitles: JobTitle[]; onClose: () => void; onCreated: () => Promise<void> }) {
  const [mode, setMode] = useState<'email' | 'credentials'>('email')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [roleId, setRoleId] = useState('')
  const [jobId, setJobId] = useState('')
  const [created, setCreated] = useState<{ username: string; password: string } | null>(null)
  useEffect(() => { if (open) { setMode('email'); setSaving(false); setError(null); setRoleId(''); setJobId(''); setCreated(null) } }, [open])

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!roleId) { setError('Seleziona un ruolo.'); return }
    const form = new FormData(event.currentTarget)
    const fullName = String(form.get('name'))

    if (mode === 'email') {
      setSaving(true); setError(null)
      try {
        await core.inviteTeamMember({ propertyId, fullName, email: String(form.get('email')), roleId, jobTitleId: jobId || null })
        await onCreated()
        onClose()
      } catch (cause) { setError(readableError(cause)); setSaving(false) }
      return
    }

    const password = String(form.get('password'))
    const passwordConfirm = String(form.get('passwordConfirm'))
    if (password !== passwordConfirm) { setError('Le due password non coincidono.'); return }
    const username = String(form.get('username'))
    setSaving(true); setError(null)
    try {
      await core.createTeamMemberWithCredentials({ propertyId, fullName, username, password, roleId, jobTitleId: jobId || null })
      await onCreated()
      setCreated({ username, password })
    } catch (cause) { setError(readableError(cause)); setSaving(false) }
  }

  if (created) {
    return <Modal open={open} title="Profilo creato" description="Comunica queste credenziali alla persona: non verranno mostrate di nuovo." onClose={onClose} footer={<Button variant="primary" onClick={onClose}>Chiudi</Button>}>
      <div className="modal-form">
        <Field label="Identificativo di accesso"><input readOnly value={created.username} onFocus={(event) => event.currentTarget.select()} /></Field>
        <Field label="Password"><input readOnly value={created.password} onFocus={(event) => event.currentTarget.select()} /></Field>
      </div>
    </Modal>
  }

  return <Modal open={open} title="Crea profilo" description="Crea un unico account Homisuite e collegalo alla struttura." onClose={onClose} footer={<><Button variant="secondary" onClick={onClose}>Annulla</Button><Button variant="primary" type="submit" form="create-profile-form" disabled={saving || roles.length === 0}>{saving ? 'Creazione…' : mode === 'email' ? 'Invia invito' : 'Crea profilo'}</Button></>}>
    <div style={{ marginBottom: 4 }}>
      <Tabs
        aria-label="Modalità di creazione"
        items={[
          { value: 'email', label: 'Invito email' },
          { value: 'credentials', label: 'Credenziali' },
        ]}
        value={mode}
        onValueChange={(next) => { setMode(next as typeof mode); setError(null) }}
      />
    </div>
    <form className="modal-form" id="create-profile-form" onSubmit={submit}>
      <Field label="Nome e cognome"><input name="name" required minLength={2} maxLength={120} autoComplete="name" /></Field>
      {mode === 'email' ? (
        <Field label="Email"><input name="email" type="email" required autoComplete="email" /></Field>
      ) : (
        <>
          <Field label="Username"><input name="username" required minLength={3} maxLength={32} pattern="[a-z0-9][a-z0-9_-]{1,30}[a-z0-9]" title="Solo lettere minuscole, numeri, trattini e underscore" autoComplete="off" /></Field>
          <Field label="Password"><PasswordField name="password" required minLength={8} maxLength={72} autoComplete="new-password" /></Field>
          <Field label="Conferma password"><PasswordField name="passwordConfirm" required minLength={8} maxLength={72} autoComplete="new-password" /></Field>
        </>
      )}
      <Field label="Accesso Homisuite" htmlFor="create-role"><Select id="create-role" name="role" value={roleId} onChange={setRoleId}><option value="" disabled>Seleziona ruolo</option>{roles.map((role) => <option key={role.id} value={role.id}>{roleLabel(role.slug, role.displayName)}</option>)}</Select></Field>
      <Field label="Mansione" htmlFor="create-job"><Select id="create-job" name="job" value={jobId} onChange={setJobId}><option value="">Da assegnare</option>{jobTitles.map((job) => <option key={job.id} value={job.id}>{job.name}</option>)}</Select></Field>
      {error ? <p className="form-error" role="alert">{error}</p> : null}
    </form>
  </Modal>
}

function ResetPasswordModal({ member, onClose }: { member: TeamMember | null; onClose: () => void }) {
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState<string | null>(null)
  useEffect(() => { if (member) { setSaving(false); setError(null); setDone(null) } }, [member])
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!member) return
    const form = new FormData(event.currentTarget)
    const password = String(form.get('password'))
    const passwordConfirm = String(form.get('passwordConfirm'))
    if (password !== passwordConfirm) { setError('Le due password non coincidono.'); return }
    setSaving(true); setError(null)
    try {
      await core.resetTeamMemberPassword({ membershipId: member.membership.id, newPassword: password })
      setDone(password)
    } catch (cause) { setError(readableError(cause)); setSaving(false) }
  }
  if (done) {
    return <Modal open={Boolean(member)} title="Pin reimpostato" description="Comunica la nuova password alla persona: non verrà mostrata di nuovo." onClose={onClose} footer={<Button variant="primary" onClick={onClose}>Chiudi</Button>}>
      <div className="modal-form"><Field label="Nuova password"><input readOnly value={done} onFocus={(event) => event.currentTarget.select()} /></Field></div>
    </Modal>
  }
  return <Modal open={Boolean(member)} title={member ? `Reimposta pin di ${member.profile.fullName}` : 'Reimposta pin'} description="Imposta una nuova password per l'accesso via credenziali." onClose={onClose} footer={<><Button variant="secondary" onClick={onClose}>Annulla</Button><Button variant="primary" type="submit" form="reset-password-form" disabled={saving}>{saving ? 'Salvataggio…' : 'Reimposta'}</Button></>}>
    {member ? <form className="modal-form" id="reset-password-form" onSubmit={submit}>
      <Field label="Nuova password"><PasswordField name="password" required minLength={8} maxLength={72} autoComplete="new-password" /></Field>
      <Field label="Conferma nuova password"><PasswordField name="passwordConfirm" required minLength={8} maxLength={72} autoComplete="new-password" /></Field>
      {error ? <p className="form-error" role="alert">{error}</p> : null}
    </form> : null}
  </Modal>
}

// Display order/labels for whatever the property has enabled -- same slugs
// and Italian names as Home's own module tiles (HomePage.tsx).
const MODULE_CATALOG: { slug: string; title: string }[] = [
  { slug: 'guest_requests', title: 'Housekeeping' },
  { slug: 'dining', title: 'Ristorazione' },
  { slug: 'shifts', title: 'Turni' },
  { slug: 'smart_inbox', title: 'Smart Inbox' },
  { slug: 'transfers', title: 'Transfer' },
]

// Every module-scoped permission a member can be individually granted,
// independent of their role -- see 20261008090000_member_permission_overrides.sql
// (dining.manage/shifts.manage) and 20261014090000_guest_requests_manage_and_view_all.sql
// (the two Housekeeping slugs), plus Smart Inbox (20261107180000). A module with no entry here still gets the
// "Accesso al modulo" toggle below, just no nested permission rows (e.g.
// Transfer, which has no admin functionality of its own yet).
const MODULE_PERMISSIONS: Record<string, { slug: string; label: string }[]> = {
  guest_requests: [
    { slug: 'guest_requests.view_all', label: 'Visualizza tutte le richieste' },
    { slug: 'guest_requests.manage', label: 'Amministrazione' },
  ],
  dining: [{ slug: 'dining.manage', label: 'Amministrazione' }],
  shifts: [{ slug: 'shifts.manage', label: 'Amministrazione' }],
  // smart_inbox.view = answers guests (an "agent"); receptionists and up
  // have it by role. smart_inbox.manage = templates, hotel information,
  // settings and the Outlook mailbox.
  smart_inbox: [
    { slug: 'smart_inbox.view', label: 'Risponde agli ospiti' },
    { slug: 'smart_inbox.manage', label: 'Amministrazione' },
  ],
}

function ModulesModal({ member, propertyId, entitlements, onClose }: { member: TeamMember | null; propertyId: string; entitlements: ModuleEntitlement[]; onClose: () => void }) {
  const enabledModules = MODULE_CATALOG.filter((module) => entitlements.some((item) => item.enabled && item.slug === module.slug))
  const housekeepingEnabled = enabledModules.some((module) => module.slug === 'guest_requests')

  // Housekeeping's own legacy per-member presence toggle (staff_profiles,
  // bridged via grant-housekeeping-access) -- left completely untouched.
  // It coexists with, and is independent of, the generic module-access
  // toggle below: a member needs BOTH a 'reception'/'operatore' staff_profiles
  // row here AND no explicit membership_module_access block to actually use
  // Housekeeping. See the architecture note on membership_module_access for
  // why this isn't unified into one control yet.
  const [housekeepingStatus, setHousekeepingStatus] = useState<boolean | null>(null)
  const [housekeepingSaving, setHousekeepingSaving] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!member || !housekeepingEnabled) { setHousekeepingStatus(null); setError(null); return }
    setLoading(true)
    setError(null)
    core.getHousekeepingAccessStatus(member.membership.id)
      .then(setHousekeepingStatus)
      .catch((cause) => setError(readableError(cause)))
      .finally(() => setLoading(false))
  }, [member, housekeepingEnabled])

  async function onHousekeepingToggle() {
    if (!member || housekeepingStatus === null || housekeepingSaving) return
    const next = !housekeepingStatus
    setHousekeepingSaving(true)
    setError(null)
    setHousekeepingStatus(next)
    try {
      if (next) {
        await core.grantHousekeepingAccess({ membershipId: member.membership.id })
      } else {
        await core.revokeHousekeepingAccess({ membershipId: member.membership.id })
      }
      // New/revoked grants reset to mansione-scoped visibility; the separate
      // "Visualizza tutte le richieste" permission below governs full-queue
      // visibility from here on, independent of this reset.
      await core.updateTeamMember({ membershipId: member.membership.id, profileId: member.profile.id, propertyId, housekeepingDepartment: null })
    } catch (cause) {
      setHousekeepingStatus(!next)
      setError(readableError(cause))
    } finally {
      setHousekeepingSaving(false)
    }
  }

  // Generic per-member MODULE ACCESS -- distinct table/RPCs from the
  // permission overrides below (CAN this member enter the module at all,
  // vs WHICH EXTRA capabilities they have once in). Fetched for every
  // enabled module uniformly; defaults to true (no row = allowed).
  const [moduleAccessStatus, setModuleAccessStatus] = useState<Record<string, boolean | null>>({})
  const [moduleAccessSaving, setModuleAccessSaving] = useState<Record<string, boolean>>({})
  const enabledModuleSlugs = enabledModules.map((module) => module.slug).join(',')

  useEffect(() => {
    if (!member || !enabledModuleSlugs) { setModuleAccessStatus({}); return }
    let cancelled = false
    Promise.all(
      enabledModuleSlugs.split(',').map((slug) =>
        core.getMemberModuleAccessStatus(member.membership.id, slug).then((result) => [slug, result] as const),
      ),
    )
      .then((entries) => { if (!cancelled) setModuleAccessStatus(Object.fromEntries(entries)) })
      .catch((cause) => { if (!cancelled) setError(readableError(cause)) })
    return () => { cancelled = true }
  }, [member, enabledModuleSlugs])

  async function onModuleAccessToggle(moduleSlug: string) {
    if (!member || moduleAccessSaving[moduleSlug]) return
    const current = moduleAccessStatus[moduleSlug]
    if (current === null || current === undefined) return
    const next = !current
    setModuleAccessSaving((prev) => ({ ...prev, [moduleSlug]: true }))
    setError(null)
    setModuleAccessStatus((prev) => ({ ...prev, [moduleSlug]: next }))
    try {
      await core.setMemberModuleAccess(member.membership.id, moduleSlug, next)
    } catch (cause) {
      setModuleAccessStatus((prev) => ({ ...prev, [moduleSlug]: current }))
      setError(readableError(cause))
    } finally {
      setModuleAccessSaving((prev) => ({ ...prev, [moduleSlug]: false }))
    }
  }

  // Per-permission overrides -- one entry per permission slug, not per
  // module, since Housekeeping now carries two (view_all, manage). See
  // 20261008090000_member_permission_overrides.sql /
  // 20261014090000_guest_requests_manage_and_view_all.sql.
  const [permissionStatus, setPermissionStatus] = useState<Record<string, MemberPermissionStatus | null>>({})
  const [permissionSaving, setPermissionSaving] = useState<Record<string, boolean>>({})
  const permissionSlugs = enabledModules.flatMap((module) => MODULE_PERMISSIONS[module.slug] ?? []).map((p) => p.slug).join(',')

  useEffect(() => {
    if (!member || !permissionSlugs) { setPermissionStatus({}); return }
    let cancelled = false
    Promise.all(
      permissionSlugs.split(',').map((slug) =>
        core.getMemberPermissionStatus(member.membership.id, slug).then((result) => [slug, result] as const),
      ),
    )
      .then((entries) => { if (!cancelled) setPermissionStatus(Object.fromEntries(entries)) })
      .catch((cause) => { if (!cancelled) setError(readableError(cause)) })
    return () => { cancelled = true }
  }, [member, permissionSlugs])

  async function onPermissionToggle(permissionSlug: string) {
    if (!member) return
    const current = permissionStatus[permissionSlug]
    if (!current || current.grantedByRole || permissionSaving[permissionSlug]) return
    const nextOn = !current.grantedByOverride
    setPermissionSaving((prev) => ({ ...prev, [permissionSlug]: true }))
    setError(null)
    setPermissionStatus((prev) => ({ ...prev, [permissionSlug]: { ...current, grantedByOverride: nextOn } }))
    try {
      if (nextOn) {
        await core.grantMemberPermission(member.membership.id, permissionSlug)
      } else {
        await core.revokeMemberPermission(member.membership.id, permissionSlug)
      }
    } catch (cause) {
      setPermissionStatus((prev) => ({ ...prev, [permissionSlug]: current }))
      setError(readableError(cause))
    } finally {
      setPermissionSaving((prev) => ({ ...prev, [permissionSlug]: false }))
    }
  }

  const saving = housekeepingSaving || Object.values(moduleAccessSaving).some(Boolean) || Object.values(permissionSaving).some(Boolean)

  return <Modal open={Boolean(member)} title="Moduli" description={member ? `Moduli a cui ${member.profile.fullName} ha accesso.` : undefined} onClose={onClose} footer={<><Button variant="secondary" onClick={onClose}>Annulla</Button><Button variant="primary" onClick={onClose} disabled={saving}>{saving ? 'Salvataggio…' : 'Salva'}</Button></>}>
    {loading ? <p className="muted">Caricamento…</p> : (
      <>
        {enabledModules.map((module) => {
          const moduleAccess = moduleAccessStatus[module.slug]
          const isHousekeeping = module.slug === 'guest_requests'
          // Permission rows read as disabled (preserved, not deleted, but
          // currently ineffective) once EITHER access gate is off: the new
          // generic one for every module, plus Housekeeping's own legacy
          // one specifically.
          const accessBlocked = moduleAccess === false || (isHousekeeping && housekeepingStatus === false)
          const permissions = MODULE_PERMISSIONS[module.slug] ?? []
          return <div className="module-access-group" key={module.slug}>
            <div className="module-access-row">
              <strong>{module.title}</strong>
              <Switch
                checked={moduleAccess !== false}
                onChange={() => void onModuleAccessToggle(module.slug)}
                disabled={moduleAccess === null || moduleAccess === undefined}
                aria-label={`Accesso al modulo — ${module.title}`}
              />
            </div>
            {isHousekeeping ? (
              <div className="module-access-row module-access-subrow">
                <span>Accesso Housekeeping</span>
                <Switch
                  checked={Boolean(housekeepingStatus)}
                  onChange={() => void onHousekeepingToggle()}
                  disabled={housekeepingStatus === null}
                  aria-label="Accesso Housekeeping"
                />
              </div>
            ) : null}
            {permissions.map(({ slug, label }) => {
              const permission = permissionStatus[slug]
              const on = Boolean(permission?.grantedByRole || permission?.grantedByOverride)
              const lockedByRole = Boolean(permission?.grantedByRole)
              return <div className="module-access-row module-access-subrow" key={slug}>
                <span>{label}</span>
                <span className="module-access-toggle">
                  {lockedByRole ? <small className="muted">Incluso nel ruolo</small> : accessBlocked ? <small className="muted">Modulo disattivato</small> : null}
                  <Switch
                    checked={on}
                    onChange={() => void onPermissionToggle(slug)}
                    disabled={!permission || lockedByRole || accessBlocked}
                    aria-label={`${label} — ${module.title}`}
                  />
                </span>
              </div>
            })}
            {permissions.length === 0 && !isHousekeeping ? (
              <div className="module-access-row module-access-subrow">
                <small className="muted">Nessuna funzione aggiuntiva per questo modulo.</small>
              </div>
            ) : null}
          </div>
        })}
        {enabledModules.length === 0 ? <p className="muted">Nessun modulo attivo per questa struttura.</p> : null}
      </>
    )}
    {error ? <p className="form-error" role="alert">{error}</p> : null}
  </Modal>
}

function EditMemberModal({ member, roles, jobTitles, currentProfileId, propertyId, onClose, onSaved }: { member: TeamMember | null; roles: CoreRole[]; jobTitles: JobTitle[]; currentProfileId: string; propertyId: string; onClose: () => void; onSaved: () => Promise<void> }) {
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [roleId, setRoleId] = useState('')
  const [jobId, setJobId] = useState('')
  const [employmentStatus, setEmploymentStatus] = useState('active')
  useEffect(() => {
    if (!member) return
    setSaving(false); setError(null)
    setRoleId(member.role.id)
    setJobId(member.jobTitle?.id ?? '')
    setEmploymentStatus(member.employmentStatus)
  }, [member])
  const isSelf = member?.profile.id === currentProfileId
  const orgWide = member?.membership.propertyId == null
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!member) return; const form = new FormData(event.currentTarget); setSaving(true); setError(null)
    try {
      await core.updateTeamMember(buildTeamMemberUpdateInput(member, propertyId, currentProfileId, form))
      await onSaved()
    } catch (cause) { setError(readableError(cause)); setSaving(false) }
  }
  return <Modal open={Boolean(member)} title={member ? `Modifica ${member.profile.fullName}` : 'Modifica persona'} description={orgWide ? 'L’accesso organizzazione si modifica a livello organizzazione; qui puoi assegnare la mansione locale.' : undefined} onClose={onClose} footer={<><Button variant="secondary" onClick={onClose}>Annulla</Button><Button variant="primary" type="submit" form="edit-member-form" disabled={saving}>{saving ? 'Salvataggio…' : 'Salva'}</Button></>}>
    {member ? <form className="modal-form" id="edit-member-form" onSubmit={submit}>
      <Field label="Accesso Homisuite" htmlFor="edit-role"><Select id="edit-role" name="role" value={roleId} onChange={setRoleId} disabled={orgWide || isSelf}><option value={member.role.id}>{roleLabel(member.role.slug, member.role.displayName)}</option>{roles.filter((role) => role.id !== member.role.id).map((role) => <option key={role.id} value={role.id}>{roleLabel(role.slug, role.displayName)}</option>)}</Select></Field>
      <Field label="Mansione" htmlFor="edit-job"><Select id="edit-job" name="job" value={jobId} onChange={setJobId}><option value="">Da assegnare</option>{jobTitles.map((job) => <option key={job.id} value={job.id}>{job.name}</option>)}</Select></Field>
      <Field label="Stato lavorativo" htmlFor="edit-employment-status"><Select id="edit-employment-status" name="employmentStatus" value={employmentStatus} onChange={setEmploymentStatus}><option value="active">In organico</option><option value="inactive">Non più in organico</option></Select></Field>
      {error ? <p className="form-error" role="alert">{error}</p> : null}
    </form> : null}
  </Modal>
}

function JobModal({ job, propertyId, onClose, onSaved }: { job: JobTitle | 'new' | null; propertyId: string; onClose: () => void; onSaved: () => Promise<void> }) {
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const existing = job && job !== 'new' ? job : null
  useEffect(() => { if (job) { setSaving(false); setError(null) } }, [job])
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setSaving(true); setError(null)
    try {
      const name = String(new FormData(event.currentTarget).get('name'))
      if (existing) await core.updateJobTitle(existing.id, { name })
      else await core.createJobTitle(propertyId, name)
      await onSaved()
    }
    catch (cause) { setError(readableError(cause)); setSaving(false) }
  }
  async function deactivate() {
    if (!existing) return
    setSaving(true); setError(null)
    try { await core.updateJobTitle(existing.id, { active: false }); await onSaved() }
    catch (cause) { setError(readableError(cause)); setSaving(false) }
  }
  return <Modal open={Boolean(job)} title={existing ? 'Modifica mansione' : 'Nuova mansione'} description="La mansione descrive il lavoro, non modifica i permessi Homisuite." onClose={onClose} footer={<>{existing ? <Button variant="danger" className="push-left" onClick={() => void deactivate()} disabled={saving}>Disattiva</Button> : null}<Button variant="secondary" onClick={onClose}>Annulla</Button><Button variant="primary" type="submit" form="job-form" disabled={saving}>{saving ? 'Salvataggio…' : 'Salva'}</Button></>}>
    <form className="modal-form" id="job-form" onSubmit={submit}><Field label="Nome mansione"><input name="name" required minLength={1} maxLength={80} defaultValue={existing?.name ?? ''} /></Field>{error ? <p className="form-error" role="alert">{error}</p> : null}</form>
  </Modal>
}

function SuggestedJobs({ existing, propertyId, onChanged }: { existing: JobTitle[]; propertyId: string; onChanged: () => Promise<void> }) {
  const [saving, setSaving] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const existingNames = useMemo(() => new Set(existing.map((job) => job.name.toLocaleLowerCase('it'))), [existing])
  const missing = suggestedJobs.filter((job) => !existingNames.has(job.toLocaleLowerCase('it')))
  if (missing.length === 0) return null
  async function activate(job: string) {
    setSaving(job); setError(null)
    try { await core.createJobTitle(propertyId, job); await onChanged() }
    catch (cause) { setError(readableError(cause)) }
    finally { setSaving(null) }
  }
  return <div className="job-suggestions"><span>Suggerimenti</span><div>{missing.map((job) => <button type="button" key={job} disabled={saving !== null} onClick={() => void activate(job)}><Plus size={13} />{saving === job ? 'Attivazione…' : job}</button>)}</div>{error ? <p className="form-error" role="alert">{error}</p> : null}</div>
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

  const logoUrl = getPropertyLogoUrl(supabase, runtime.property)

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
  return <Modal open={open} title="Informazioni struttura" description="Dati condivisi da tutti i moduli Homisuite." onClose={onClose} footer={<><Button variant="secondary" onClick={onClose}>Annulla</Button><Button variant="primary" type="submit" form="property-form" disabled={saving}>{saving ? 'Salvataggio…' : 'Salva'}</Button></>}>
    <form className="modal-form" id="property-form" onSubmit={submit}>
      <div className="form-field">
        <span>Logo struttura</span>
        <div className="logo-picker">
          {logoUrl ? <img src={logoUrl} alt="" className="logo-picker-preview" /> : <div className="logo-picker-placeholder" aria-hidden="true" />}
          <div className="logo-picker-actions">
            <Button variant="secondary" onClick={() => logoInputRef.current?.click()} disabled={logoBusy}>
              {logoBusy ? 'Attendere…' : logoUrl ? 'Cambia logo' : 'Carica logo'}
            </Button>
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

function Field({ label, htmlFor, children }: { label: string; htmlFor?: string; children: ReactNode }) { return <label className="form-field" htmlFor={htmlFor}><span>{label}</span>{children}</label> }
function initials(name: string) { return name.trim().split(/\s+/).map((part) => part[0]).slice(0, 2).join('').toUpperCase() }
function roleLabel(slug: string, fallback: string) { return ({ organization_admin: 'Admin organizzazione', property_admin: 'Admin struttura', manager: 'Manager', receptionist: 'Operatore' } as Record<string, string>)[slug] ?? fallback }
function readableError(cause: unknown) { const message = cause instanceof Error ? cause.message : ''; if (/profile_exists_at_different_hotel/i.test(message)) return 'Questa persona ha già un profilo Housekeeping su un’altra struttura: non è possibile averne due.'; if (/property_not_mapped/i.test(message)) return 'Questa struttura non è ancora collegata a Housekeeping.'; if (/username/i.test(message)) return 'Username già in uso in questa struttura.'; if (/already|exists|409/i.test(message)) return 'Esiste già un account con questa email.'; if (/permission|forbidden|42501/i.test(message)) return 'Non hai i permessi necessari per questa operazione.'; return 'Operazione non riuscita. Riprova.' }
