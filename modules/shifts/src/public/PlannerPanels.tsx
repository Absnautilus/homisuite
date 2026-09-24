import { useEffect, useMemo, useState } from 'react'
import { ChevronLeft, ChevronRight, Download, GripVertical } from 'lucide-react'
import type { ShiftPlanningUnit, ShiftPreviewProperty } from '../preview/fixtures'
import { downloadShiftCalendar, generateShiftCalendarIcs, type ShiftCalendarEvent } from '../domain/icsExport'
import { DEFAULT_HARD_RULES, DEFAULT_SOFT_RULES, initRuleEnabled, initRuleOrder } from '../domain/defaultRules'
import { ShiftSelect } from './ShiftSelect'
import { ShiftDatePicker } from './ShiftDatePicker'

export interface ShiftRuleSetSave {
  planningUnitId: string
  coverage: Array<{ code: string; quantity: number }>
  hard: string[]
  soft: string[]
}

type PersonDraft = {
  unitId: string
  assignmentProfile: string
  restMode: 'fixed' | 'rotating'
  restDays: string
}

export function EmployeesPanel({ property, onReorderMembers }: {
  property: ShiftPreviewProperty
  onReorderMembers?: (change: { planningUnitId: string; staffProfileIds: string[] }) => Promise<void>
}) {
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
        <span className="shift-status-chip">{roster.length} persone</span>
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
                <td><ShiftSelect ariaLabel={`Tipo turno di ${person.name}`} value={draft.assignmentProfile} onChange={(assignmentProfile) => update(person.id, { assignmentProfile })} options={['Diurno', 'Turnante', 'Notturno', 'Direttore', 'FOM'].map((label) => ({ value: label, label }))} /></td>
                <td><ShiftSelect ariaLabel={`Riposo di ${person.name}`} value={draft.restMode} onChange={(restMode) => update(person.id, { restMode: restMode as PersonDraft['restMode'] })} options={[{ value: 'rotating', label: 'Rotante' }, { value: 'fixed', label: 'Fisso' }]} /></td>
                <td><ShiftSelect ariaLabel={`Giorni fissi di ${person.name}`} value={draft.restDays} disabled={draft.restMode !== 'fixed'} onChange={(restDays) => update(person.id, { restDays })} options={[{ value: '', label: '—' }, ...['Sab + Dom', 'Dom + Lun', 'Lun + Mar'].map((label) => ({ value: label, label }))]} /></td>
                <td><span className="shift-status-chip">{person.includedBy === 'manual' ? 'Manuale' : 'Da Team'}</span></td>
              </tr>
            )
          })}</tbody>
        </table>
      </div>
      <p className="shift-panel-note">L'ordine si salva subito. Le altre modifiche restano locali nella preview: creazione account, ruolo Homisuite e mansione lavorativa continuano a essere gestiti da Team.</p>
    </section>
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
  useEffect(() => {
    setCoverageDraft(parseCoverage(unit.rules.coverage))
    setHardEnabled(initRuleEnabled(DEFAULT_HARD_RULES, unit.rules.hard))
    setSoftOrder(initRuleOrder(DEFAULT_SOFT_RULES, unit.rules.soft))
    setSoftEnabled(initRuleEnabled(DEFAULT_SOFT_RULES, unit.rules.soft))
  }, [unit.id, unit.rules.coverage, unit.rules.hard, unit.rules.soft])
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
        <div className="shift-rule-switches">{DEFAULT_HARD_RULES.map((rule) => <div key={rule.key}><span><strong>{rule.text.split(':')[0]}</strong>{`:${rule.text.split(':').slice(1).join(':')}`}</span><button type="button" role="switch" aria-checked={hardEnabled[rule.key] ?? true} className={hardEnabled[rule.key] ? 'is-on' : ''} disabled={!onSaveRules} onClick={() => toggleHard(rule.key)}><i /></button></div>)}</div>
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

