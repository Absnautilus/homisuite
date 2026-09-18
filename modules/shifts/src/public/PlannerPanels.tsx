import { useMemo, useState } from 'react'
import { ArrowRightLeft, CalendarCheck, ChevronLeft, ChevronRight, Download, GripVertical, Palmtree, SlidersHorizontal } from 'lucide-react'
import type { ShiftPlanningUnit, ShiftPreviewProperty } from '../preview/fixtures'
import { downloadShiftCalendar, generateShiftCalendarIcs, type ShiftCalendarEvent } from '../domain/icsExport'

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
                <td><select aria-label={`Unità di ${person.name}`} value={draft.unitId} onChange={(event) => update(person.id, { unitId: event.target.value })}>{property.units.map((unit) => <option value={unit.id} key={unit.id}>{unit.name}</option>)}</select></td>
                <td><select aria-label={`Tipo turno di ${person.name}`} value={draft.assignmentProfile} onChange={(event) => update(person.id, { assignmentProfile: event.target.value })}><option>Diurno</option><option>Turnante</option><option>Notturno</option><option>Direttore</option><option>FOM</option></select></td>
                <td><select aria-label={`Riposo di ${person.name}`} value={draft.restMode} onChange={(event) => update(person.id, { restMode: event.target.value as PersonDraft['restMode'] })}><option value="rotating">Rotante</option><option value="fixed">Fisso</option></select></td>
                <td><select aria-label={`Giorni fissi di ${person.name}`} value={draft.restDays} disabled={draft.restMode !== 'fixed'} onChange={(event) => update(person.id, { restDays: event.target.value })}><option value="">—</option><option>Sab + Dom</option><option>Dom + Lun</option><option>Lun + Mar</option></select></td>
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

const SAMPLE_REQUESTS = {
  swaps: [{ title: 'Ana Beatrice ↔ Hamza', detail: '22 ottobre · A1 scambiato con C2', status: 'Da approvare' }],
  absences: [{ title: 'Ferie · Giulia', detail: '26–28 ottobre · 3 giorni', status: 'Approvata' }, { title: 'Permesso · Luca', detail: '21 ottobre · 4 ore', status: 'Da approvare' }],
  preassignments: [{ title: 'Farouk · N', detail: '24 ottobre · turno bloccato', status: 'Attiva' }],
}

export function RequestsPanel({ kind }: { kind: keyof typeof SAMPLE_REQUESTS }) {
  const meta = kind === 'swaps'
    ? { title: 'Cambi turno', subtitle: 'Richieste di scambio tra colleghi.', icon: ArrowRightLeft }
    : kind === 'absences'
      ? { title: 'Ferie / Permessi', subtitle: 'Richieste e saldo personale.', icon: Palmtree }
      : { title: 'Pre-assegnazioni', subtitle: 'Turni e riposi da proteggere prima della generazione.', icon: CalendarCheck }
  return <section className="shift-panel"><div className="shift-panel-title"><div><h2>{meta.title}</h2><p>{meta.subtitle}</p></div><meta.icon size={20} /></div><div className="shift-request-list">{SAMPLE_REQUESTS[kind].map((item) => <article key={item.title}><span><strong>{item.title}</strong><small>{item.detail}</small></span><span className="shift-status-chip">{item.status}</span></article>)}</div></section>
}

export function PersonalPanel() {
  return <section className="shift-panel"><div className="shift-panel-title"><div><h2>Le mie preferenze</h2><p>Preferenze usate dall’assegnazione automatica quando i vincoli lo consentono.</p></div><SlidersHorizontal size={20} /></div><div className="shift-personal-preview"><article><strong>Preferenza fascia</strong><span>Mattina · priorità alta</span></article><article><strong>Giorno preferito</strong><span>Domenica</span></article></div></section>
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
