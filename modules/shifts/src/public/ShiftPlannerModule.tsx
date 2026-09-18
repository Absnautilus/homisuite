import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { ChevronDown, ChevronLeft, ChevronRight, Eye, ShieldCheck } from 'lucide-react'
import { shiftPreviewProperties, type ShiftPreviewProperty } from '../preview/fixtures'
import { EmployeesPanel, PersonalPanel, RequestsPanel, RulesPanel } from './PlannerPanels'
import { ScheduleGrid } from './ScheduleGrid'

export interface ShiftPlannerCapabilities { view: boolean; manage: boolean; manageRequests: boolean }
export interface ShiftPlannerModuleProps { preview?: boolean; initialPropertyId?: string; capabilities?: ShiftPlannerCapabilities; previewProperties?: ShiftPreviewProperty[] }
type ModuleTab = 'calendar' | 'mine' | 'employees' | 'rules' | 'preferences' | 'swaps' | 'absences' | 'preassignments'
type CalendarView = 'month' | 'week'

const DEFAULT_CAPABILITIES: ShiftPlannerCapabilities = { view: true, manage: true, manageRequests: true }
const TABS: Array<{ id: ModuleTab; label: string; managerOnly?: boolean }> = [
  { id: 'calendar', label: 'Calendario' }, { id: 'mine', label: 'I miei turni' },
  { id: 'employees', label: 'Dipendenti', managerOnly: true }, { id: 'rules', label: 'Regole turni', managerOnly: true },
  { id: 'preferences', label: 'Le mie preferenze' }, { id: 'swaps', label: 'Cambi turno' },
  { id: 'absences', label: 'Ferie / Permessi' }, { id: 'preassignments', label: 'Pre-assegnazioni' },
]

