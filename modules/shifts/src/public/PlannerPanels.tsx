import { useEffect, useMemo, useRef, useState, type RefObject } from 'react'
import { Download, GripVertical, Plus } from 'lucide-react'
import { Modal } from '@homisuite/ui'
import type { ShiftPlanningUnit, ShiftPreviewProperty } from '../preview/fixtures'
import { downloadShiftCalendar, generateShiftCalendarIcs, type ShiftCalendarEvent } from '../domain/icsExport'
import { ASSIGNMENT_ROLES, DEFAULT_HARD_RULES, DEFAULT_SOFT_RULES, type RoleCodes, initRestRotationPairsPerCycle, initRoleCodes, initRuleEnabled, initRuleOrder } from '../domain/defaultRules'
import { ShiftSelect } from './ShiftSelect'
import { ShiftDatePicker } from './ShiftDatePicker'

export interface ShiftRuleSetSave {
  planningUnitId: string
  coverage: Array<{ code: string; quantity: number }>
  hard: string[]
  soft: string[]
  restRotationPairsPerCycle: number
  roleCodes: Record<string, RoleCodes>
}

type PersonDraft = {
  unitId: string
  assignmentProfile: string
  restMode: 'fixed' | 'rotating'
  restDays: string
}

export interface ShiftStaffPlanningSave { staffProfileId: string; planningUnitId: string; assignmentProfile: string; restMode: 'fixed' | 'rotating'; restDays: string }
export interface ShiftAvailableTeamMember { profileId: string; name: string; jobTitle?: string }
export interface ShiftStaffAdd { profileId: string; planningUnitId: string }

const REST_DAY_OPTIONS = ['Sab + Dom', 'Dom + Lun', 'Lun + Mar']