export function RequestsPanel({ kind, unit }: { kind: 'swaps' | 'absences' | 'preassignments'; unit: ShiftPlanningUnit }) {
  const [date, setDate] = useState('2026-09-01')
  const [absenceType, setAbsenceType] = useState('Ferie')
  const [affectedShift, setAffectedShift] = useState('Giornata intera')
  const [preCode, setPreCode] = useState('')
  const people = unit.people

  if (kind === 'swaps') return <section className="shift-original-panel">
    <h2>Richiedi cambio turno</h2>
    <p>Scegli un giorno e vedi subito il tuo turno e quello di ogni collega quel giorno, per proporre uno scambio in base al turno che ti serve. Resta soggetto a conferma del collega e, a mese Definitivo, dell'admin.</p>
    <div className="shift-form-label">Giorno</div>
    <p className="shift-form-help">Scegli la data: sotto vedi subito il tuo turno e quello di ogni collega quel giorno, per scegliere in base al turno che ti serve.</p>
    <div className="shift-swap-date-row"><ShiftDatePicker ariaLabel="Giorno del cambio turno" value={date} onChange={setDate} /><span>Non hai ancora un turno assegnato in questa data<br /><small>Il giorno prima: —</small></span></div>
    <div className="shift-form-label shift-section-label">Con chi vuoi scambiare</div>
    <div className="shift-swap-list">{people.map((person) => <button type="button" className="shift-swap-person" key={person.id}>
      <span className="shift-avatar">{person.initials}</span><strong>{person.name}</strong><span>ieri: —</span><span>nessun turno</span><span>✓ 0 · × 0</span>
    </button>)}</div>
    <button className="shift-original-primary" type="button" disabled>Invia richiesta</button>
    <div className="shift-inline-warning">Non è possibile scambiare un turno che non esiste ancora. Il tuo giorno non ha ancora un turno assegnato: serve prima una pre-assegnazione.</div>
    <h3 className="shift-original-subtitle">Richieste</h3>
    <p className="shift-empty-copy">Nessuna richiesta.</p>
  </section>

  if (kind === 'absences') return <section className="shift-original-panel">
    <h2>Ferie e permessi</h2>
    <p>Richiedi ferie o un permesso su un giorno specifico, anche di un mese diverso da quello visualizzato nel calendario. Resta soggetto a conferma dell'admin (Direttore o FOM).</p>
    <div className="shift-inline-form shift-absence-form">
      <label><span>Giorno</span><ShiftDatePicker ariaLabel="Giorno ferie o permesso" value={date} onChange={setDate} /></label>
      <label><span>Tipo</span><ShiftSelect ariaLabel="Tipo richiesta" value={absenceType} onChange={setAbsenceType} options={[{ value: "Ferie", label: "Ferie" }, { value: "Permesso", label: "Permesso" }, { value: "R.O.L.", label: "R.O.L." }, { value: "Malattia", label: "Malattia" }]} /></label>
      <label><span>Turno interessato</span><ShiftSelect ariaLabel="Turno interessato" value={affectedShift} onChange={setAffectedShift} options={[{ value: "Giornata intera", label: "Giornata intera" }, ...unit.codes.map((code) => ({ value: code.code, label: `${code.code} · ${code.label}`, shortLabel: code.code, color: code.color, textColor: code.textColor }))]} /></label>
    </div>
    <div className="shift-note-submit"><label><span>Nota (facoltativa)</span><input placeholder="es. visita medica" /></label><button className="shift-original-primary" type="button">Invia richiesta</button></div>
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
      <label className="shift-grow"><span>Nota (facoltativa)</span><input placeholder="es. preferirei chiudere quel giorno" /></label>
      <button className="shift-original-primary" type="button" disabled={!preCode}>Invia richiesta</button>
    </div>
    <p className="shift-form-help">Puoi scegliere solo tra i turni ammessi per il tuo ruolo. La richiesta resta in sospeso finché l'admin non la conferma; una volta accettata, il turno si blocca automaticamente.</p>
    <h3 className="shift-original-subtitle">Le mie richieste</h3>
    <p className="shift-empty-copy">Nessuna richiesta.</p>
  </section>
}

export function PersonalPanel({ unit }: { unit: ShiftPlanningUnit }) {
  const preferredCodes = unit.codes.filter((code) => code.time && code.code !== 'N').slice(0, 5)
  const [order, setOrder] = useState(() => preferredCodes.map((code) => code.code))
  const [dayPreferences, setDayPreferences] = useState<Record<string, string[]>>({})
  const days = ['Lun', 'Mar', 'Mer', 'Gio', 'Ven', 'Sab', 'Dom']
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
    <div className="shift-weekday-preferences">{days.map((day) => <div key={day}><strong>{day}</strong><span>{order.map((code) => {
      const def = codeMap.get(code)
      const selected = (dayPreferences[day] ?? []).includes(code)
      return <button type="button" key={code} aria-pressed={selected} className={selected ? 'is-selected' : undefined} style={selected ? { background: def?.color, color: def?.textColor ?? '#fff' } : undefined} onClick={() => toggleDayPreference(day, code)}>{code}</button>
    })}</span></div>)}</div>
  </section>
}

const MONTHS = ['Gennaio', 'Febbraio', 'Marzo', 'Aprile', 'Maggio', 'Giugno', 'Luglio', 'Agosto', 'Settembre', 'Ottobre', 'Novembre', 'Dicembre']
const WEEKDAYS = ['Lun', 'Mar', 'Mer', 'Gio', 'Ven', 'Sab', 'Dom']