export function ShiftPlannerModule({ preview = false, initialPropertyId, capabilities = DEFAULT_CAPABILITIES, previewProperties = shiftPreviewProperties }: ShiftPlannerModuleProps) {
  const initialProperty = previewProperties.find((property) => property.id === initialPropertyId) ?? previewProperties[0]
  const [propertyId, setPropertyId] = useState(initialProperty?.id ?? '')
  const [unitId, setUnitId] = useState(initialProperty?.units[0]?.id ?? '')
  const [tab, setTab] = useState<ModuleTab>('calendar')
  const [calendarView, setCalendarView] = useState<CalendarView>('month')
  const [periodOffset, setPeriodOffset] = useState(0)
  const [readOnlyDemo, setReadOnlyDemo] = useState(false)
  const [tabDirection, setTabDirection] = useState<1 | -1>(1)
  const [tabTransitionActive, setTabTransitionActive] = useState(false)
  const navButtonRefs = useRef<Partial<Record<ModuleTab, HTMLButtonElement>>>({})
  const navContainerRef = useRef<HTMLDivElement>(null)
  const [navHighlight, setNavHighlight] = useState({ left: 0, width: 0, ready: false })
  const property = useMemo(() => previewProperties.find((candidate) => candidate.id === propertyId) ?? previewProperties[0], [previewProperties, propertyId])
  const unit = property?.units.find((candidate) => candidate.id === unitId) ?? property?.units[0]
  const readOnly = readOnlyDemo || !capabilities.manage
  const visibleTabs = TABS.filter((item) => !item.managerOnly || !readOnly)
  const periodLabel = calendarView === 'month'
    ? ['Agosto 2026', 'Settembre 2026', 'Ottobre 2026'][Math.max(0, Math.min(2, periodOffset + 1))]
    : ['12–18 ottobre 2026', '19–25 ottobre 2026', '26 ottobre–1 novembre 2026'][Math.max(0, Math.min(2, periodOffset + 1))]

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

  function changeProperty(nextPropertyId: string) { const next = previewProperties.find((candidate) => candidate.id === nextPropertyId); setPropertyId(nextPropertyId); setUnitId(next?.units[0]?.id ?? ''); setTab('calendar') }
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
      {preview ? <label className="shift-field shift-property-field"><span>Scenario</span><span className="shift-select-wrap"><select value={property.id} onChange={(event) => changeProperty(event.target.value)}>{previewProperties.map((candidate) => <option value={candidate.id} key={candidate.id}>{candidate.name}</option>)}</select><ChevronDown size={16} aria-hidden="true" /></span></label> : null}
      {preview ? <button className="shift-view-toggle" type="button" onClick={togglePreviewRole}>{readOnly ? <Eye size={15} /> : <ShieldCheck size={15} />}Vista {readOnly ? 'dipendente' : 'responsabile'}</button> : null}
    </div></header>
    <nav className="shift-main-tabs" aria-label="Sezioni Turni"><div ref={navContainerRef} className="shift-main-tabs-scroll" role="tablist"><i className="shift-tab-highlight" aria-hidden="true" style={{ left: navHighlight.left, width: navHighlight.width, opacity: navHighlight.ready ? 1 : 0 }} /><div className="shift-main-tab-buttons">{visibleTabs.map((item) => <button ref={(element) => { if (element) navButtonRefs.current[item.id] = element }} type="button" role="tab" aria-selected={tab === item.id} className={tab === item.id ? 'is-active' : undefined} onClick={() => changeTab(item.id)} key={item.id}>{item.label}</button>)}</div></div></nav>
    <div className={`shift-tab-scene${tabTransitionActive ? ' is-entering' : ''}`} style={sceneStyle}>
      {tab === 'calendar' ? <><div className="shift-calendar-toolbar"><div className="shift-period-control"><button type="button" aria-label="Periodo precedente" onClick={() => setPeriodOffset((value) => Math.max(-1, value - 1))}><ChevronLeft size={17} /></button><strong>{periodLabel}</strong><button type="button" aria-label="Periodo successivo" onClick={() => setPeriodOffset((value) => Math.min(1, value + 1))}><ChevronRight size={17} /></button><span className="shift-status-chip is-draft">Bozza</span></div><div className="shift-calendar-actions"><div className="shift-view-segment" aria-label="Visualizzazione calendario"><button type="button" className={calendarView === 'month' ? 'is-active' : undefined} onClick={() => { setCalendarView('month'); setPeriodOffset(0) }}>Mese</button><button type="button" className={calendarView === 'week' ? 'is-active' : undefined} onClick={() => { setCalendarView('week'); setPeriodOffset(0) }}>Settimana</button></div>{!readOnly ? <><button type="button" disabled={preview}>Assegna automaticamente</button><button type="button" disabled={preview}>Imposta riposi</button><button type="button" disabled={preview}>Rendi definitivo</button><button className="is-primary" type="button" disabled={preview}>Salva turni</button></> : null}</div></div><UnitSelector property={property} unitId={unit.id} onSelect={setUnitId} /><section className="shift-schedule-card"><ScheduleGrid unit={unit} view={calendarView} /><div className="shift-legend">{unit.codes.map((code) => <span key={code.code}><i style={{ background: code.color }} /><strong>{code.code}</strong>{code.label}{code.time ? ` (${code.time})` : ''}</span>)}</div></section></> : null}
      {tab === 'employees' ? <EmployeesPanel property={property} /> : null}
      {tab === 'rules' ? <><UnitSelector property={property} unitId={unit.id} onSelect={setUnitId} /><RulesPanel unit={unit} /></> : null}
      {tab === 'mine' ? <PersonalPanel /> : null}{tab === 'preferences' ? <PersonalPanel preferences /> : null}
      {tab === 'swaps' ? <RequestsPanel kind="swaps" /> : null}{tab === 'absences' ? <RequestsPanel kind="absences" /> : null}{tab === 'preassignments' ? <RequestsPanel kind="preassignments" /> : null}
    </div>
  </div>
}

function UnitSelector({ property, unitId, onSelect }: { property: ShiftPreviewProperty; unitId: string; onSelect: (id: string) => void }) {
  return <div className="shift-unit-selector" role="tablist" aria-label="Unità di pianificazione">{property.units.map((unit) => <button type="button" role="tab" aria-selected={unit.id === unitId} className={unit.id === unitId ? 'is-active' : undefined} onClick={() => onSelect(unit.id)} key={unit.id}>{unit.name}<span>{unit.people.length}</span></button>)}</div>
}
