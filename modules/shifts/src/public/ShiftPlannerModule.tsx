import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { Check, ChevronDown, ChevronLeft, ChevronRight, Eye, ShieldCheck } from 'lucide-react'
import { shiftPreviewProperties, type ShiftPreviewProperty } from '../preview/fixtures'
import { EmployeesPanel, MyShiftsPanel, PersonalPanel, RequestsPanel, RulesPanel } from './PlannerPanels'
import { ScheduleGrid } from './ScheduleGrid'

export interface ShiftPlannerCapabilities { view: boolean; manage: boolean; manageRequests: boolean }
export interface ShiftAssignmentEdit { planningUnitId: string; staffProfileId: string; shiftDate: string; code: string }
export interface ShiftPlannerModuleProps { preview?: boolean; initialPropertyId?: string; capabilities?: ShiftPlannerCapabilities; previewProperties?: ShiftPreviewProperty[]; onSaveAssignments?: (changes: ShiftAssignmentEdit[]) => Promise<void> }
type ModuleTab = 'calendar' | 'mine' | 'employees' | 'rules' | 'preferences' | 'swaps' | 'absences' | 'preassignments'
type CalendarView = 'month' | 'week'

const DEFAULT_CAPABILITIES: ShiftPlannerCapabilities = { view: true, manage: true, manageRequests: true }
const TABS: Array<{ id: ModuleTab; label: string; managerOnly?: boolean }> = [
  { id: 'calendar', label: 'Calendario' }, { id: 'mine', label: 'I miei turni' },
  { id: 'employees', label: 'Dipendenti', managerOnly: true }, { id: 'rules', label: 'Regole turni', managerOnly: true },
  { id: 'preferences', label: 'Le mie preferenze' }, { id: 'swaps', label: 'Cambi turno' },
  { id: 'absences', label: 'Ferie / Permessi' }, { id: 'preassignments', label: 'Pre-assegnazioni' },
]

