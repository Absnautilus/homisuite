import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { Badge, Building2, CalendarDays, Check, ChevronDown, ChevronLeft, ChevronRight, ClipboardList, Eye, ListChecks, MoreHorizontal, Palmtree, Repeat2, Settings2, ShieldCheck, SlidersHorizontal, UserRound, UsersRound, Workflow } from 'lucide-react'
import { BottomActionBar, ModuleNav, Toast } from '@homisuite/ui'
import type { ShiftCode } from '../preview/fixtures'
import { shiftPreviewProperties, type ShiftPreviewProperty } from '../preview/fixtures'
import type { AssignmentConflict } from '../domain/assignment'
import { contrastTextColor } from '../domain/contrastColor'
import { CodesPanel, type ShiftCodeSave } from './CodesPanel'
export type { ShiftStaffPlanningSave, ShiftAvailableTeamMember, ShiftStaffAdd } from './PlannerPanels'
import { EmployeesPanel, MyShiftsPanel, PersonalPanel, RequestInboxPanel, RequestsPanel, RulesPanel, type ShiftAvailableTeamMember, type ShiftRequestInboxItem, type ShiftRuleSetSave, type ShiftRequestSubmit, type ShiftStaffAdd, type StaffPreferenceSave } from './PlannerPanels'
import { ScheduleGrid } from './ScheduleGrid'
import { UnitsPanel, type UnitSave, type UnitSaveResult } from './UnitsPanel'

export interface ShiftPlannerCapabilities { view: boolean; manage: boolean; manageRequests: boolean }
export interface ShiftAssignmentEdit { planningUnitId: string; staffProfileId: string; shiftDate: string; code: string }
export interface ShiftMemberReorder { planningUnitId: string; staffProfileIds: string[] }
export interface GenerateAssignmentsResult { assignments: Record<string, Record<string, string>>; conflicts: AssignmentConflict[] }
export type { ShiftRuleSetSave, ShiftCodeSave, AssignmentConflict, UnitSave, UnitSaveResult, ShiftRequestInboxItem }
export interface ShiftPlannerModuleProps { preview?: boolean; initialPropertyId?: string; capabilities?: ShiftPlannerCapabilities; previewProperties?: ShiftPreviewProperty[]; onSaveAssignments?: (changes: ShiftAssignmentEdit[]) => Promise<void>; onReorderMembers?: (change: ShiftMemberReorder) => Promise<void>; onSaveStaffPlanning?: (change: import('./PlannerPanels').ShiftStaffPlanningSave) => Promise<void>; availableTeamMembers?: ShiftAvailableTeamMember[]; onAddStaffMember?: (input: ShiftStaffAdd) => Promise<string>; onSaveRules?: (change: ShiftRuleSetSave) => Promise<void>; onSetRestDays?: (planningUnitId: string) => Promise<Record<string, string[]>>; onSetFutureRestDays?: (planningUnitId: string) => Promise<number>; onSaveCode?: (input: ShiftCodeSave) => Promise<ShiftCode>; onDeleteCode?: (planningUnitId: string, codeId: string) => Promise<'deleted' | 'archived'>; onSetMonthStatus?: (planningUnitId: string, status: 'draft' | 'final') => Promise<void>; onGenerateAssignments?: (planningUnitId: string) => Promise<GenerateAssignmentsResult>; onSaveUnit?: (input: UnitSave) => Promise<UnitSaveResult>; onArchiveUnit?: (unitId: string) => Promise<void>; onRestoreUnit?: (unitId: string) => Promise<void>; currentStaffProfileId?: string; month?: string; onMonthChange?: (month: string) => void; onSetShiftLocked?: (planningUnitId: string, staffProfileId: string, shiftDate: string, locked: boolean) => Promise<void>; onSubmitRequest?: (planningUnitId: string, request: ShiftRequestSubmit) => Promise<void>; initialPreferences?: StaffPreferenceSave; onSavePreferences?: (preferences: StaffPreferenceSave) => Promise<void>; requestInbox?: ShiftRequestInboxItem[]; onRequestDecision?: (item: ShiftRequestInboxItem, approve: boolean) => Promise<void> }
type ModuleTab = 'calendar' | 'mine' | 'employees' | 'rules' | 'codes' | 'units' | 'preferences' | 'swaps' | 'absences' | 'preassignments'
type CalendarView = 'month' | 'week'
type NavGroup = 'operativo' | 'impostazioni'

