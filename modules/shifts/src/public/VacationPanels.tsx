import { useMemo, useState } from 'react'
import { Check, X } from 'lucide-react'
import type { ShiftPreviewProperty, ShiftPerson } from '../preview/fixtures'
import {
  countVacationDays, findVacationOverlap, validateVacationRequest, displayVacationStatus,
  type VacationPeriod, type VacationSettings, type VacationDisplayStatus,
} from '../domain/vacationPeriods'
import { ShiftDatePicker } from './ShiftDatePicker'

const STATUS_LABEL: Record<VacationDisplayStatus, string> = { taken: 'Presa', confirmed: 'Confermata', pending: 'In attesa', missing: 'Da pianificare' }
const MONTH_LONG = ['gennaio', 'febbraio', 'marzo', 'aprile', 'maggio', 'giugno', 'luglio', 'agosto', 'settembre', 'ottobre', 'novembre', 'dicembre']

function todayIso(): string { return new Date().toISOString().slice(0, 10) }
function fmtShort(iso: string): string { const [, m, d] = iso.split('-'); return `${d}/${m}` }
function fmtLong(iso: string): string { const [, m, d] = iso.split('-'); return `${Number(d)} ${MONTH_LONG[Number(m) - 1]}` }
function initialsOf(name: string): string { return name.split(' ').map((part) => part[0]).slice(0, 2).join('').toUpperCase() }

export function rosterOf(property: ShiftPreviewProperty): ShiftPerson[] {
  const seen = new Map<string, ShiftPerson>()
  for (const unit of property.units) {
    if (unit.status === 'inactive') continue
    for (const person of unit.people) if (!seen.has(person.id)) seen.set(person.id, person)
  }
  return [...seen.values()]
}

function periodsByPerson(periods: VacationPeriod[], staffProfileId: string, periodsPerYear: number): Array<VacationPeriod | null> {
  const slots: Array<VacationPeriod | null> = Array.from({ length: periodsPerYear }, () => null)
  for (const period of periods) {
    if (period.staffProfileId !== staffProfileId) continue
    if (period.periodIndex >= 0 && period.periodIndex < periodsPerYear) slots[period.periodIndex] = period
  }
  return slots
}

/**
 * Team-wide "Piano Ferie" view: one row per person, grouped by status --
 * replaces an earlier month-timeline + per-period-index table that only
 * worked at desktop width (both required horizontal scrolling on a phone,
 * and the table's summary chips at the bottom just repeated the same "da
 * pianificare" count already visible in each row). A plain vertical list
 * needs no horizontal scroll at any width.
 */
function VacationPeopleList({ people, periods, settings }: { people: ShiftPerson[]; periods: VacationPeriod[]; settings: VacationSettings }) {
  const today = todayIso()
  return <div className="shift-vacation-people-list">
    {people.map((person) => {
      const slots = periodsByPerson(periods, person.id, settings.periodsPerYear)
      const taken: VacationPeriod[] = []
      const confirmed: VacationPeriod[] = []
      const pending: VacationPeriod[] = []
      const missingIndexes: number[] = []
      slots.forEach((period, index) => {
        if (!period) { missingIndexes.push(index); return }
        const status = displayVacationStatus(period, today)
        if (status === 'taken') taken.push(period)
        else if (status === 'confirmed') confirmed.push(period)
        else if (status === 'pending') pending.push(period)
      })
      return <div className="shift-vacation-person-card" key={person.id}>
        <div className="shift-vacation-person">
          <span className="shift-avatar">{person.initials || initialsOf(person.name)}</span>
          <span className="shift-vacation-person-copy"><strong>{person.name}</strong><small>{person.jobTitle}</small></span>
        </div>
        <div className="shift-vacation-person-groups">
          {taken.length > 0 ? <div className="shift-vacation-group">
            <span className="shift-vacation-group-label">Ferie godute</span>
            <div className="shift-vacation-group-pills">{taken.map((period) => <span key={period.id} className="shift-vacation-pill is-taken">{fmtLong(period.start)} – {fmtLong(period.end)}</span>)}</div>
          </div> : null}
          {confirmed.length > 0 ? <div className="shift-vacation-group">
            <span className="shift-vacation-group-label">Confermate</span>
            <div className="shift-vacation-group-pills">{confirmed.map((period) => <span key={period.id} className="shift-vacation-pill is-confirmed">{fmtLong(period.start)} – {fmtLong(period.end)}</span>)}</div>
          </div> : null}
          {pending.length > 0 ? <div className="shift-vacation-group">
            <span className="shift-vacation-group-label">In attesa di conferma</span>
            <div className="shift-vacation-group-pills">{pending.map((period) => <span key={period.id} className="shift-vacation-pill is-pending">{fmtLong(period.start)} – {fmtLong(period.end)}</span>)}</div>
          </div> : null}
          {missingIndexes.length > 0 ? <div className="shift-vacation-group">
            <span className="shift-vacation-group-label">Da selezionare</span>
            <div className="shift-vacation-group-pills">{missingIndexes.map((index) => <span key={index} className="shift-vacation-pill is-missing">Periodo {index + 1}</span>)}</div>
          </div> : null}
        </div>
        <div className="shift-vacation-person-remaining">
          {missingIndexes.length > 0
            ? <span>{missingIndexes.length} {missingIndexes.length === 1 ? 'periodo rimanente' : 'periodi rimanenti'} da pianificare</span>
            : <span className="is-complete">Tutti i periodi pianificati</span>}
        </div>
      </div>
    })}
  </div>
}