function assignmentForDay(unit: ShiftPlanningUnit, personId: string, day: number) {
  const pattern = unit.assignments[personId] ?? []
  return pattern.length ? pattern[(day - 1) % pattern.length] : undefined
}

function buildYearEvents(unit: ShiftPlanningUnit, personId: string, year: number): ShiftCalendarEvent[] {
  const events: ShiftCalendarEvent[] = []
  for (let month = 1; month <= 12; month += 1) {
    const days = new Date(year, month, 0).getDate()
    for (let day = 1; day <= days; day += 1) {
      const code = assignmentForDay(unit, personId, day)
      if (code) events.push({ year, month, day, code })
    }
  }
  return events
}

export function MyShiftsPanel({ unit }: { unit: ShiftPlanningUnit }) {
  const person = unit.people[0]
  const [visibleDate, setVisibleDate] = useState(() => new Date(2026, 8, 1))
  const year = visibleDate.getFullYear()
  const month = visibleDate.getMonth()
  const codeMap = useMemo(() => new Map(unit.codes.map((code) => [code.code, code])), [unit.codes])
  const firstWeekday = (new Date(year, month, 1).getDay() + 6) % 7
  const daysInMonth = new Date(year, month + 1, 0).getDate()
  const previousMonthDays = new Date(year, month, 0).getDate()
  const cells = Array.from({ length: 42 }, (_, index) => {
    const relativeDay = index - firstWeekday + 1
    if (relativeDay < 1) return { day: previousMonthDays + relativeDay, inMonth: false }
    if (relativeDay > daysInMonth) return { day: relativeDay - daysInMonth, inMonth: false }
    return { day: relativeDay, inMonth: true }
  })
  const todayCode = assignmentForDay(unit, person?.id ?? '', 18)
  const tomorrowCode = assignmentForDay(unit, person?.id ?? '', 19)

  function describe(code: string | undefined) {
    const definition = code ? codeMap.get(code) : undefined
    return definition ? `${definition.code} · ${definition.label}${definition.time ? ` · ${definition.time}` : ''}` : 'Nessun turno assegnato'
  }

  function exportCalendar() {
    if (!person) return
    const content = generateShiftCalendarIcs(person.id, unit.codes, buildYearEvents(unit, person.id, year))
    downloadShiftCalendar(`turni-${person.id}-${year}.ics`, content)
  }

  if (!person) return <section className="shift-panel"><p>Nessun dipendente disponibile per questa unità.</p></section>

  return <div className="shift-my-shifts">
    <section className="shift-today-summary" aria-label="Turni imminenti">
      <article><span>Il mio turno oggi</span><strong>{describe(todayCode)}</strong></article>
      <article><span>Il mio turno domani</span><strong>{describe(tomorrowCode)}</strong></article>
    </section>
    <section className="shift-panel shift-my-calendar">
      <div className="shift-my-calendar-header">
        <div><h2>I miei turni</h2><p>{person.name} · {person.assignmentProfile}</p></div>
        <div className="shift-my-period"><button type="button" aria-label="Mese precedente" onClick={() => setVisibleDate((date) => new Date(date.getFullYear(), date.getMonth() - 1, 1))}><ChevronLeft size={17} /></button><strong>{MONTHS[month]} {year}</strong><button type="button" aria-label="Mese successivo" onClick={() => setVisibleDate((date) => new Date(date.getFullYear(), date.getMonth() + 1, 1))}><ChevronRight size={17} /></button></div>
        <button className="shift-export-button" type="button" onClick={exportCalendar}><Download size={16} />Esporta calendario ({year})</button>
      </div>
      <div className="shift-my-calendar-scroll" tabIndex={0} aria-label={`Calendario personale di ${MONTHS[month]} ${year}`}>
        <div className="shift-my-calendar-grid">
          {WEEKDAYS.map((weekday) => <div className="shift-my-weekday" key={weekday}>{weekday}</div>)}
          {cells.map((cell, index) => {
            const code = cell.inMonth ? assignmentForDay(unit, person.id, cell.day) : undefined
            const definition = code ? codeMap.get(code) : undefined
            const isToday = cell.inMonth && year === 2026 && month === 8 && cell.day === 18
            return <div className={`shift-my-day${cell.inMonth ? '' : ' is-outside'}${isToday ? ' is-today' : ''}`} key={`${index}-${cell.day}`}><span>{cell.day}</span>{definition ? <strong style={{ background: definition.color, color: definition.textColor ?? '#fff' }}>{definition.code}<small>{definition.time}</small></strong> : null}</div>
          })}
        </div>
      </div>
      <div className="shift-legend">{unit.codes.map((code) => <span key={code.code}><strong style={{ background: code.color, color: code.textColor ?? '#fff' }}>{code.code}</strong>{code.label}{code.time ? ` (${code.time})` : ''}</span>)}</div>
    </section>
  </div>
}