const DEFAULT_CAPABILITIES: ShiftPlannerCapabilities = { view: true, manage: true, manageRequests: true }
function initialsOf(name: string) {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase() ?? '').join('')
}
// Split in two: day-to-day tabs every employee uses, and module-configuration
// tabs only a manager needs -- rather than one long scrolling row mixing both.
const NAV_GROUPS = [
  { value: 'operativo', label: 'Operativo', icon: <Workflow /> },
  { value: 'impostazioni', label: 'Impostazioni', icon: <Settings2 /> },
]
const OPERATIONAL_TABS = [
  { id: 'calendar' as ModuleTab, label: 'Calendario', icon: <CalendarDays /> },
  { id: 'mine' as ModuleTab, label: 'I miei turni', icon: <UserRound /> },
  { id: 'preferences' as ModuleTab, label: 'Le mie preferenze', icon: <SlidersHorizontal /> },
  { id: 'swaps' as ModuleTab, label: 'Cambi turno', icon: <Repeat2 /> },
  { id: 'absences' as ModuleTab, label: 'Ferie / Permessi', icon: <Palmtree /> },
  { id: 'preassignments' as ModuleTab, label: 'Pre-assegnazioni', icon: <ClipboardList /> },
]
const SETTINGS_TABS = [
  { id: 'employees' as ModuleTab, label: 'Dipendenti', icon: <UsersRound /> },
  { id: 'units' as ModuleTab, label: 'Unità', icon: <Building2 /> },
  { id: 'rules' as ModuleTab, label: 'Regole turni', icon: <ListChecks /> },
  { id: 'codes' as ModuleTab, label: 'Codici turno', icon: <Badge /> },
]