export function ShiftPlannerModule({ preview = false, initialPropertyId, capabilities = DEFAULT_CAPABILITIES, previewProperties = shiftPreviewProperties, onSaveAssignments }: ShiftPlannerModuleProps) {
  const initialProperty = previewProperties.find((property) => property.id === initialPropertyId) ?? previewProperties[0]
  const [propertyId, setPropertyId] = useState(initialProperty?.id ?? '')
  const [unitId, setUnitId] = useState(initialProperty?.units[0]?.id ?? '')
  const [tab, setTab] = useState<ModuleTab>('calendar')
  const [calendarView, setCalendarView] = useState<CalendarView>('month')
  const [periodOffset, setPeriodOffset] = useState(0)
  const [readOnlyDemo, setReadOnlyDemo] = useState(false)
  const [draftProperties, setDraftProperties] = useState(previewProperties)
  const [pendingChanges, setPendingChanges] = useState<ShiftAssignmentEdit[]>([])
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const [tabDirection, setTabDirection] = useState<1 | -1>(1)
  const [tabTransitionActive, setTabTransitionActive] = useState(false)
  const navButtonRefs = useRef<Partial<Record<ModuleTab, HTMLButtonElement>>>({})
  const navContainerRef = useRef<HTMLDivElement>(null)
  const [navHighlight, setNavHighlight] = useState({ left: 0, width: 0, ready: false })
  useEffect(() => { setDraftProperties(previewProperties); setPendingChanges([]); setSaveState('idle') }, [previewProperties])
  const property = useMemo(() => draftProperties.find((candidate) => candidate.id === propertyId) ?? draftProperties[0], [draftProperties, propertyId])
  const unit = property?.units.find((candidate) => candidate.id === unitId) ?? property?.units[0]
  const monthFinal = unit?.monthStatus === 'final'
  const readOnly = readOnlyDemo || !capabilities.manage || monthFinal
  const visibleTabs = TABS.filter((item) => !item.managerOnly || !readOnly)
  const periodLabel = calendarView === 'month'
    ? (['Agosto 2026', 'Settembre 2026', 'Ottobre 2026'][Math.max(0, Math.min(2, periodOffset + 1))] ?? 'Settembre 2026')
    : (['12–18 ottobre 2026', '19–25 ottobre 2026', '26 ottobre–1 novembre 2026'][Math.max(0, Math.min(2, periodOffset + 1))] ?? '19–25 ottobre 2026')

  useEffect(() => {
    const button = navButtonRefs.current[tab]
    const container = navContainerRef.current
    if (!button || !container) return
    const buttonRect = button.getBoundingClientRect()
    const containerRect = container.getBoundingClientRect()
    const left = buttonRect.left - containerRect.left + container.scrollLeft
    setNavHighlight({ left, width: buttonRect.width, ready: true })
    const target = Math.max(0, Math.min(container.scrollWidth - container.clientWidth, left - (container.clientWidth - buttonRect.width) / 2))
    container.scrollTo({ left: target, behavior: 'smooth' })
  }, [tab, readOnly, propertyId])

  useEffect(() => {
    if (!tabTransitionActive) return
    let secondFrame = 0
    const firstFrame = requestAnimationFrame(() => { secondFrame = requestAnimationFrame(() => setTabTransitionActive(false)) })
    return () => { cancelAnimationFrame(firstFrame); cancelAnimationFrame(secondFrame) }
  }, [tabTransitionActive, tab])

  function changeProperty(nextPropertyId: string) { const next = draftProperties.find((candidate) => candidate.id === nextPropertyId); setPropertyId(nextPropertyId); setUnitId(next?.units[0]?.id ?? ''); setTab('calendar') }
  function editAssignment(staffProfileId: string, date: string, code: string) {
    if (!unit || readOnly || preview) return
    const dateIndex = unit.assignmentDates?.indexOf(date) ?? -1
    if (dateIndex < 0) return
    setDraftProperties((current) => current.map((candidate) => candidate.id !== property?.id ? candidate : ({
      ...candidate,
      units: candidate.units.map((candidateUnit) => candidateUnit.id !== unit.id ? candidateUnit : ({
        ...candidateUnit,
        assignments: { ...candidateUnit.assignments, [staffProfileId]: (candidateUnit.assignments[staffProfileId] ?? []).map((value, index) => index === dateIndex ? code : value) },
      })),
    })))
    setPendingChanges((current) => [...current.filter((item) => !(item.planningUnitId === unit.id && item.staffProfileId === staffProfileId && item.shiftDate === date)), { planningUnitId: unit.id, staffProfileId, shiftDate: date, code }])
    setSaveState('idle')
  }
  async function saveAssignments() {
    if (!onSaveAssignments || pendingChanges.length === 0) return
    setSaveState('saving')
    try { await onSaveAssignments(pendingChanges); setPendingChanges([]); setSaveState('saved') }
    catch { setSaveState('error') }
  }
  function togglePreviewRole() { setReadOnlyDemo((current) => { const next = !current; if (next && (tab === 'employees' || tab === 'rules')) setTab('calendar'); return next }) }
  function changeTab(nextTab: ModuleTab) {
    if (nextTab === tab) return
    const currentIndex = visibleTabs.findIndex((item) => item.id === tab)
    const nextIndex = visibleTabs.findIndex((item) => item.id === nextTab)
    setTabDirection(nextIndex >= currentIndex ? 1 : -1)
    setTabTransitionActive(true)
    setTab(nextTab)
  }
  const sceneStyle = {
    '--shift-tab-offset': `${tabDirection * 36}px`,
  } as CSSProperties
  if (!capabilities.view || !property || !unit) return <div className="shift-root"><div className="shift-empty">Turni non è disponibile per questa struttura.</div></div>

  return <div className="shift-root">
    {preview ? <div className="shift-preview-banner" role="status"><Eye size={16} /><span><strong>Anteprima interattiva</strong> · dati fittizi, nessuna modifica viene salvata</span></div> : null}
    <header className="shift-header"><div><p className="shift-eyebrow">{property.name}</p><h1>Turni</h1><p>Il Planner originale, integrato con persone, mansioni e strutture Homisuite.</p></div><div className="shift-header-actions">
      {preview ? <ScenarioSelect properties={previewProperties} value={property.id} onChange={changeProperty} /> : null}
      {preview ? <button className="shift-view-toggle" type="button" onClick={togglePreviewRole}>{readOnly ? <Eye size={15} /> : <ShieldCheck size={15} />}Vista {readOnly ? 'dipendente' : 'responsabile'}</button> : null}
    </div></header>
    <nav className="shift-main-tabs" aria-label="Sezioni Turni"><div ref={navContainerRef} className="shift-main-tabs-scroll" role="tablist"><i className="shift-tab-highlight" aria-hidden="true" style={{ left: navHighlight.left, width: navHighlight.width, opacity: navHighlight.ready ? 1 : 0 }} /><div className="shift-main-tab-buttons">{visibleTabs.map((item) => <button ref={(element) => { if (element) navButtonRefs.current[item.id] = element }} type="button" role="tab" aria-selected={tab === item.id} className={tab === item.id ? 'is-active' : undefined} onClick={() => changeTab(item.id)} key={item.id}>{item.label}</button>)}</div></div></nav>
    <div className={`shift-tab-scene${tabTransitionActive ? ' is-entering' : ''}`} style={sceneStyle}>
      {tab === 'calendar' ? <><div className="shift-calendar-toolbar"><div className="shift-period-control"><button type="button" aria-label="Periodo precedente" onClick={() => setPeriodOffset((value) => Math.max(-1, value - 1))}><ChevronLeft size={17} /></button><strong>{periodLabel}</strong><button type="button" aria-label="Periodo successivo" onClick={() => setPeriodOffset((value) => Math.min(1, value + 1))}><ChevronRight size={17} /></button><span className={`shift-status-chip ${monthFinal ? 'is-final' : 'is-draft'}`}>{monthFinal ? 'Definitivo' : 'Bozza'}</span></div><div className="shift-calendar-actions"><div className="shift-view-segment" aria-label="Visualizzazione calendario"><button type="button" className={calendarView === 'month' ? 'is-active' : undefined} onClick={() => { setCalendarView('month'); setPeriodOffset(0) }}>Mese</button><button type="button" className={calendarView === 'week' ? 'is-active' : undefined} onClick={() => { setCalendarView('week'); setPeriodOffset(0) }}>Settimana</button></div>{!readOnly ? <><button type="button" disabled={preview}>Assegna automaticamente</button><button type="button" disabled={preview}>Imposta riposi</button><button type="button" disabled={preview}>Rendi definitivo</button><button className="is-primary" type="button" disabled={preview || pendingChanges.length === 0 || saveState === 'saving'} onClick={() => void saveAssignments()}>{saveState === 'saving' ? 'Salvataggio…' : 'Salva turni'}</button></> : null}</div></div><p className="shift-calendar-help">Lo stato Bozza/Definitivo riguarda solo {periodLabel.toLowerCase()}: ogni mese ha il proprio stato indipendente. “Assegna automaticamente” genera i turni solo per il mese visualizzato; gli altri mesi non vengono toccati. I turni bloccati restano fissi, mentre gli altri possono essere ricalcolati. Salva turni quando vuoi rendere permanenti le modifiche.</p><UnitSelector property={property} unitId={unit.id} onSelect={setUnitId} />{saveState === 'error' ? <div className="shift-empty" role="alert">Impossibile salvare le modifiche. Riprova.</div> : null}{saveState === 'saved' ? <div className="shift-empty" role="status">Turni salvati.</div> : null}<section className="shift-schedule-card"><ScheduleGrid unit={unit} view={calendarView} editable={!readOnly && !preview && !monthFinal} onAssignmentChange={editAssignment} /><div className="shift-legend">{unit.codes.map((code) => <span key={code.code}><strong style={{ background: code.color, color: code.textColor ?? '#fff' }}>{code.code}</strong>{code.label}{code.time ? ` (${code.time})` : ''}</span>)}</div></section></> : null}
      {tab === 'employees' ? <EmployeesPanel property={property} /> : null}
      {tab === 'rules' ? <><UnitSelector property={property} unitId={unit.id} onSelect={setUnitId} /><RulesPanel unit={unit} /></> : null}
      {tab === 'mine' ? <MyShiftsPanel unit={unit} /> : null}{tab === 'preferences' ? <PersonalPanel unit={unit} /> : null}
      {tab === 'swaps' ? <RequestsPanel kind="swaps" unit={unit} /> : null}{tab === 'absences' ? <RequestsPanel kind="absences" unit={unit} /> : null}{tab === 'preassignments' ? <RequestsPanel kind="preassignments" unit={unit} /> : null}
    </div>
  </div>
}