export interface VacationRequestInput { staffProfileId: string; periodIndex: number; start: string; end: string }

function MyVacationPanel({ property, periods, settings, currentStaffProfileId, onRequestPeriod }: {
  property: ShiftPreviewProperty
  periods: VacationPeriod[]
  settings: VacationSettings
  currentStaffProfileId?: string
  onRequestPeriod?: (input: VacationRequestInput) => Promise<void>
}) {
  const roster = useMemo(() => rosterOf(property), [property])
  const me = roster.find((person) => person.id === currentStaffProfileId)
  const [panelOpenFor, setPanelOpenFor] = useState<number | null>(null)
  const [start, setStart] = useState(() => todayIso())
  const [end, setEnd] = useState(() => todayIso())
  const [result, setResult] = useState<{ kind: 'ok' | 'conflict'; message: string } | null>(null)
  const [saving, setSaving] = useState(false)

  if (!me) return <div className="shift-empty">Il tuo profilo non è ancora collegato a Turni.</div>

  const slots = periodsByPerson(periods, me.id, settings.periodsPerYear)

  function openFor(index: number) {
    setPanelOpenFor(index)
    setResult(null)
    setStart(todayIso())
    setEnd(todayIso())
  }

  async function submit() {
    if (panelOpenFor == null || !onRequestPeriod || !me) return
    const validationError = validateVacationRequest({ start, end, periodIndex: panelOpenFor }, settings)
    if (validationError === 'invalid_date_range') { setResult({ kind: 'conflict', message: 'Seleziona un intervallo di date valido.' }); return }
    if (validationError === 'duration_out_of_range') {
      const days = countVacationDays(start, end)
      setResult({ kind: 'conflict', message: `Il periodo dura ${days} giorni: il responsabile ha impostato un minimo di ${settings.minDays} e un massimo di ${settings.maxDays}.` })
      return
    }
    const conflict = findVacationOverlap(periods, me.id, start, end)
    if (conflict) {
      const name = roster.find((person) => person.id === conflict.staffProfileId)?.name ?? 'un altro dipendente'
      setResult({ kind: 'conflict', message: `Si sovrappone a: ${name} (${fmtShort(conflict.start)}–${fmtShort(conflict.end)}). Scegli un'altra settimana prima di inviare la richiesta.` })
      return
    }
    setSaving(true)
    try {
      await onRequestPeriod({ staffProfileId: me.id, periodIndex: panelOpenFor, start, end })
      setResult({ kind: 'ok', message: 'Nessuna sovrapposizione. Richiesta inviata al responsabile per l\'approvazione (stato: in attesa).' })
    } catch {
      setResult({ kind: 'conflict', message: 'Impossibile inviare la richiesta. Riprova.' })
    } finally {
      setSaving(false)
    }
  }

  return <div className="shift-vacation-mine">
    <div className="shift-vacation-cards">
      {slots.map((period, index) => {
        const status = period ? displayVacationStatus(period, todayIso()) : 'missing'
        return <div className={`shift-vacation-card${status === 'missing' ? ' is-missing' : ''}`} key={index}>
          <span className="shift-vacation-card-label">Periodo {index + 1}</span>
          <span className="shift-vacation-card-dates">{period ? `${fmtLong(period.start)} – ${fmtLong(period.end)}` : 'Da pianificare'}</span>
          {period ? <span className={`shift-vacation-pill is-${status}`}>{STATUS_LABEL[status]}</span> : null}
          {status === 'missing' && onRequestPeriod ? <button type="button" className="shift-code-form-cancel" onClick={() => openFor(index)}>Richiedi questo periodo</button> : null}
        </div>
      })}
    </div>

    {panelOpenFor != null ? <div className="shift-vacation-request-panel">
      <div className="shift-panel-title">
        <div><h2>Richiedi un periodo</h2><p>Scegli le date: controlliamo durata e sovrapposizioni prima di inviare la richiesta al responsabile.</p></div>
        <button type="button" className="shift-code-form-cancel" onClick={() => setPanelOpenFor(null)}>Chiudi</button>
      </div>
      <div className="shift-vacation-request-form">
        <label className="shift-field"><span>Dal</span><ShiftDatePicker value={start} onChange={setStart} ariaLabel="Data di inizio periodo" /></label>
        <label className="shift-field"><span>Al</span><ShiftDatePicker value={end} onChange={setEnd} ariaLabel="Data di fine periodo" /></label>
        <button type="button" className="shift-original-primary" disabled={saving} onClick={() => void submit()}>{saving ? 'Invio…' : 'Controlla e invia'}</button>
      </div>
      <p className="shift-form-help">Il periodo deve durare tra {settings.minDays} e {settings.maxDays} giorni (impostato dal responsabile).</p>
      {result ? <div className={`shift-vacation-result is-${result.kind}`} role={result.kind === 'conflict' ? 'alert' : 'status'}>{result.message}</div> : null}
    </div> : null}
  </div>
}