export function ShiftPlannerModule({ preview = false, initialPropertyId, capabilities = DEFAULT_CAPABILITIES, previewProperties = shiftPreviewProperties, onSaveAssignments, onReorderMembers, onSaveStaffPlanning, availableTeamMembers = [], onAddStaffMember, onSaveRules, onSetRestDays, onSetFutureRestDays, onSaveCode, onDeleteCode, onSetMonthStatus, onGenerateAssignments, onSaveUnit, onArchiveUnit, onRestoreUnit, currentStaffProfileId, month, onMonthChange, onSetShiftLocked, onSubmitRequest, initialPreferences, onSavePreferences, requestInbox = [], onRequestDecision }: ShiftPlannerModuleProps) {
  const initialProperty = previewProperties.find((property) => property.id === initialPropertyId) ?? previewProperties[0]
  const [propertyId, setPropertyId] = useState(initialProperty?.id ?? '')
  const [unitId, setUnitId] = useState(initialProperty?.units.find((candidate) => candidate.status !== 'inactive')?.id ?? initialProperty?.units[0]?.id ?? '')
  const [tab, setTab] = useState<ModuleTab>('calendar')
  const [navGroup, setNavGroup] = useState<NavGroup>('operativo')
  const [calendarView, setCalendarView] = useState<CalendarView>('month')
  const [readOnlyDemo, setReadOnlyDemo] = useState(false)
  const [draftProperties, setDraftProperties] = useState(previewProperties)
  const [draftAvailableTeamMembers, setDraftAvailableTeamMembers] = useState(availableTeamMembers)
  const [pendingChanges, setPendingChanges] = useState<ShiftAssignmentEdit[]>([])
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const [restDaysState, setRestDaysState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const [futureRestDaysState, setFutureRestDaysState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const [restCodeSetupState, setRestCodeSetupState] = useState<'idle' | 'saving' | 'error'>('idle')
  const [monthStatusState, setMonthStatusState] = useState<'idle' | 'saving' | 'error'>('idle')
  const [assignState, setAssignState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const [assignConflicts, setAssignConflicts] = useState<AssignmentConflict[]>([])
  const [tabDirection, setTabDirection] = useState<1 | -1>(1)
  const [tabTransitionActive, setTabTransitionActive] = useState(false)
  useEffect(() => { setDraftProperties(previewProperties); setPendingChanges([]); setSaveState('idle') }, [previewProperties])
  useEffect(() => { setDraftAvailableTeamMembers(availableTeamMembers) }, [availableTeamMembers])
  const property = useMemo(() => draftProperties.find((candidate) => candidate.id === propertyId) ?? draftProperties[0], [draftProperties, propertyId])
  const activeUnits = property?.units.filter((candidate) => candidate.status !== 'inactive') ?? []
  const unit = activeUnits.find((candidate) => candidate.id === unitId) ?? activeUnits[0] ?? property?.units[0]
  const monthFinal = unit?.monthStatus === 'final'
  const hasRestCode = unit?.codes.some((code) => code.code === 'R' && code.active !== false) ?? false
  const readOnly = readOnlyDemo || !capabilities.manage
  const visibleTabs = !readOnly && navGroup === 'impostazioni' ? SETTINGS_TABS : OPERATIONAL_TABS
  const activeMonth = month ?? unit?.month ?? '2026-09'
  const monthDate = new Date(`${activeMonth}-01T00:00:00Z`)
  const periodLabel = new Intl.DateTimeFormat('it-IT', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(monthDate)
  function changeMonth(delta: number) {
    if (!onMonthChange) return
    const next = new Date(monthDate)
    next.setUTCMonth(next.getUTCMonth() + delta)
    onMonthChange(next.toISOString().slice(0, 7))
  }

  useEffect(() => {
    if (!tabTransitionActive) return
    let secondFrame = 0
    const firstFrame = requestAnimationFrame(() => { secondFrame = requestAnimationFrame(() => setTabTransitionActive(false)) })
    return () => { cancelAnimationFrame(firstFrame); cancelAnimationFrame(secondFrame) }
  }, [tabTransitionActive, tab])

  // Success confirmations are transient toasts, not permanent page text --
  // clear each one back to 'idle' a few seconds after it lands.
  useEffect(() => {
    if (saveState !== 'saved') return
    const id = window.setTimeout(() => setSaveState('idle'), 3000)
    return () => window.clearTimeout(id)
  }, [saveState])
  useEffect(() => {
    if (restDaysState !== 'saved') return
    const id = window.setTimeout(() => setRestDaysState('idle'), 3000)
    return () => window.clearTimeout(id)
  }, [restDaysState])
  useEffect(() => {
    if (assignState !== 'saved') return
    const id = window.setTimeout(() => setAssignState('idle'), 3000)
    return () => window.clearTimeout(id)
  }, [assignState])

  function changeProperty(nextPropertyId: string) { const next = draftProperties.find((candidate) => candidate.id === nextPropertyId); setPropertyId(nextPropertyId); setUnitId(next?.units[0]?.id ?? ''); setNavGroup('operativo'); setTab('calendar') }
  function editAssignment(staffProfileId: string, date: string, code: string) {
    if (!unit || readOnly || preview || monthFinal) return
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
  async function saveRules(change: ShiftRuleSetSave) {
    if (!onSaveRules || !property) return
    await onSaveRules(change)
    const coverageStrings = change.coverage.map(({ code, quantity }) => `${quantity} × ${code}`)
    setDraftProperties((current) => current.map((candidate) => candidate.id !== property.id ? candidate : ({
      ...candidate,
      units: candidate.units.map((candidateUnit) => candidateUnit.id !== change.planningUnitId ? candidateUnit : ({
        ...candidateUnit,
        rules: { coverage: coverageStrings, hard: change.hard, soft: change.soft, restRotationPairsPerCycle: change.restRotationPairsPerCycle, roleCodes: change.roleCodes },
        ruleSetVersion: candidateUnit.ruleSetVersion + 1,
      })),
    })))
  }
  async function setRestDays() {
    if (!onSetRestDays || !property || !unit) return
    setRestDaysState('saving')
    try {
      const restDaysByProfile = await onSetRestDays(unit.id)
      const dateIndexByDate = new Map((unit.assignmentDates ?? []).map((date, index) => [date, index]))
      setDraftProperties((current) => current.map((candidate) => candidate.id !== property.id ? candidate : ({
        ...candidate,
        units: candidate.units.map((candidateUnit) => {
          if (candidateUnit.id !== unit.id) return candidateUnit
          const assignments = { ...candidateUnit.assignments }
          for (const [profileId, dates] of Object.entries(restDaysByProfile)) {
            const next = [...(assignments[profileId] ?? [])]
            for (const date of dates) {
              const index = dateIndexByDate.get(date)
              if (index != null) next[index] = 'R'
            }
            assignments[profileId] = next
          }
          return { ...candidateUnit, assignments }
        }),
      })))
      setRestDaysState('saved')
    } catch {
      setRestDaysState('error')
    }
  }
  async function setFutureRestDays() {
    if (!onSetFutureRestDays || !unit) return
    setFutureRestDaysState('saving')
    try {
      await onSetFutureRestDays(unit.id)
      setFutureRestDaysState('saved')
    } catch {
      setFutureRestDaysState('error')
    }
  }
  async function generateAssignments() {
    if (!onGenerateAssignments || !property || !unit) return
    setAssignState('saving')
    setAssignConflicts([])
    try {
      const result = await onGenerateAssignments(unit.id)
      const dateIndexByDate = new Map((unit.assignmentDates ?? []).map((date, index) => [date, index]))
      setDraftProperties((current) => current.map((candidate) => candidate.id !== property.id ? candidate : ({
        ...candidate,
        units: candidate.units.map((candidateUnit) => {
          if (candidateUnit.id !== unit.id) return candidateUnit
          const assignments = { ...candidateUnit.assignments }
          for (const [profileId, byDate] of Object.entries(result.assignments)) {
            const next = [...(assignments[profileId] ?? [])]
            for (const [date, code] of Object.entries(byDate)) {
              const index = dateIndexByDate.get(date)
              if (index != null) next[index] = code
            }
            assignments[profileId] = next
          }
          return { ...candidateUnit, assignments }
        }),
      })))
      setAssignConflicts(result.conflicts)
      setAssignState('saved')
    } catch {
      setAssignState('error')
    }
  }
  async function toggleMonthStatus() {
    if (!onSetMonthStatus || !property || !unit) return
    const nextStatus = monthFinal ? 'draft' : 'final'
    setMonthStatusState('saving')
    try {
      await onSetMonthStatus(unit.id, nextStatus)
      setDraftProperties((current) => current.map((candidate) => candidate.id !== property.id ? candidate : ({
        ...candidate,
        units: candidate.units.map((candidateUnit) => candidateUnit.id !== unit.id ? candidateUnit : ({ ...candidateUnit, monthStatus: nextStatus })),
      })))
      setMonthStatusState('idle')
    } catch {
      setMonthStatusState('error')
    }
  }
  async function createDefaultRestCode() {
    if (!onSaveCode || !unit) return
    setRestCodeSetupState('saving')
    try {
      await saveCode({ planningUnitId: unit.id, code: 'R', label: 'Riposo', kind: 'rest', startsAt: null, endsAt: null, color: '#5B7C99', textColor: contrastTextColor('#5B7C99') })
      setRestCodeSetupState('idle')
    } catch {
      setRestCodeSetupState('error')
    }
  }
  async function saveCode(input: ShiftCodeSave) {
    if (!onSaveCode || !property) return
    const saved = await onSaveCode(input)
    setDraftProperties((current) => current.map((candidate) => candidate.id !== property.id ? candidate : ({
      ...candidate,
      units: candidate.units.map((candidateUnit) => {
        if (candidateUnit.id !== input.planningUnitId) return candidateUnit
        const exists = saved.id != null && candidateUnit.codes.some((existing) => existing.id === saved.id)
        return { ...candidateUnit, codes: exists ? candidateUnit.codes.map((existing) => existing.id === saved.id ? saved : existing) : [...candidateUnit.codes, saved] }
      }),
    })))
  }
  // Only ever invoked via the onDeleteCode-gated wrapper passed to CodesPanel
  // below, so onDeleteCode and property are guaranteed here even though
  // their own types are optional.
  async function deleteCode(planningUnitId: string, codeId: string): Promise<'deleted' | 'archived'> {
    const outcome = await onDeleteCode!(planningUnitId, codeId)
    setDraftProperties((current) => current.map((candidate) => candidate.id !== property!.id ? candidate : ({
      ...candidate,
      units: candidate.units.map((candidateUnit) => candidateUnit.id !== planningUnitId ? candidateUnit : ({
        ...candidateUnit,
        codes: outcome === 'deleted' ? candidateUnit.codes.filter((existing) => existing.id !== codeId) : candidateUnit.codes.map((existing) => existing.id === codeId ? { ...existing, active: false } : existing),
      })),
    })))
    return outcome
  }
  async function setShiftLocked(staffProfileId: string, shiftDate: string, locked: boolean) {
    if (!onSetShiftLocked || !property || !unit || monthFinal) return
    await onSetShiftLocked(unit.id, staffProfileId, shiftDate, locked)
    setDraftProperties((current) => current.map((candidate) => candidate.id !== property.id ? candidate : ({
      ...candidate,
      units: candidate.units.map((candidateUnit) => {
        if (candidateUnit.id !== unit.id) return candidateUnit
        const currentDates = candidateUnit.lockedAssignments?.[staffProfileId] ?? []
        const nextDates = locked ? [...new Set([...currentDates, shiftDate])] : currentDates.filter((date) => date !== shiftDate)
        return { ...candidateUnit, lockedAssignments: { ...candidateUnit.lockedAssignments, [staffProfileId]: nextDates } }
      }),
    })))
  }
  function togglePreviewRole() { setReadOnlyDemo((current) => { const next = !current; if (next) { setNavGroup('operativo'); if (SETTINGS_TABS.some((item) => item.id === tab)) setTab('calendar') } return next }) }
  async function addStaffMember(input: ShiftStaffAdd) {
    if (!onAddStaffMember || !property) return
    const staffProfileId = await onAddStaffMember(input)
    const member = draftAvailableTeamMembers.find((candidate) => candidate.profileId === input.profileId)
    const name = member?.name ?? 'Dipendente'
    setDraftProperties((current) => current.map((candidate) => candidate.id !== property.id ? candidate : ({
      ...candidate,
      units: candidate.units.map((candidateUnit) => candidateUnit.id !== input.planningUnitId ? candidateUnit : ({
        ...candidateUnit,
        people: [...candidateUnit.people, {
          id: staffProfileId,
          name,
          initials: initialsOf(name),
          jobTitle: member?.jobTitle ?? '—',
          assignmentProfile: 'Diurno',
          includedBy: 'manual' as const,
          restMode: 'rotating' as const,
        }],
      })),
    })))
    setDraftAvailableTeamMembers((current) => current.filter((candidate) => candidate.profileId !== input.profileId))
  }
  async function saveUnit(input: UnitSave): Promise<UnitSaveResult> {
    if (!onSaveUnit || !property) throw new Error('Missing onSaveUnit or property')
    const saved = await onSaveUnit(input)
    setDraftProperties((current) => current.map((candidate) => candidate.id !== property.id ? candidate : ({
      ...candidate,
      units: candidate.units.some((candidateUnit) => candidateUnit.id === saved.id)
        ? candidate.units.map((candidateUnit) => candidateUnit.id !== saved.id ? candidateUnit : ({ ...candidateUnit, name: saved.name, includedJobTitleIds: saved.includedJobTitleIds, status: saved.status }))
        : [...candidate.units, {
            id: saved.id, name: saved.name, includedJobTitleIds: saved.includedJobTitleIds, status: saved.status,
            ruleSetName: saved.name, ruleSetVersion: 1, codes: [], people: [], assignments: {},
            rules: { coverage: [], hard: [], soft: [] },
          }],
    })))
    return saved
  }
  async function archiveUnit(unitId: string) {
    if (!onArchiveUnit || !property) return
    await onArchiveUnit(unitId)
    const nextActive = property.units.find((candidate) => candidate.id !== unitId && candidate.status !== 'inactive')
    setDraftProperties((current) => current.map((candidate) => candidate.id !== property.id ? candidate : ({
      ...candidate,
      units: candidate.units.map((candidateUnit) => candidateUnit.id !== unitId ? candidateUnit : ({ ...candidateUnit, status: 'inactive' as const })),
    })))
    if (unitId === unitId && nextActive) setUnitId(nextActive.id)
  }
  async function restoreUnit(restoredUnitId: string) {
    if (!onRestoreUnit || !property) return
    await onRestoreUnit(restoredUnitId)
    setDraftProperties((current) => current.map((candidate) => candidate.id !== property.id ? candidate : ({
      ...candidate,
      units: candidate.units.map((candidateUnit) => candidateUnit.id !== restoredUnitId ? candidateUnit : ({ ...candidateUnit, status: 'active' as const })),
    })))
    setUnitId(restoredUnitId)
  }
  function changeGroup(nextGroup: NavGroup) {
    if (nextGroup === navGroup) return
    setNavGroup(nextGroup)
    const nextTabs = nextGroup === 'impostazioni' ? SETTINGS_TABS : OPERATIONAL_TABS
    if (!nextTabs.some((item) => item.id === tab)) {
      setTabDirection(nextGroup === 'impostazioni' ? 1 : -1)
      setTabTransitionActive(true)
      setTab(nextTabs[0]!.id)
    }
  }
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
    <ModuleNav
      propertyName={property.name}
      moduleName="Turni"
      items={!readOnly ? NAV_GROUPS : [{ value: 'operativo', label: 'Operativo', icon: <Workflow /> }]}
      value={navGroup}
      onValueChange={(value) => changeGroup(value as NavGroup)}
      ariaLabel="Ambito Turni"
      actions={preview ? <>
        <ScenarioSelect properties={previewProperties} value={property.id} onChange={changeProperty} />
        <button className="shift-view-toggle" type="button" onClick={togglePreviewRole}>{readOnly ? <Eye size={15} /> : <ShieldCheck size={15} />}Vista {readOnly ? 'dipendente' : 'responsabile'}</button>
      </> : undefined}
      secondary={{
        items: visibleTabs.map((item) => ({ value: item.id, label: item.label, icon: item.icon })),
        value: tab,
        onValueChange: (value) => changeTab(value as ModuleTab),
        ariaLabel: 'Sezioni Turni',
        scrollIntoView: true,
      }}
    />
    {(capabilities.manageRequests || requestInbox.some((item) => item.kind === 'swaps' && item.targetStaffProfileId === currentStaffProfileId)) ? <RequestInboxPanel items={requestInbox.filter((item) => item.planningUnitId === unit.id)} people={unit.people} currentStaffProfileId={currentStaffProfileId} canManage={capabilities.manageRequests} onDecision={onRequestDecision} /> : null}
      <div className={`shift-tab-scene${tabTransitionActive ? ' is-entering' : ''}`} style={sceneStyle}>
      {tab === 'calendar' ? <><div className="shift-calendar-toolbar"><div className="shift-calendar-view-row"><div className="shift-period-control"><button type="button" aria-label="Periodo precedente" onClick={() => changeMonth(-1)}><ChevronLeft size={17} /></button><strong>{periodLabel}</strong><button type="button" aria-label="Periodo successivo" onClick={() => changeMonth(1)}><ChevronRight size={17} /></button></div><span className={`shift-status-chip ${monthFinal ? 'is-final' : 'is-draft'}`}>{monthFinal ? 'Definitivo' : 'Bozza'}</span><div className="shift-view-segment" aria-label="Visualizzazione calendario"><button type="button" className={calendarView === 'month' ? 'is-active' : undefined} onClick={() => { setCalendarView('month') }}>Mese</button><button type="button" className={calendarView === 'week' ? 'is-active' : undefined} onClick={() => { setCalendarView('week') }}>Settimana</button></div></div>{!readOnly ? <div className="shift-calendar-actions"><button type="button" disabled={preview || monthFinal || !onGenerateAssignments || assignState === 'saving'} onClick={() => void generateAssignments()}>{assignState === 'saving' ? 'Assegnazione…' : 'Assegna automaticamente'}</button>{hasRestCode ? <ToolbarMenu label="Altre azioni sui riposi" items={[{ label: restDaysState === 'saving' ? 'Impostazione…' : 'Imposta riposi', disabled: preview || monthFinal || !onSetRestDays || restDaysState === 'saving', onClick: () => void setRestDays() }, { label: futureRestDaysState === 'saving' ? 'Impostazione…' : 'Imposta riposi 12 mesi', disabled: preview || !onSetFutureRestDays || futureRestDaysState === 'saving', onClick: () => void setFutureRestDays() }]} /> : <button type="button" disabled={preview || !onSaveCode || restCodeSetupState === 'saving'} onClick={() => void createDefaultRestCode()} title="Crea il codice turno &quot;R&quot; (Riposo), necessario per poter impostare i riposi">{restCodeSetupState === 'saving' ? 'Configurazione…' : 'Configura codice Riposo'}</button>}<button type="button" disabled={preview || !onSetMonthStatus || monthStatusState === 'saving'} onClick={() => void toggleMonthStatus()}>{monthStatusState === 'saving' ? 'Aggiornamento…' : (monthFinal ? 'Riporta a bozza' : 'Rendi definitivo')}</button><button className="is-primary" type="button" disabled={preview || pendingChanges.length === 0 || saveState === 'saving'} onClick={() => void saveAssignments()}>{saveState === 'saving' ? 'Salvataggio…' : 'Salva turni'}</button></div> : null}</div><p className="shift-calendar-help">Lo stato Bozza/Definitivo riguarda solo {periodLabel.toLowerCase()}: ogni mese ha il proprio stato indipendente. “Assegna automaticamente” genera i turni solo per il mese visualizzato; gli altri mesi non vengono toccati. I turni bloccati restano fissi, mentre gli altri possono essere ricalcolati. Salva turni quando vuoi rendere permanenti le modifiche.</p><UnitSelector property={property} unitId={unit.id} onSelect={setUnitId} />{saveState === 'error' ? <div className="shift-empty" role="alert">Impossibile salvare le modifiche. Riprova.</div> : null}{restDaysState === 'error' ? <div className="shift-empty" role="alert">Impossibile impostare i riposi. Riprova.</div> : null}{futureRestDaysState === 'error' ? <div className="shift-empty" role="alert">Impossibile impostare i riposi dei mesi successivi. Riprova.</div> : null}{restCodeSetupState === 'error' ? <div className="shift-empty" role="alert">Impossibile creare il codice Riposo. Riprova.</div> : null}{!hasRestCode && !readOnly && onSaveCode && restCodeSetupState !== 'error' ? <div className="shift-empty" role="status">Questa unità non ha ancora un codice "R" (Riposo): creane uno per poter usare "Imposta riposi".</div> : null}{monthStatusState === 'error' ? <div className="shift-empty" role="alert">Impossibile aggiornare lo stato del mese. Riprova.</div> : null}{assignState === 'error' ? <div className="shift-empty" role="alert">Impossibile generare l'assegnazione automatica. Riprova.</div> : null}{assignConflicts.length > 0 ? <div className="shift-empty shift-assign-conflicts" role="alert"><strong>{assignConflicts.length} {assignConflicts.length === 1 ? 'turno non coperto' : 'turni non coperti'}:</strong><ul>{assignConflicts.slice(0, 8).map((conflict, index) => <li key={index}>{conflict.message}</li>)}</ul>{assignConflicts.length > 8 ? <span>…e altri {assignConflicts.length - 8}.</span> : null}</div> : null}<Toast open={saveState === 'saved'}>Turni salvati.</Toast><Toast open={restDaysState === 'saved'}>Riposi impostati.</Toast><Toast open={assignState === 'saved' && assignConflicts.length === 0}>Turni assegnati automaticamente.</Toast><section className="shift-schedule-card"><ScheduleGrid unit={unit} view={calendarView} editable={!readOnly && !preview && !monthFinal} onAssignmentChange={editAssignment} onLockChange={onSetShiftLocked ? setShiftLocked : undefined} /><div className="shift-legend">{unit.codes.map((code) => <span key={code.code}><strong style={{ background: code.color, color: code.textColor ?? '#fff' }}>{code.code}</strong>{code.label}{code.time ? ` (${code.time})` : ''}</span>)}</div></section>{!readOnly ? <BottomActionBar><strong>{periodLabel}</strong><button className="is-primary" type="button" disabled={preview || pendingChanges.length === 0 || saveState === 'saving'} onClick={() => void saveAssignments()}>{saveState === 'saving' ? 'Salvataggio…' : 'Salva turni'}</button></BottomActionBar> : null}</> : null}
      {tab === 'employees' ? <EmployeesPanel property={{ ...property, units: property.units.filter((candidate) => candidate.status !== 'inactive') }} onReorderMembers={onReorderMembers} onSavePlanning={onSaveStaffPlanning} availableTeamMembers={draftAvailableTeamMembers} onAddStaffMember={onAddStaffMember ? addStaffMember : undefined} /> : null}
      {tab === 'units' ? <UnitsPanel units={property.units} jobTitleRoster={property.jobTitleRoster ?? []} onSaveUnit={onSaveUnit ? saveUnit : undefined} onArchiveUnit={onArchiveUnit ? archiveUnit : undefined} onRestoreUnit={onRestoreUnit ? restoreUnit : undefined} /> : null}
      {tab === 'rules' ? <><UnitSelector property={property} unitId={unit.id} onSelect={setUnitId} /><RulesPanel unit={unit} onSaveRules={onSaveRules ? saveRules : undefined} /></> : null}
      {tab === 'codes' ? <><UnitSelector property={property} unitId={unit.id} onSelect={setUnitId} /><CodesPanel unit={unit} onSaveCode={onSaveCode ? saveCode : undefined} onDeleteCode={onDeleteCode ? (codeId) => deleteCode(unit.id, codeId) : undefined} /></> : null}
      {tab === 'mine' ? <MyShiftsPanel unit={unit} currentStaffProfileId={currentStaffProfileId} /> : null}{tab === 'preferences' ? <PersonalPanel unit={unit} initialPreferences={initialPreferences} onSavePreferences={onSavePreferences} /> : null}
      {tab === 'swaps' ? <RequestsPanel kind="swaps" unit={unit} currentStaffProfileId={currentStaffProfileId} onSubmitRequest={onSubmitRequest ? (request) => onSubmitRequest(unit.id, request) : undefined} /> : null}{tab === 'absences' ? <RequestsPanel kind="absences" unit={unit} currentStaffProfileId={currentStaffProfileId} onSubmitRequest={onSubmitRequest ? (request) => onSubmitRequest(unit.id, request) : undefined} /> : null}{tab === 'preassignments' ? <RequestsPanel kind="preassignments" unit={unit} currentStaffProfileId={currentStaffProfileId} onSubmitRequest={onSubmitRequest ? (request) => onSubmitRequest(unit.id, request) : undefined} /> : null}
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

function ToolbarMenu({ label, items }: { label: string; items: Array<{ label: string; disabled?: boolean; onClick: () => void }> }) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    function closeOnOutsideClick(event: PointerEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false)
    }
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('pointerdown', closeOnOutsideClick)
    document.addEventListener('keydown', closeOnEscape)
    return () => {
      document.removeEventListener('pointerdown', closeOnOutsideClick)
      document.removeEventListener('keydown', closeOnEscape)
    }
  }, [open])

  return <div className="shift-toolbar-menu" ref={rootRef}>
    <button type="button" className="shift-toolbar-menu-trigger" aria-haspopup="menu" aria-expanded={open} aria-label={label} onClick={() => setOpen((current) => !current)}><MoreHorizontal size={18} /></button>
    {open ? <div className="shift-toolbar-menu-list" role="menu" aria-label={label}>
      {items.map((item) => <button key={item.label} type="button" role="menuitem" disabled={item.disabled} onClick={() => { item.onClick(); setOpen(false) }}>{item.label}</button>)}
    </div> : null}
  </div>
}

function UnitSelector({ property, unitId, onSelect }: { property: ShiftPreviewProperty; unitId: string; onSelect: (id: string) => void }) {
  return <div className="shift-unit-selector" role="tablist" aria-label="Unità di pianificazione">{property.units.filter((unit) => unit.status !== 'inactive').map((unit) => <button type="button" role="tab" aria-selected={unit.id === unitId} className={unit.id === unitId ? 'is-active' : undefined} onClick={() => onSelect(unit.id)} key={unit.id}>{unit.name}<span>{unit.people.length}</span></button>)}</div>
}