export function EmployeesPanel({ property, availableTeamMembers = [], onReorderMembers, onSavePlanning, onAddStaffMember }: {
  property: ShiftPreviewProperty
  availableTeamMembers?: ShiftAvailableTeamMember[]
  onReorderMembers?: (change: { planningUnitId: string; staffProfileIds: string[] }) => Promise<void>
  onSavePlanning?: (change: ShiftStaffPlanningSave) => Promise<void>
  onAddStaffMember?: (input: ShiftStaffAdd) => Promise<void>
}) {
  const [addOpen, setAddOpen] = useState(false)
  const addTriggerRef = useRef<HTMLElement | null>(null)
  const activeUnits = property.units.filter((unit) => unit.status !== 'inactive')
  const roster = useMemo(() => {
    const people = new Map<string, { person: ShiftPlanningUnit['people'][number]; unitId: string }>()
    for (const unit of property.units) {
      for (const person of unit.people) if (!people.has(person.id)) people.set(person.id, { person, unitId: unit.id })
    }
    return [...people.values()]
  }, [property])
  const rosterById = useMemo(() => new Map(roster.map((entry) => [entry.person.id, entry])), [roster])
  const [personOrder, setPersonOrder] = useState(() => roster.map(({ person }) => person.id))
  useEffect(() => { setPersonOrder(roster.map(({ person }) => person.id)) }, [roster])
  const orderedRoster = personOrder.map((id) => rosterById.get(id)).filter((entry): entry is NonNullable<typeof entry> => entry != null)
  const [draggedId, setDraggedId] = useState<string | null>(null)
  const [reorderError, setReorderError] = useState(false)
  const [saveStates, setSaveStates] = useState<Record<string, 'saving' | 'saved' | 'error'>>({})
  // Column widths are shared across every row in an HTML table, so
  // collapsing one person's name alone can't reclaim any space -- clicking
  // any name instead compacts the whole Dipendente column down to just
  // avatars, which is what actually lets the other columns fit on mobile
  // without endless horizontal scrolling.
  const [namesCollapsed, setNamesCollapsed] = useState(false)
  const [drafts, setDrafts] = useState<Record<string, PersonDraft>>(() => Object.fromEntries(
    roster.map(({ person, unitId }) => [person.id, {
      unitId,
      assignmentProfile: person.assignmentProfile,
      restMode: person.restMode,
      restDays: person.restDays ?? '',
    }]),
  ))

  function update(personId: string, patch: Partial<PersonDraft>) {
    setDrafts((current) => {
      const existing = current[personId]
      return existing ? { ...current, [personId]: { ...existing, ...patch } } : current
    })
  }

  async function savePlanning(personId: string, patch: Partial<PersonDraft>) {
    const existing = drafts[personId]
    if (!existing || !onSavePlanning) { update(personId, patch); return }
    const next = { ...existing, ...patch }
    update(personId, patch)
    setSaveStates((current) => ({ ...current, [personId]: 'saving' }))
    try {
      const assignmentProfileKey = ASSIGNMENT_ROLES.find((role) => role.label === next.assignmentProfile)?.key ?? next.assignmentProfile
      await onSavePlanning({ staffProfileId: personId, planningUnitId: next.unitId, assignmentProfile: assignmentProfileKey, restMode: next.restMode, restDays: next.restMode === 'fixed' ? next.restDays : '' })
      setSaveStates((current) => ({ ...current, [personId]: 'saved' }))
      window.setTimeout(() => setSaveStates((current) => current[personId] === 'saved' ? { ...current, [personId]: undefined as never } : current), 2200)
    } catch {
      setDrafts((current) => ({ ...current, [personId]: existing }))
      setSaveStates((current) => ({ ...current, [personId]: 'error' }))
    }
  }

  function reorder(sourceId: string, targetId: string) {
    if (sourceId === targetId) return
    const source = rosterById.get(sourceId)
    const target = rosterById.get(targetId)
    if (!source || !target || source.unitId !== target.unitId) return
    const previousOrder = personOrder
    const nextOrder = [...previousOrder]
    const sourceIndex = nextOrder.indexOf(sourceId)
    const targetIndex = nextOrder.indexOf(targetId)
    nextOrder.splice(sourceIndex, 1)
    nextOrder.splice(targetIndex, 0, sourceId)
    setPersonOrder(nextOrder)
    setReorderError(false)
    const staffProfileIds = nextOrder.filter((id) => rosterById.get(id)?.unitId === source.unitId)
    onReorderMembers?.({ planningUnitId: source.unitId, staffProfileIds }).catch(() => {
      setPersonOrder(previousOrder)
      setReorderError(true)
    })
  }

  return (
    <section className="shift-panel shift-employees-panel">
      <div className="shift-panel-title">
        <div><h2>Dipendenti</h2><p>La lista arriva da Team. Qui assegni soltanto unità e parametri di pianificazione. Trascina per riordinare all'interno della stessa unità.</p></div>
        <span className="shift-panel-title-actions">
          <span className="shift-status-chip">{roster.length} persone</span>
          {onAddStaffMember ? <button type="button" className="shift-original-primary shift-codes-add" disabled={availableTeamMembers.length === 0} title={availableTeamMembers.length === 0 ? 'Tutti i membri attivi di Team sono già presenti in Turni' : undefined} onClick={(event) => { addTriggerRef.current = event.currentTarget; setAddOpen(true) }}><Plus size={14} />Aggiungi da Team</button> : null}
        </span>
      </div>
      {reorderError ? <div className="shift-empty" role="alert">Impossibile salvare il nuovo ordine. Riprova.</div> : null}
      <div className="shift-table-scroll" tabIndex={0} aria-label="Configurazione dipendenti per Turni">
        <table className={`shift-employees-table${namesCollapsed ? ' is-compact-names' : ''}`}>
          <thead><tr><th>Dipendente</th><th>Unità</th><th>Tipo turno</th><th>Riposo</th><th>Giorni fissi</th><th>Origine</th></tr></thead>
          <tbody>{orderedRoster.map(({ person, unitId }) => {
            const draft = drafts[person.id] ?? { unitId, assignmentProfile: person.assignmentProfile, restMode: person.restMode, restDays: person.restDays ?? '' }
            return (
              <tr key={person.id} draggable={Boolean(onReorderMembers)} className={draggedId === person.id ? 'is-dragging' : undefined}
                onDragStart={() => setDraggedId(person.id)}
                onDragEnd={() => setDraggedId(null)}
                onDragOver={(event) => { if (draggedId) event.preventDefault() }}
                onDrop={(event) => { event.preventDefault(); if (draggedId) reorder(draggedId, person.id) }}
              >
                <th scope="row">
                  <GripVertical size={15} aria-hidden="true" className="shift-drag-handle" />
                  <button type="button" className="shift-person-toggle" onClick={() => setNamesCollapsed((current) => !current)} aria-label={namesCollapsed ? 'Mostra i nomi dei dipendenti' : undefined}>
                    <span className="shift-avatar">{person.initials}</span>
                    {!namesCollapsed ? <span><strong>{person.name}</strong><small>{person.jobTitle}</small></span> : null}
                  </button>
                </th>
                <td><ShiftSelect ariaLabel={`Unità di ${person.name}`} value={draft.unitId} onChange={(unitId) => update(person.id, { unitId })} options={property.units.map((unit) => ({ value: unit.id, label: unit.name }))} /></td>
                <td><ShiftSelect ariaLabel={`Tipo turno di ${person.name}`} value={draft.assignmentProfile} onChange={(assignmentProfile) => void savePlanning(person.id, { assignmentProfile })} options={ASSIGNMENT_ROLES.map(({ label }) => ({ value: label, label }))} /></td>
                <td><ShiftSelect ariaLabel={`Riposo di ${person.name}`} value={draft.restMode} onChange={(restMode) => { const mode = restMode as PersonDraft['restMode']; if (mode === 'fixed' && !draft.restDays) void savePlanning(person.id, { restMode: mode, restDays: REST_DAY_OPTIONS[0] }); else void savePlanning(person.id, { restMode: mode }) }} options={[{ value: 'rotating', label: 'Rotante' }, { value: 'fixed', label: 'Fisso' }]} /></td>
                <td><ShiftSelect ariaLabel={`Giorni fissi di ${person.name}`} value={draft.restDays} disabled={draft.restMode !== 'fixed'} onChange={(restDays) => void savePlanning(person.id, { restDays })} options={[{ value: '', label: '—' }, ...REST_DAY_OPTIONS.map((label) => ({ value: label, label }))]} /></td>
                <td><span className="shift-status-chip">{saveStates[person.id] === 'saving' ? 'Salvataggio…' : saveStates[person.id] === 'saved' ? 'Salvato' : saveStates[person.id] === 'error' ? 'Errore' : (person.includedBy === 'manual' ? 'Manuale' : 'Da Team')}</span></td>
              </tr>
            )
          })}</tbody>
        </table>
      </div>
      <p className="shift-panel-note">Ordine e parametri di riposo vengono salvati subito. Creazione account, ruolo Homisuite e mansione lavorativa continuano a essere gestiti da Team.</p>
      {addOpen ? (
        <AddStaffMemberForm
          availableTeamMembers={availableTeamMembers}
          units={activeUnits}
          originRef={addTriggerRef}
          onAdd={onAddStaffMember}
          onClose={() => setAddOpen(false)}
        />
      ) : null}
    </section>
  )
}