function ScenarioSelect({ properties, value, onChange }: { properties: ShiftPreviewProperty[]; value: string; onChange: (id: string) => void }) {
  const [open, setOpen] = useState(false)
  const [activeIndex, setActiveIndex] = useState(() => Math.max(0, properties.findIndex((property) => property.id === value)))
  const rootRef = useRef<HTMLDivElement>(null)
  const optionRefs = useRef<Array<HTMLButtonElement | null>>([])
  const selected = properties.find((property) => property.id === value) ?? properties[0]

  useEffect(() => {
    if (!open) return
    const selectedIndex = Math.max(0, properties.findIndex((property) => property.id === value))
    setActiveIndex(selectedIndex)
    optionRefs.current[selectedIndex]?.focus()
    function closeOnOutsideClick(event: PointerEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('pointerdown', closeOnOutsideClick)
    return () => document.removeEventListener('pointerdown', closeOnOutsideClick)
  }, [open, properties, value])

  function choose(propertyId: string) {
    onChange(propertyId)
    setOpen(false)
  }

  function moveFocus(nextIndex: number) {
    const normalized = (nextIndex + properties.length) % properties.length
    setActiveIndex(normalized)
    optionRefs.current[normalized]?.focus()
  }

  return <div className="shift-field shift-property-field" ref={rootRef}>
    <span id="shift-scenario-label">Scenario</span>
    <div className={`shift-scenario-select${open ? ' is-open' : ''}`}>
      <button className="shift-scenario-trigger" type="button" aria-labelledby="shift-scenario-label shift-scenario-value" aria-haspopup="listbox" aria-expanded={open} onClick={() => setOpen((current) => !current)} onKeyDown={(event) => {
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); setOpen(true) }
      }}><span id="shift-scenario-value">{selected?.name}</span><ChevronDown size={17} aria-hidden="true" /></button>
      {open ? <div className="shift-scenario-menu" role="listbox" aria-labelledby="shift-scenario-label">
        {properties.map((property, index) => <button ref={(element) => { optionRefs.current[index] = element }} type="button" role="option" aria-selected={property.id === value} className={property.id === value ? 'is-selected' : undefined} key={property.id} onClick={() => choose(property.id)} onMouseEnter={() => setActiveIndex(index)} onKeyDown={(event) => {
          if (event.key === 'ArrowDown') { event.preventDefault(); moveFocus(activeIndex + 1) }
          if (event.key === 'ArrowUp') { event.preventDefault(); moveFocus(activeIndex - 1) }
          if (event.key === 'Home') { event.preventDefault(); moveFocus(0) }
          if (event.key === 'End') { event.preventDefault(); moveFocus(properties.length - 1) }
          if (event.key === 'Escape') { event.preventDefault(); setOpen(false); rootRef.current?.querySelector<HTMLButtonElement>('.shift-scenario-trigger')?.focus() }
        }}><span>{property.name}</span>{property.id === value ? <Check size={16} aria-hidden="true" /> : null}</button>)}
      </div> : null}
    </div>
  </div>
}

function UnitSelector({ property, unitId, onSelect }: { property: ShiftPreviewProperty; unitId: string; onSelect: (id: string) => void }) {
  return <div className="shift-unit-selector" role="tablist" aria-label="Unità di pianificazione">{property.units.map((unit) => <button type="button" role="tab" aria-selected={unit.id === unitId} className={unit.id === unitId ? 'is-active' : undefined} onClick={() => onSelect(unit.id)} key={unit.id}>{unit.name}<span>{unit.people.length}</span></button>)}</div>
}