function VacationApprovalsPanel({ property, periods, settings, onDecidePeriod, onSaveSettings }: {
  property: ShiftPreviewProperty
  periods: VacationPeriod[]
  settings: VacationSettings
  onDecidePeriod?: (periodId: string, approve: boolean) => Promise<void>
  onSaveSettings?: (next: VacationSettings) => Promise<void>
}) {
  const roster = useMemo(() => rosterOf(property), [property])
  const [resolvingId, setResolvingId] = useState<string | null>(null)
  const [form, setForm] = useState(settings)
  const [savingSettings, setSavingSettings] = useState(false)
  const pending = periods.filter((period) => period.status === 'pending' && period.id)

  async function decide(periodId: string, approve: boolean) {
    if (!onDecidePeriod) return
    setResolvingId(periodId)
    try { await onDecidePeriod(periodId, approve) } finally { setResolvingId(null) }
  }

  async function saveSettings() {
    if (!onSaveSettings) return
    setSavingSettings(true)
    try { await onSaveSettings(form) } finally { setSavingSettings(false) }
  }

  return <div className="shift-vacation-approvals">
    <div className="shift-panel-title"><div><h2>Richieste in sospeso</h2><p>Le richieste di periodo in attesa di approvazione, da tutto il team.</p></div></div>
    {pending.length === 0 ? <p className="shift-form-help">Nessuna richiesta in sospeso al momento.</p> : <div className="shift-vacation-pending-list">
      {pending.map((period) => {
        const person = roster.find((candidate) => candidate.id === period.staffProfileId)
        return <div className={`shift-vacation-pending-row${resolvingId === period.id ? ' is-resolving' : ''}`} key={period.id}>
          <div className="shift-vacation-pending-info">
            <span className="shift-avatar">{person ? (person.initials || initialsOf(person.name)) : '—'}</span>
            <span className="shift-vacation-person-copy"><strong>{person?.name ?? 'Dipendente'}</strong><small>{fmtLong(period.start)} – {fmtLong(period.end)} · {countVacationDays(period.start, period.end)} giorni</small></span>
          </div>
          <div className="shift-vacation-pending-actions">
            <button type="button" className="shift-vacation-icon-btn is-reject" aria-label={`Rifiuta la richiesta di ${person?.name ?? 'dipendente'}`} disabled={resolvingId === period.id} onClick={() => void decide(period.id!, false)}><X size={15} /></button>
            <button type="button" className="shift-vacation-icon-btn is-approve" aria-label={`Approva la richiesta di ${person?.name ?? 'dipendente'}`} disabled={resolvingId === period.id} onClick={() => void decide(period.id!, true)}><Check size={18} /></button>
          </div>
        </div>
      })}
    </div>}

    <div className="shift-panel-title"><div><h2>Impostazioni piano ferie</h2><p>Quanti periodi può pianificare ogni dipendente e quanto può durare ciascuno.</p></div></div>
    <div className="shift-vacation-settings-form">
      <label className="shift-field"><span>Periodi per dipendente all'anno</span><input type="number" min={1} max={6} value={form.periodsPerYear} onChange={(event) => setForm({ ...form, periodsPerYear: Number(event.target.value) })} /></label>
      <label className="shift-field"><span>Durata minima (giorni)</span><input type="number" min={1} value={form.minDays} onChange={(event) => setForm({ ...form, minDays: Number(event.target.value) })} /></label>
      <label className="shift-field"><span>Durata massima (giorni)</span><input type="number" min={form.minDays} value={form.maxDays} onChange={(event) => setForm({ ...form, maxDays: Number(event.target.value) })} /></label>
      <button type="button" className="shift-original-primary" disabled={savingSettings} onClick={() => void saveSettings()}>{savingSettings ? 'Salvataggio…' : 'Salva impostazioni'}</button>
    </div>
  </div>
}