function AddStaffMemberForm({ availableTeamMembers, units, originRef, onAdd, onClose }: {
  availableTeamMembers: ShiftAvailableTeamMember[]
  units: ShiftPlanningUnit[]
  originRef: RefObject<HTMLElement | null>
  onAdd?: (input: ShiftStaffAdd) => Promise<void>
  onClose: () => void
}) {
  const [profileId, setProfileId] = useState(availableTeamMembers[0]?.profileId ?? '')
  const [planningUnitId, setPlanningUnitId] = useState(units[0]?.id ?? '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit(event: { preventDefault: () => void }) {
    event.preventDefault()
    if (!onAdd || !profileId || !planningUnitId) return
    setSaving(true)
    setError(null)
    try {
      await onAdd({ profileId, planningUnitId })
      onClose()
    } catch {
      setError('Impossibile aggiungere questa persona a Turni. Riprova.')
      setSaving(false)
    }
  }

  return (
    <Modal
      open
      originRef={originRef}
      title="Aggiungi da Team"
      description="Scegli chi, tra i membri attivi di Team non ancora presenti in Turni, portare in questo modulo e in quale unità."
      onClose={onClose}
      dismissible={!saving}
      footer={<>
        <button type="button" className="shift-code-form-cancel" disabled={saving} onClick={onClose}>Annulla</button>
        <button type="submit" form="shift-add-staff-form" className="shift-original-primary" disabled={saving || !profileId || !planningUnitId}>{saving ? 'Aggiunta…' : 'Aggiungi'}</button>
      </>}
    >
      <form className="shift-code-form" id="shift-add-staff-form" onSubmit={submit}>
        <label className="shift-unit-name-field">
          Persona
          <ShiftSelect ariaLabel="Persona da aggiungere" value={profileId} disabled={saving} onChange={setProfileId} options={availableTeamMembers.map((member) => ({ value: member.profileId, label: member.jobTitle ? `${member.name} · ${member.jobTitle}` : member.name }))} />
        </label>
        <label className="shift-unit-name-field">
          Unità
          <ShiftSelect ariaLabel="Unità di destinazione" value={planningUnitId} disabled={saving} onChange={setPlanningUnitId} options={units.map((unit) => ({ value: unit.id, label: unit.name }))} />
        </label>
        {error ? <p role="alert" className="shift-code-form-error">{error}</p> : null}
      </form>
    </Modal>
  )
}

const COVERAGE_EXCLUDED_CODES = ['D1', 'D2', 'F1', 'F2']

function parseCoverage(coverage: string[]): Record<string, number> {
  return Object.fromEntries(coverage.map((entry) => {
    const [quantity, code] = entry.split(' × ')
    return [code ?? entry, Number(quantity) || 0]
  }))
}

