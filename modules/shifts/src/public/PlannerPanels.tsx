import { useMemo, useState } from 'react'
import { ChevronLeft, ChevronRight, Download, GripVertical } from 'lucide-react'
import type { ShiftPlanningUnit, ShiftPreviewProperty } from '../preview/fixtures'
import { downloadShiftCalendar, generateShiftCalendarIcs, type ShiftCalendarEvent } from '../domain/icsExport'
import { ShiftSelect } from './ShiftSelect'

type PersonDraft = {
  unitId: string
  assignmentProfile: string
  restMode: 'fixed' | 'rotating'
  restDays: string
}

export function EmployeesPanel({ property }: { property: ShiftPreviewProperty }) {
  const roster = useMemo(() => {
    const people = new Map<string, { person: ShiftPlanningUnit['people'][number]; unitId: string }>()
    for (const unit of property.units) {
      for (const person of unit.people) if (!people.has(person.id)) people.set(person.id, { person, unitId: unit.id })
    }
    return [...people.values()]
  }, [property])
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

  return (
    <section className="shift-panel shift-employees-panel">
      <div className="shift-panel-title">
        <div><h2>Dipendenti</h2><p>La lista arriva da Team. Qui assegni soltanto unità e parametri di pianificazione.</p></div>
        <span className="shift-status-chip">{roster.length} persone</span>
      </div>
      <div className="shift-table-scroll" tabIndex={0} aria-label="Configurazione dipendenti per Turni">
        <table className="shift-employees-table">
          <thead><tr><th>Dipendente</th><th>Unità</th><th>Tipo turno</th><th>Riposo</th><th>Giorni fissi</th><th>Origine</th></tr></thead>
          <tbody>{roster.map(({ person, unitId }) => {
            const draft = drafts[person.id] ?? { unitId, assignmentProfile: person.assignmentProfile, restMode: person.restMode, restDays: person.restDays ?? '' }
            return (
              <tr key={person.id}>
                <th scope="row"><GripVertical size={15} aria-hidden="true" /><span className="shift-avatar">{person.initials}</span><span><strong>{person.name}</strong><small>{person.jobTitle}</small></span></th>
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
      <p className="shift-panel-note">Queste modifiche restano locali nella preview. Creazione account, ruolo Homisuite e mansione lavorativa continuano a essere gestiti da Team.</p>
    </section>
  )
}

export function RulesPanel({ unit }: { unit: ShiftPlanningUnit }) {
  const [enabledRules, setEnabledRules] = useState(() => new Set(unit.rules.hard))
  function toggle(rule: string) {
    setEnabledRules((current) => {
      const next = new Set(current)
      if (next.has(rule)) next.delete(rule); else next.add(rule)
      return next
    })
  }
  return (
    <div className="shift-rules-layout">
      <section className="shift-panel">
        <div className="shift-panel-title"><div><h2>Regole di copertura giornaliera</h2><p>{unit.name} · {unit.ruleSetName}</p></div><span className="shift-status-chip">v{unit.ruleSetVersion}</span></div>
        <div className="shift-coverage-editor">{unit.rules.coverage.map((coverage) => <article key={coverage}><strong>{coverage.split(' × ')[1]}</strong><span><button type="button" aria-label={`Diminuisci ${coverage}`}>−</button><b>{coverage.split(' × ')[0]}</b><button type="button" aria-label={`Aumenta ${coverage}`}>+</button></span></article>)}</div>
      </section>
      <section className="shift-panel">
        <div className="shift-panel-title"><div><h2>Regole assolute</h2><p>Vincoli rigidi configurati soltanto per l’unità {unit.name}.</p></div></div>
        <div className="shift-rule-switches">{unit.rules.hard.map((rule) => <div key={rule}><span><strong>{rule.split(':')[0]}</strong>{rule.includes(':') ? `:${rule.split(':').slice(1).join(':')}` : ''}</span><button type="button" role="switch" aria-checked={enabledRules.has(rule)} className={enabledRules.has(rule) ? 'is-on' : ''} onClick={() => toggle(rule)}><i /></button></div>)}</div>
      </section>
      <section className="shift-panel">
        <div className="shift-panel-title"><div><h2>Regole di preferenza</h2><p>Applicate in ordine, dopo i vincoli assoluti.</p></div></div>
        <ol className="shift-priority-list">{unit.rules.soft.map((rule, index) => <li key={rule}><span>{index + 1}</span>{rule}</li>)}</ol>
      </section>
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
    <div className="shift-swap-date-row"><input type="date" value={date} onChange={(event) => setDate(event.target.value)} /><span>Non hai ancora un turno assegnato in questa data<br /><small>Il giorno prima: —</small></span></div>
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
      <label><span>Giorno</span><input type="date" value={date} onChange={(event) => setDate(event.target.value)} /></label>
      <label><span>Tipo</span><select value={absenceType} onChange={(event) => setAbsenceType(event.target.value)}><option>Ferie</option><option>Permesso</option><option>R.O.L.</option><option>Malattia</option></select></label>
      <label><span>Turno interessato</span><select value={affectedShift} onChange={(event) => setAffectedShift(event.target.value)}><option>Giornata intera</option>{unit.codes.map((code) => <option key={code.code}>{code.code} · {code.label}</option>)}</select></label>
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
      <label><span>Giorno</span><input type="date" value={date} onChange={(event) => setDate(event.target.value)} /></label>
      <label><span>Turno</span><select value={preCode} onChange={(event) => setPreCode(event.target.value)}><option value="">Seleziona...</option>{unit.codes.map((code) => <option value={code.code} key={code.code}>{code.code} · {code.label}</option>)}</select></label>
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
  const days = ['Lun', 'Mar', 'Mer', 'Gio', 'Ven', 'Sab', 'Dom']
  function move(code: string, direction: -1 | 1) {
    setOrder((current) => {
      const index = current.indexOf(code)
      const target = index + direction
      if (index < 0 || target < 0 || target >= current.length) return current
      const next = [...current]
      ;[next[index], next[target]] = [next[target], next[index]]
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
    <div className="shift-weekday-preferences">{days.map((day) => <div key={day}><strong>{day}</strong><span>{order.map((code) => <button type="button" key={code}>{code}</button>)}</span></div>)}</div>
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
      <div className="shift-legend">{unit.codes.map((code) => <span key={code.code}><i style={{ background: code.color }} /><strong>{code.code}</strong>{code.label}{code.time ? ` (${code.time})` : ''}</span>)}</div>
    </section>
  </div>
}