export interface VacationPlannerProps {
  property: ShiftPreviewProperty
  periods: VacationPeriod[]
  settings: VacationSettings
  currentStaffProfileId?: string
  canManage: boolean
  onRequestPeriod?: (input: VacationRequestInput) => Promise<void>
  onDecidePeriod?: (periodId: string, approve: boolean) => Promise<void>
  onSaveSettings?: (settings: VacationSettings) => Promise<void>
}

/**
 * "Piano Ferie": everyone with shifts.view sees the shared timeline and
 * recap (not manager-gated, unlike most of Turni's settings -- the point is
 * that staff see each other's periods before requesting their own); "Le mie
 * ferie" is the self-service request flow; "Approvazioni" (manager-only) is
 * where pending requests get decided and the per-property rules are set.
 */
export function VacationPlanner({ property, periods, settings, currentStaffProfileId, canManage, onRequestPeriod, onDecidePeriod, onSaveSettings }: VacationPlannerProps) {
  const [tab, setTab] = useState<'team' | 'mine' | 'admin'>('team')
  const roster = useMemo(() => rosterOf(property), [property])
  const pendingCount = periods.filter((period) => period.status === 'pending').length

  const tabs: Array<{ id: typeof tab; label: string }> = [
    { id: 'team', label: 'Piano Ferie' },
    { id: 'mine', label: 'Le mie ferie' },
  ]
  if (canManage) tabs.push({ id: 'admin', label: 'Approvazioni' })

  return <div className="shift-vacation-root">
    <div className="shift-vacation-tabbar" role="tablist">
      {tabs.map((item) => (
        <button key={item.id} type="button" role="tab" aria-selected={tab === item.id} className={tab === item.id ? 'is-active' : undefined} onClick={() => setTab(item.id)}>
          {item.label}{item.id === 'admin' && pendingCount > 0 ? <span className="shift-vacation-tab-badge">{pendingCount}</span> : null}
        </button>
      ))}
    </div>
    <div className="shift-vacation-legend">
      <span><i className="is-taken" />Presa</span>
      <span><i className="is-confirmed" />Confermata</span>
      <span><i className="is-pending" />In attesa</span>
      <span><i className="is-missing" />Da pianificare</span>
    </div>

    {tab === 'team' ? <div className="shift-vacation-pane">
      <VacationPeopleList people={roster} periods={periods} settings={settings} />
    </div> : null}
    {tab === 'mine' ? <div className="shift-vacation-pane">
      <MyVacationPanel property={property} periods={periods} settings={settings} currentStaffProfileId={currentStaffProfileId} onRequestPeriod={onRequestPeriod} />
    </div> : null}
    {tab === 'admin' && canManage ? <div className="shift-vacation-pane">
      <VacationApprovalsPanel property={property} periods={periods} settings={settings} onDecidePeriod={onDecidePeriod} onSaveSettings={onSaveSettings} />
    </div> : null}
  </div>
}