export function RulesPanel({ unit, onSaveRules }: {
  unit: ShiftPlanningUnit
  onSaveRules?: (change: ShiftRuleSetSave) => Promise<void>
}) {
  const codeMap = useMemo(() => new Map(unit.codes.map((code) => [code.code, code])), [unit.codes])
  const [coverageDraft, setCoverageDraft] = useState<Record<string, number>>(() => parseCoverage(unit.rules.coverage))
  const [hardEnabled, setHardEnabled] = useState<Record<string, boolean>>(() => initRuleEnabled(DEFAULT_HARD_RULES, unit.rules.hard))
  const [softOrder, setSoftOrder] = useState<string[]>(() => initRuleOrder(DEFAULT_SOFT_RULES, unit.rules.soft))
  const [softEnabled, setSoftEnabled] = useState<Record<string, boolean>>(() => initRuleEnabled(DEFAULT_SOFT_RULES, unit.rules.soft))
  const [pairsPerCycle, setPairsPerCycle] = useState<number>(() => initRestRotationPairsPerCycle(unit.rules.restRotationPairsPerCycle))
  const [roleCodesDraft, setRoleCodesDraft] = useState<Record<string, RoleCodes>>(() => initRoleCodes(unit.rules.roleCodes))
  useEffect(() => {
    setCoverageDraft(parseCoverage(unit.rules.coverage))
    setHardEnabled(initRuleEnabled(DEFAULT_HARD_RULES, unit.rules.hard))
    setSoftOrder(initRuleOrder(DEFAULT_SOFT_RULES, unit.rules.soft))
    setSoftEnabled(initRuleEnabled(DEFAULT_SOFT_RULES, unit.rules.soft))
    setPairsPerCycle(initRestRotationPairsPerCycle(unit.rules.restRotationPairsPerCycle))
    setRoleCodesDraft(initRoleCodes(unit.rules.roleCodes))
  }, [unit.id, unit.rules.coverage, unit.rules.hard, unit.rules.soft, unit.rules.restRotationPairsPerCycle, unit.rules.roleCodes])
  const [newCode, setNewCode] = useState('')
  const [newQuantity, setNewQuantity] = useState(1)
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const availableCodes = unit.codes.filter((code) => code.time && !COVERAGE_EXCLUDED_CODES.includes(code.code) && coverageDraft[code.code] === undefined)
  const softByKey = useMemo(() => new Map(DEFAULT_SOFT_RULES.map((rule) => [rule.key, rule])), [])

  function updateQuantity(code: string, quantity: number) {
    setCoverageDraft((current) => ({ ...current, [code]: Math.max(0, Math.min(9, quantity)) }))
    setSaveState('idle')
  }
  function removeRule(code: string) {
    setCoverageDraft((current) => {
      const next = { ...current }
      delete next[code]
      return next
    })
    setSaveState('idle')
  }
  function addRule() {
    if (!newCode || coverageDraft[newCode] !== undefined) return
    setCoverageDraft((current) => ({ ...current, [newCode]: Math.max(1, Math.min(9, newQuantity)) }))
    setNewCode('')
    setNewQuantity(1)
    setSaveState('idle')
  }
  function toggleHard(key: string) {
    setHardEnabled((current) => ({ ...current, [key]: !current[key] }))
    setSaveState('idle')
  }
  function toggleSoft(key: string) {
    setSoftEnabled((current) => ({ ...current, [key]: !current[key] }))
    setSaveState('idle')
  }
  function updatePairsPerCycle(value: number) {
    setPairsPerCycle(Math.max(1, Math.min(9, Math.round(value) || 1)))
    setSaveState('idle')
  }
  function updateRoleCodes(role: string, field: 'base' | 'extra', text: string) {
    const codes = text.split(',').map((entry) => entry.trim().toUpperCase()).filter(Boolean)
    setRoleCodesDraft((current) => ({ ...current, [role]: { ...current[role], base: current[role]?.base ?? [], extra: current[role]?.extra ?? [], [field]: codes } }))
    setSaveState('idle')
  }
  function moveSoft(key: string, direction: -1 | 1) {
    setSoftOrder((current) => {
      const index = current.indexOf(key)
      const target = index + direction
      if (index < 0 || target < 0 || target >= current.length) return current
      const next = [...current]
      const sourceValue = next[index]
      const targetValue = next[target]
      if (sourceValue === undefined || targetValue === undefined) return current
      next[index] = targetValue
      next[target] = sourceValue
      return next
    })
    setSaveState('idle')
  }
  async function saveRules() {
    if (!onSaveRules) return
    setSaveState('saving')
    try {
      await onSaveRules({
        planningUnitId: unit.id,
        coverage: Object.entries(coverageDraft).map(([code, quantity]) => ({ code, quantity })),
        hard: DEFAULT_HARD_RULES.filter((rule) => hardEnabled[rule.key]).map((rule) => rule.text),
        soft: softOrder.filter((key) => softEnabled[key]).map((key) => softByKey.get(key)?.text).filter((text): text is string => text != null),
        restRotationPairsPerCycle: pairsPerCycle,
        roleCodes: roleCodesDraft,
      })
      setSaveState('saved')
    } catch {
      setSaveState('error')
    }
  }
  return (
    <div className="shift-rules-layout">
      <section className="shift-panel">
        <div className="shift-panel-title"><div><h2>Regole di copertura giornaliera</h2><p>Numero di dipendenti richiesti per ciascun turno, ogni giorno · {unit.name} · {unit.ruleSetName}</p></div><span className="shift-status-chip">v{unit.ruleSetVersion}</span></div>
        <div className="shift-coverage-editor">{Object.entries(coverageDraft).map(([code, quantity]) => {
          const def = codeMap.get(code)
          return <article key={code}>
            <button type="button" className="shift-coverage-remove" aria-label={`Rimuovi regola ${code}`} onClick={() => removeRule(code)}>✕</button>
            <strong style={{ background: def?.color, color: def?.textColor ?? '#fff' }}>{code}</strong>
            <span><button type="button" aria-label={`Diminuisci ${code}`} onClick={() => updateQuantity(code, quantity - 1)}>−</button><b>{quantity}</b><button type="button" aria-label={`Aumenta ${code}`} onClick={() => updateQuantity(code, quantity + 1)}>+</button></span>
          </article>
        })}</div>
        {onSaveRules ? <div className="shift-coverage-add">
          <label>Aggiungi regola<ShiftSelect ariaLabel="Turno da aggiungere alla copertura" value={newCode} onChange={setNewCode} options={[{ value: '', label: 'Seleziona turno...' }, ...availableCodes.map((code) => ({ value: code.code, label: `${code.code} — ${code.label}`, shortLabel: code.code, color: code.color, textColor: code.textColor }))]} /></label>
          <label>Quantità<input type="number" min={1} max={9} value={newQuantity} onChange={(event) => setNewQuantity(Number(event.target.value))} /></label>
          <button type="button" disabled={!newCode} onClick={addRule}>Aggiungi</button>
        </div> : null}
      </section>
      <section className="shift-panel">
        <div className="shift-panel-title"><div><h2>Regole assolute</h2><p>Vincoli rigidi e indipendenti tra loro, configurati soltanto per l’unità {unit.name}.</p></div></div>
        <div className="shift-rule-switches">{DEFAULT_HARD_RULES.map((rule) => <div key={rule.key}><span><strong>{rule.text.split(':')[0]}</strong>{`:${rule.text.split(':').slice(1).join(':')}`}</span><button type="button" role="switch" aria-checked={hardEnabled[rule.key] ?? true} className={hardEnabled[rule.key] ? 'is-on' : ''} disabled={!onSaveRules} onClick={() => toggleHard(rule.key)}><i /></button></div>)}
          <div>
            <span><strong>Rotazione riposi</strong>: dopo quante coppie di riposo consecutive il turno successivo diventa un giorno singolo e la rotazione slitta di un giorno.</span>
            <input type="number" min={1} max={9} value={pairsPerCycle} disabled={!onSaveRules} onChange={(event) => updatePairsPerCycle(Number(event.target.value))} className="shift-pairs-per-cycle-input" aria-label="Coppie di riposo per ciclo" />
          </div>
        </div>
      </section>
      <section className="shift-panel">
        <div className="shift-panel-title"><div><h2>Ruoli e codici</h2><p>Quali codici turno può coprire ciascun ruolo con "Assegna automaticamente": elenco separato da virgole. "Riserva" viene usato solo quando i codici base non bastano a coprire il fabbisogno.</p></div></div>
        <div className="shift-table-scroll" tabIndex={0} aria-label="Ruoli e codici idonei">
          <table className="shift-role-codes-table">
            <thead><tr><th>Ruolo</th><th>Codici base</th><th>Codici di riserva</th></tr></thead>
            <tbody>{ASSIGNMENT_ROLES.map(({ key, label }) => {
              const entry = roleCodesDraft[key] ?? { base: [], extra: [] }
              return <tr key={key}>
                <th scope="row">{label}</th>
                <td><input value={entry.base.join(', ')} disabled={!onSaveRules} onChange={(event) => updateRoleCodes(key, 'base', event.target.value)} placeholder="es. C1, C2, A1, A2" /></td>
                <td><input value={entry.extra.join(', ')} disabled={!onSaveRules} onChange={(event) => updateRoleCodes(key, 'extra', event.target.value)} placeholder="es. CE" /></td>
              </tr>
            })}</tbody>
          </table>
        </div>
      </section>
      <section className="shift-panel">
        <div className="shift-panel-title"><div><h2>Regole di preferenza</h2><p>Criteri usati in ordine per scegliere tra più candidati validi, dopo i vincoli assoluti.</p></div></div>
        <ol className="shift-priority-list">{softOrder.map((key, index) => {
          const rule = softByKey.get(key)
          if (!rule) return null
          return <li key={key}>
            <span>{index + 1}</span>
            <b>{rule.text}</b>
            {onSaveRules ? <span className="shift-priority-controls">
              <button type="button" aria-label={`Sposta su ${rule.text.split(':')[0]}`} onClick={() => moveSoft(key, -1)} disabled={index === 0}>↑</button>
              <button type="button" aria-label={`Sposta giù ${rule.text.split(':')[0]}`} onClick={() => moveSoft(key, 1)} disabled={index === softOrder.length - 1}>↓</button>
              <button type="button" role="switch" aria-checked={softEnabled[key] ?? true} className={softEnabled[key] ? 'is-on' : ''} onClick={() => toggleSoft(key)}><i /></button>
            </span> : null}
          </li>
        })}</ol>
      </section>
      {onSaveRules ? <div className="shift-coverage-save">
        <button type="button" className="shift-original-primary" disabled={saveState === 'saving'} onClick={() => void saveRules()}>{saveState === 'saving' ? 'Salvataggio…' : 'Salva regole'}</button>
        {saveState === 'saved' ? <span role="status">Regole salvate.</span> : null}
        {saveState === 'error' ? <span role="alert">Impossibile salvare. Riprova.</span> : null}
      </div> : null}
    </div>
  )
}

export interface ShiftRequestInboxItem { id: string; kind: 'absences' | 'preassignments' | 'swaps'; planningUnitId: string; staffProfileId: string; targetStaffProfileId?: string; status: string; date?: string; label: string; note?: string | null }
export function RequestInboxPanel({ items, people, currentStaffProfileId, canManage, onDecision }: { items: ShiftRequestInboxItem[]; people: ShiftPlanningUnit['people']; currentStaffProfileId?: string; canManage: boolean; onDecision?: (item: ShiftRequestInboxItem, approve: boolean) => Promise<void> }) {
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState(false)
  const name = (id: string) => people.find((person) => person.id === id)?.name ?? 'Dipendente'
  const actionable = (item: ShiftRequestInboxItem) => item.kind === 'swaps' ? (item.status === 'pending' ? item.targetStaffProfileId === currentStaffProfileId : item.status === 'accepted' && canManage) : canManage
  async function decide(item: ShiftRequestInboxItem, approve: boolean) {
    if (!onDecision) return
    setBusy(item.id); setError(false)
    try { await onDecision(item, approve) } catch { setError(true) } finally { setBusy(null) }
  }
  if (!items.length) return null
  return <section className="shift-original-panel"><h2>Richieste da gestire</h2><div className="shift-request-inbox">{items.map((item) => <div className="shift-request-card" key={item.kind + item.id}><div><strong>{item.label}</strong><span>{name(item.staffProfileId)}{item.date ? ` · ${item.date}` : ''}</span>{item.note ? <small>{item.note}</small> : null}</div>{actionable(item) ? <div className="shift-request-actions"><button type="button" disabled={busy === item.id} onClick={() => void decide(item, false)}>Rifiuta</button><button className="shift-original-primary" type="button" disabled={busy === item.id} onClick={() => void decide(item, true)}>{busy === item.id ? 'Aggiornamento…' : (item.kind === 'swaps' && item.status === 'pending' ? 'Accetta' : 'Approva')}</button></div> : <span className="shift-status-pill">{item.status === 'accepted' ? 'In attesa del responsabile' : item.status}</span>}</div>)}</div>{error ? <div className="shift-inline-warning" role="alert">Impossibile aggiornare la richiesta.</div> : null}</section>
}

export interface ShiftRequestSubmit { kind: 'absences' | 'preassignments' | 'swaps'; date: string; absenceKind?: string; shiftCodeId?: string; targetStaffProfileId?: string; requestedShiftId?: string; offeredShiftId?: string; note?: string }
export function RequestsPanel({ kind, unit, currentStaffProfileId, onSubmitRequest }: { kind: 'swaps' | 'absences' | 'preassignments'; unit: ShiftPlanningUnit; currentStaffProfileId?: string; onSubmitRequest?: (request: ShiftRequestSubmit) => Promise<void> }) {
  const [date, setDate] = useState('2026-09-01')
  const [absenceType, setAbsenceType] = useState('Ferie')
  const [affectedShift, setAffectedShift] = useState('Giornata intera')
  const [preCode, setPreCode] = useState('')
  const [swapTarget, setSwapTarget] = useState('')
  const [note, setNote] = useState('')
  const [submitState, setSubmitState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  async function submit(request: ShiftRequestSubmit) {
    if (!onSubmitRequest || !currentStaffProfileId) return
    setSubmitState('saving')
    try { await onSubmitRequest(request); setSubmitState('saved'); setNote('') } catch { setSubmitState('error') }
  }
  const people = unit.people

  if (kind === 'swaps') {
    const dateIndex = unit.assignmentDates?.indexOf(date) ?? -1
    const ownShiftId = dateIndex >= 0 && currentStaffProfileId ? unit.shiftIds?.[currentStaffProfileId]?.[dateIndex] : undefined
    const ownCode = dateIndex >= 0 && currentStaffProfileId ? unit.assignments[currentStaffProfileId]?.[dateIndex] : undefined
    const candidates = people.filter((person) => person.id !== currentStaffProfileId).map((person) => ({
      person,
      shiftId: dateIndex >= 0 ? unit.shiftIds?.[person.id]?.[dateIndex] : undefined,
      code: dateIndex >= 0 ? unit.assignments[person.id]?.[dateIndex] : undefined,
      locked: unit.lockedAssignments?.[person.id]?.includes(date) ?? false,
    })).filter((item) => item.shiftId && !item.locked)
    const selected = candidates.find((item) => item.person.id === swapTarget)
    return <section className="shift-original-panel">
      <h2>Richiedi cambio turno</h2>
      <p>Scegli un giorno e un collega. Il cambio viene rivalidato sui turni reali al momento della risposta; i turni bloccati non sono scambiabili.</p>
      <div className="shift-form-label">Giorno</div>
      <div className="shift-swap-date-row"><ShiftDatePicker ariaLabel="Giorno del cambio turno" value={date} onChange={(value) => { setDate(value); setSwapTarget('') }} /><span>{ownCode ? `Il tuo turno: ${ownCode}` : 'Non hai un turno assegnato in questa data'}</span></div>
      <div className="shift-form-label shift-section-label">Con chi vuoi scambiare</div>
      <div className="shift-swap-list">{candidates.map(({ person, code }) => <button type="button" className="shift-swap-person" aria-pressed={swapTarget === person.id} key={person.id} onClick={() => setSwapTarget(person.id)}>
        <span className="shift-avatar">{person.initials}</span><strong>{person.name}</strong><span>{code || '—'}</span>
      </button>)}</div>
      <div className="shift-note-submit"><label><span>Nota (facoltativa)</span><input value={note} onChange={(event) => setNote(event.target.value)} /></label><button className="shift-original-primary" type="button" disabled={!ownShiftId || !selected?.shiftId || !onSubmitRequest || submitState === 'saving'} onClick={() => { if (ownShiftId && selected?.shiftId) void submit({ kind: 'swaps', date, targetStaffProfileId: selected.person.id, requestedShiftId: ownShiftId, offeredShiftId: selected.shiftId, note }) }}>{submitState === 'saving' ? 'Invio…' : 'Invia richiesta'}</button></div>
      {!ownShiftId ? <div className="shift-inline-warning">Non è possibile scambiare un turno che non esiste ancora.</div> : null}
    </section>
  }

  if (kind === 'absences') return <section className="shift-original-panel">
    <h2>Ferie e permessi</h2>
    <p>Richiedi ferie o un permesso su un giorno specifico, anche di un mese diverso da quello visualizzato nel calendario. Resta soggetto a conferma dell'admin (Direttore o FOM).</p>
    <div className="shift-inline-form shift-absence-form">
      <label><span>Giorno</span><ShiftDatePicker ariaLabel="Giorno ferie o permesso" value={date} onChange={setDate} /></label>
      <label><span>Tipo</span><ShiftSelect ariaLabel="Tipo richiesta" value={absenceType} onChange={setAbsenceType} options={[{ value: "Ferie", label: "Ferie" }, { value: "Permesso", label: "Permesso" }, { value: "R.O.L.", label: "R.O.L." }, { value: "Malattia", label: "Malattia" }]} /></label>
      <label><span>Turno interessato</span><ShiftSelect ariaLabel="Turno interessato" value={affectedShift} onChange={setAffectedShift} options={[{ value: "Giornata intera", label: "Giornata intera" }, ...unit.codes.map((code) => ({ value: code.code, label: `${code.code} · ${code.label}`, shortLabel: code.code, color: code.color, textColor: code.textColor }))]} /></label>
    </div>
    <div className="shift-note-submit"><label><span>Nota (facoltativa)</span><input placeholder="es. visita medica" value={note} onChange={(event) => setNote(event.target.value)} /></label><button className="shift-original-primary" type="button" disabled={!onSubmitRequest || !currentStaffProfileId || submitState === 'saving'} onClick={() => void submit({ kind: 'absences', date, absenceKind: absenceType === 'Ferie' ? 'leave' : absenceType === 'Malattia' ? 'illness' : absenceType === 'Permesso' || absenceType === 'R.O.L.' ? 'permission' : 'other', note })}>{submitState === 'saving' ? 'Invio…' : 'Invia richiesta'}</button></div>
    <p className="shift-form-help">Se il permesso copre solo una parte del turno, indica ore e orario a quale turno si riferisce; altrimenti lascia “Giornata intera”.</p>
    <h3 className="shift-original-subtitle">Le mie richieste</h3>
    <p className="shift-empty-copy">Nessuna richiesta.</p>
    <h3 className="shift-original-subtitle">Ferie e permessi rimanenti — 2026</h3>
    <p className="shift-form-help">Calcolati sulle ferie già impostate a calendario in tutto l'anno e sui permessi con richiesta approvata.</p>
    <div className="shift-balance-table"><div className="is-head"><span>Dipendente</span><span>Ferie usate</span><span>Ferie residue</span><span>Permessi usati (h)</span><span>Permessi residui (h)</span></div>{people.slice(0,1).map((person) => <div key={person.id}><span><i className="shift-avatar">{person.initials}</i>{person.name}</span><span>—</span><span>—</span><span>—</span><span>—</span></div>)}</div>
  </section>

  return <section className="shift-original-panel">
    <h2>Pre-assegnazione turni</h2>
    <p>Proponi di esserti assegnato un turno specifico (o un giorno libero) in un giorno specifico, anche di un mese diverso da quello visualizzato nel calendario. Resta soggetto a conferma dell'admin (Direttore o FOM); una volta accettata, il turno viene bloccato automaticamente.</p>
    <div className="shift-inline-form shift-preassignment-form">
      <label><span>Giorno</span><ShiftDatePicker ariaLabel="Giorno pre-assegnazione" value={date} onChange={setDate} /></label>
      <label><span>Turno</span><ShiftSelect ariaLabel="Turno pre-assegnazione" value={preCode} onChange={setPreCode} options={[{ value: "", label: "Seleziona..." }, ...unit.codes.map((code) => ({ value: code.code, label: `${code.code} · ${code.label}`, shortLabel: code.code, color: code.color, textColor: code.textColor }))]} /></label>
      <label className="shift-grow"><span>Nota (facoltativa)</span><input placeholder="es. preferirei chiudere quel giorno" value={note} onChange={(event) => setNote(event.target.value)} /></label>
      <button className="shift-original-primary" type="button" disabled={!preCode || !onSubmitRequest || !currentStaffProfileId || submitState === 'saving'} onClick={() => { const code = unit.codes.find((item) => item.code === preCode); if (code) void submit({ kind: 'preassignments', date, shiftCodeId: code.id, note }) }}>{submitState === 'saving' ? 'Invio…' : 'Invia richiesta'}</button>
    </div>
    <p className="shift-form-help">Puoi scegliere solo tra i turni ammessi per il tuo ruolo. La richiesta resta in sospeso finché l'admin non la conferma; una volta accettata, il turno si blocca automaticamente.</p>
    <h3 className="shift-original-subtitle">Le mie richieste</h3>
    <p className="shift-empty-copy">Nessuna richiesta.</p>
  </section>
}

export interface StaffPreferenceSave { preferredShiftCodes: string[]; weekdayShiftPreferences: Record<string, string[]> }
export function PersonalPanel({ unit, initialPreferences, onSavePreferences }: { unit: ShiftPlanningUnit; initialPreferences?: StaffPreferenceSave; onSavePreferences?: (preferences: StaffPreferenceSave) => Promise<void> }) {
  const preferredCodes = unit.codes.filter((code) => code.time && code.code !== 'N').slice(0, 5)
  const [order, setOrder] = useState(() => initialPreferences?.preferredShiftCodes?.length ? initialPreferences.preferredShiftCodes : preferredCodes.map((code) => code.code))
  const [dayPreferences, setDayPreferences] = useState<Record<string, string[]>>(() => initialPreferences?.weekdayShiftPreferences ?? {})
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const days = [{ key: '1', label: 'Lun' }, { key: '2', label: 'Mar' }, { key: '3', label: 'Mer' }, { key: '4', label: 'Gio' }, { key: '5', label: 'Ven' }, { key: '6', label: 'Sab' }, { key: '7', label: 'Dom' }]
  function toggleDayPreference(day: string, code: string) {
    setDayPreferences((current) => {
      const existing = current[day] ?? []
      const next = existing.includes(code) ? existing.filter((item) => item !== code) : [...existing, code]
      return { ...current, [day]: next }
    })
  }
  function move(code: string, direction: -1 | 1) {
    setOrder((current) => {
      const index = current.indexOf(code)
      const target = index + direction
      if (index < 0 || target < 0 || target >= current.length) return current
      const next = [...current]
      const sourceValue = next[index]
      const targetValue = next[target]
      if (sourceValue === undefined || targetValue === undefined) return current
      next[index] = targetValue
      next[target] = sourceValue
      return next
    })
  }
  const codeMap = new Map(unit.codes.map((code) => [code.code, code]))
  return <section className="shift-original-panel shift-preferences">
    <h2>Le mie preferenze</h2>
    <p>Indica le tue preferenze: verranno tenute in considerazione dall'assegnazione automatica, bilanciandole con quelle degli altri colleghi. Ricordati di salvare per renderle effettive.</p>
    <div className="shift-form-label shift-section-label">Ordine di preferenza turni (generale)</div>
    <p className="shift-form-help">Metti in cima il turno che preferisci di più. Usa le frecce per riordinare. Vale come base, a meno che tu non imposti una preferenza più specifica per un giorno della settimana qui sotto.</p>
    <div className="shift-preference-order">{order.map((code, index) => {
      const def = codeMap.get(code)
      return <div key={code}><span>{index + 1}</span><strong style={{ background: def?.color, color: def?.textColor ?? '#fff' }}>{code}</strong><b>{def?.label}</b><button type="button" onClick={() => move(code, -1)} disabled={index === 0}>↑</button><button type="button" onClick={() => move(code, 1)} disabled={index === order.length - 1}>↓</button></div>
    })}</div>
    <div className="shift-form-label shift-section-label">Preferenze per giorno della settimana</div>
    <p className="shift-form-help">Es. “il lunedì preferisco C2, poi C1”. Seleziona uno o più turni per ciascun giorno, poi ordina la priorità con le frecce. Se imposti una preferenza qui, ha la precedenza su quella generale per quel giorno.</p>
    <div className="shift-weekday-preferences">{days.map((day) => <div key={day.key}><strong>{day.label}</strong><span>{order.map((code) => {
      const def = codeMap.get(code)
      const selected = (dayPreferences[day.key] ?? []).includes(code)
      return <button type="button" key={code} aria-pressed={selected} className={selected ? 'is-selected' : undefined} style={selected ? { background: def?.color, color: def?.textColor ?? '#fff' } : undefined} onClick={() => toggleDayPreference(day.key, code)}>{code}</button>
    })}</span></div>)}</div>
    <button className="shift-original-primary" type="button" disabled={!onSavePreferences || saveState === 'saving'} onClick={() => {
      if (!onSavePreferences) return
      setSaveState('saving')
      void onSavePreferences({ preferredShiftCodes: order, weekdayShiftPreferences: dayPreferences }).then(() => setSaveState('saved')).catch(() => setSaveState('error'))
    }}>{saveState === 'saving' ? 'Salvataggio…' : saveState === 'saved' ? 'Salvate' : 'Salva preferenze'}</button>
  </section>
}

const MONTHS = ['Gennaio', 'Febbraio', 'Marzo', 'Aprile', 'Maggio', 'Giugno', 'Luglio', 'Agosto', 'Settembre', 'Ottobre', 'Novembre', 'Dicembre']
const WEEKDAYS = ['Lun', 'Mar', 'Mer', 'Gio', 'Ven', 'Sab', 'Dom']

function assignmentForDate(unit: ShiftPlanningUnit, personId: string, date: string) {
  const index = unit.assignmentDates?.indexOf(date) ?? -1
  return index >= 0 ? unit.assignments[personId]?.[index] : undefined
}

function buildLoadedMonthEvents(unit: ShiftPlanningUnit, personId: string): ShiftCalendarEvent[] {
  return (unit.assignmentDates ?? []).flatMap((date) => {
    const code = assignmentForDate(unit, personId, date)
    if (!code) return []
    const [year, month, day] = date.split('-').map(Number)
    return [{ year: year!, month: month!, day: day!, code }]
  })
}

export function MyShiftsPanel({ unit, currentStaffProfileId }: { unit: ShiftPlanningUnit; currentStaffProfileId?: string }) {
  const person = unit.people.find((candidate) => candidate.id === currentStaffProfileId)
  const visibleDate = new Date(`${unit.month ?? new Date().toISOString().slice(0, 7)}-01T00:00:00Z`)
  const year = visibleDate.getUTCFullYear()
  const month = visibleDate.getUTCMonth()
  const codeMap = useMemo(() => new Map(unit.codes.map((code) => [code.code, code])), [unit.codes])
  const firstWeekday = (new Date(Date.UTC(year, month, 1)).getUTCDay() + 6) % 7
  const daysInMonth = new Date(Date.UTC(year, month + 1, 0)).getUTCDate()
  const previousMonthDays = new Date(Date.UTC(year, month, 0)).getUTCDate()
  const cells = Array.from({ length: 42 }, (_, index) => {
    const relativeDay = index - firstWeekday + 1
    if (relativeDay < 1) return { day: previousMonthDays + relativeDay, inMonth: false }
    if (relativeDay > daysInMonth) return { day: relativeDay - daysInMonth, inMonth: false }
    return { day: relativeDay, inMonth: true }
  })
  const today = new Date()
  const todayIso = today.toISOString().slice(0, 10)
  const tomorrow = new Date(today)
  tomorrow.setDate(tomorrow.getDate() + 1)
  const tomorrowIso = tomorrow.toISOString().slice(0, 10)
  const todayCode = person ? assignmentForDate(unit, person.id, todayIso) : undefined
  const tomorrowCode = person ? assignmentForDate(unit, person.id, tomorrowIso) : undefined

  function describe(code: string | undefined) {
    const definition = code ? codeMap.get(code) : undefined
    return definition ? `${definition.code} · ${definition.label}${definition.time ? ` · ${definition.time}` : ''}` : 'Nessun turno assegnato'
  }

  function exportCalendar() {
    if (!person) return
    const content = generateShiftCalendarIcs(person.id, unit.codes, buildLoadedMonthEvents(unit, person.id))
    downloadShiftCalendar(`turni-${person.id}-${unit.month ?? year}.ics`, content)
  }

  if (!currentStaffProfileId) return <section className="shift-panel"><p>Il tuo profilo non è ancora associato a Turni per questa struttura.</p></section>
  if (!person) return <section className="shift-panel"><p>Non fai parte dell'unità di pianificazione selezionata.</p></section>

  return <div className="shift-my-shifts">
    <section className="shift-today-summary" aria-label="Turni imminenti">
      <article><span>Il mio turno oggi</span><strong>{describe(todayCode)}</strong></article>
      <article><span>Il mio turno domani</span><strong>{describe(tomorrowCode)}</strong></article>
    </section>
    <section className="shift-panel shift-my-calendar">
      <div className="shift-my-calendar-header">
        <div><h2>I miei turni</h2><p>{person.name} · {person.assignmentProfile}</p></div>
        <div className="shift-my-period"><strong>{MONTHS[month]} {year}</strong></div>
        <button className="shift-export-button" type="button" onClick={exportCalendar}><Download size={16} />Esporta mese</button>
      </div>
      <div className="shift-my-calendar-scroll" tabIndex={0} aria-label={`Calendario personale di ${MONTHS[month]} ${year}`}>
        <div className="shift-my-calendar-grid">
          {WEEKDAYS.map((weekday) => <div className="shift-my-weekday" key={weekday}>{weekday}</div>)}
          {cells.map((cell, index) => {
            const date = cell.inMonth ? `${year}-${String(month + 1).padStart(2, '0')}-${String(cell.day).padStart(2, '0')}` : ''
            const code = cell.inMonth ? assignmentForDate(unit, person.id, date) : undefined
            const definition = code ? codeMap.get(code) : undefined
            const isToday = date === todayIso
            return <div className={`shift-my-day${cell.inMonth ? '' : ' is-outside'}${isToday ? ' is-today' : ''}`} key={`${index}-${cell.day}`}><span>{cell.day}</span>{definition ? <strong style={{ background: definition.color, color: definition.textColor ?? '#fff' }}>{definition.code}<small>{definition.time}</small></strong> : null}</div>
          })}
        </div>
      </div>
      <div className="shift-legend">{unit.codes.map((code) => <span key={code.code}><strong style={{ background: code.color, color: code.textColor ?? '#fff' }}>{code.code}</strong>{code.label}{code.time ? ` (${code.time})` : ''}</span>)}</div>
    </section>
  </div>
}
