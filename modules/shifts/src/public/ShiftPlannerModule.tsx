import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { Badge, Building2, CalendarDays, CalendarRange, Check, ChevronDown, ChevronLeft, ChevronRight, ClipboardList, Eye, ListChecks, MoreHorizontal, Palmtree, Repeat2, Settings2, ShieldCheck, SlidersHorizontal, UserRound, UsersRound, Workflow } from 'lucide-react'
import { BottomActionBar, Button, Modal, ModuleNav, Toast } from '@homisuite/ui'
import type { ShiftCode } from '../preview/fixtures'
import { shiftPreviewProperties, type ShiftPreviewProperty } from '../preview/fixtures'
import type { AssignmentConflict } from '../domain/assignment'
import { contrastTextColor } from '../domain/contrastColor'
import { inferRotationSlot } from '../domain/restRotation'
import type { VacationPeriod, VacationSettings } from '../domain/vacationPeriods'
import { CodesPanel, type ShiftCodeSave } from './CodesPanel'
import { VacationPlanner, type VacationRequestInput } from './VacationPanels'
export type { ShiftStaffPlanningSave, ShiftAvailableTeamMember, ShiftStaffAdd } from './PlannerPanels'
import { EmployeesPanel, MyShiftsPanel, PersonalPanel, RequestInboxPanel, RequestsPanel, RulesPanel, type ShiftAvailableTeamMember, type ShiftRequestInboxItem, type ShiftRuleSetSave, type ShiftRequestSubmit, type ShiftStaffAdd, type StaffPreferenceSave } from './PlannerPanels'
import { ScheduleGrid } from './ScheduleGrid'
import { UnitsPanel, type UnitSave, type UnitSaveResult } from './UnitsPanel'

export interface ShiftPlannerCapabilities { view: boolean; manage: boolean; manageRequests: boolean }
export interface ShiftAssignmentEdit { planningUnitId: string; staffProfileId: string; shiftDate: string; code: string }
export interface ShiftMemberReorder { planningUnitId: string; staffProfileIds: string[] }
export interface GenerateAssignmentsResult { assignments: Record<string, Record<string, string>>; conflicts: AssignmentConflict[] }
export interface ClearDraftShiftsResult { cleared: Record<string, string[]> }
export interface RotationSlotUpdate { staffProfileId: string; rotationSlot: number }
export interface InferRotationResult { applied: string[]; skipped: string[] }
export type { ShiftRuleSetSave, ShiftCodeSave, AssignmentConflict, UnitSave, UnitSaveResult, ShiftRequestInboxItem }
export interface ShiftPlannerModuleProps { preview?: boolean; initialPropertyId?: string; capabilities?: ShiftPlannerCapabilities; previewProperties?: ShiftPreviewProperty[]; onSaveAssignments?: (changes: ShiftAssignmentEdit[]) => Promise<void>; onReorderMembers?: (change: ShiftMemberReorder) => Promise<void>; onSaveStaffPlanning?: (change: import('./PlannerPanels').ShiftStaffPlanningSave) => Promise<void>; availableTeamMembers?: ShiftAvailableTeamMember[]; onAddStaffMember?: (input: ShiftStaffAdd) => Promise<string>; onSaveRules?: (change: ShiftRuleSetSave) => Promise<void>; onSetRestDays?: (planningUnitId: string) => Promise<Record<string, string[]>>; onSetFutureRestDays?: (planningUnitId: string) => Promise<number>; onInferRotation?: (planningUnitId: string, updates: RotationSlotUpdate[]) => Promise<InferRotationResult>; onSaveCode?: (input: ShiftCodeSave) => Promise<ShiftCode>; onDeleteCode?: (planningUnitId: string, codeId: string) => Promise<'deleted' | 'archived'>; onSetMonthStatus?: (planningUnitId: string, status: 'draft' | 'final') => Promise<void>; onGenerateAssignments?: (planningUnitId: string) => Promise<GenerateAssignmentsResult>; onClearDraftShifts?: (planningUnitId: string) => Promise<ClearDraftShiftsResult>; onSaveUnit?: (input: UnitSave) => Promise<UnitSaveResult>; onArchiveUnit?: (unitId: string) => Promise<void>; onRestoreUnit?: (unitId: string) => Promise<void>; currentStaffProfileId?: string; month?: string; onMonthChange?: (month: string) => void; onSetShiftLocked?: (planningUnitId: string, staffProfileId: string, shiftDate: string, locked: boolean) => Promise<void>; onSubmitRequest?: (planningUnitId: string, request: ShiftRequestSubmit) => Promise<void>; initialPreferences?: StaffPreferenceSave; onSavePreferences?: (preferences: StaffPreferenceSave) => Promise<void>; requestInbox?: ShiftRequestInboxItem[]; onRequestDecision?: (item: ShiftRequestInboxItem, approve: boolean) => Promise<void>; vacationPeriods?: VacationPeriod[]; vacationSettings?: VacationSettings; onRequestVacationPeriod?: (input: VacationRequestInput) => Promise<void>; onDecideVacationPeriod?: (periodId: string, approve: boolean) => Promise<void>; onSaveVacationSettings?: (settings: VacationSettings) => Promise<void> }
type ModuleTab = 'calendar' | 'mine' | 'employees' | 'rules' | 'codes' | 'units' | 'preferences' | 'swaps' | 'absences' | 'preassignments' | 'vacation'
type CalendarView = 'month' | 'week'
type NavGroup = 'operativo' | 'impostazioni'

const DEFAULT_CAPABILITIES: ShiftPlannerCapabilities = { view: true, manage: true, manageRequests: true }
const PENDING_CHANGES_STORAGE_PREFIX = 'homisuite.shiftPendingChanges.'

// A real browser tab discard-and-reload (Chrome freeing memory from a
// backgrounded tab, not anything our own code triggers or can prevent)
// restarts the whole app from scratch, including this component -- so any
// shift edits made but not yet saved via "Salva turni" would otherwise be
// silently gone. sessionStorage survives that kind of reload (cleared only
// when the tab/window itself closes), so a discarded-and-reloaded tab comes
// back with the same unsaved edits still in place.
function loadStoredPendingChanges(propertyId: string | undefined): ShiftAssignmentEdit[] {
  if (!propertyId || typeof window === 'undefined') return []
  try {
    const raw = window.sessionStorage.getItem(PENDING_CHANGES_STORAGE_PREFIX + propertyId)
    return raw ? (JSON.parse(raw) as ShiftAssignmentEdit[]) : []
  } catch {
    return []
  }
}
// Restoring `pendingChanges` alone isn't enough -- the grid itself renders
// from `draftProperties`, which came fresh from the server and never had
// these not-yet-saved edits in the first place. Without re-painting them
// back on, a restored tab would keep the edit queued for "Salva turni" (the
// button would correctly be enabled) while the grid cell the user actually
// looks at stayed empty, looking exactly like the edit was lost.
function applyPendingChanges(properties: ShiftPreviewProperty[], changes: ShiftAssignmentEdit[]): ShiftPreviewProperty[] {
  if (changes.length === 0) return properties
  return properties.map((property) => ({
    ...property,
    units: property.units.map((unit) => {
      const unitChanges = changes.filter((change) => change.planningUnitId === unit.id)
      if (unitChanges.length === 0) return unit
      const assignments = { ...unit.assignments }
      for (const change of unitChanges) {
        const dateIndex = unit.assignmentDates?.indexOf(change.shiftDate) ?? -1
        if (dateIndex < 0) continue
        const next = [...(assignments[change.staffProfileId] ?? [])]
        next[dateIndex] = change.code
        assignments[change.staffProfileId] = next
      }
      return { ...unit, assignments }
    }),
  }))
}
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
  { id: 'vacation' as ModuleTab, label: 'Piano Ferie', icon: <CalendarRange /> },
]
const SETTINGS_TABS = [
  { id: 'employees' as ModuleTab, label: 'Dipendenti', icon: <UsersRound /> },
  { id: 'units' as ModuleTab, label: 'Unità', icon: <Building2 /> },
  { id: 'rules' as ModuleTab, label: 'Regole turni', icon: <ListChecks /> },
  { id: 'codes' as ModuleTab, label: 'Codici turno', icon: <Badge /> },
]

export function ShiftPlannerModule({ preview = false, initialPropertyId, capabilities = DEFAULT_CAPABILITIES, previewProperties = shiftPreviewProperties, onSaveAssignments, onReorderMembers, onSaveStaffPlanning, availableTeamMembers = [], onAddStaffMember, onSaveRules, onSetRestDays, onSetFutureRestDays, onSaveCode, onDeleteCode, onSetMonthStatus, onGenerateAssignments, onClearDraftShifts, onInferRotation, onSaveUnit, onArchiveUnit, onRestoreUnit, currentStaffProfileId, month, onMonthChange, onSetShiftLocked, onSubmitRequest, initialPreferences, onSavePreferences, requestInbox = [], onRequestDecision, vacationPeriods = [], vacationSettings = { periodsPerYear: 3, minDays: 1, maxDays: 30 }, onRequestVacationPeriod, onDecideVacationPeriod, onSaveVacationSettings }: ShiftPlannerModuleProps) {
  const initialProperty = previewProperties.find((property) => property.id === initialPropertyId) ?? previewProperties[0]
  const [propertyId, setPropertyId] = useState(initialProperty?.id ?? '')
  const [unitId, setUnitId] = useState(initialProperty?.units.find((candidate) => candidate.status !== 'inactive')?.id ?? initialProperty?.units[0]?.id ?? '')
  const [tab, setTab] = useState<ModuleTab>('calendar')
  const [navGroup, setNavGroup] = useState<NavGroup>('operativo')
  const [calendarView, setCalendarView] = useState<CalendarView>('month')
  const [readOnlyDemo, setReadOnlyDemo] = useState(false)
  const [draftProperties, setDraftProperties] = useState(() => applyPendingChanges(previewProperties, preview ? [] : loadStoredPendingChanges(initialPropertyId)))
  const [draftAvailableTeamMembers, setDraftAvailableTeamMembers] = useState(availableTeamMembers)
  const [pendingChanges, setPendingChanges] = useState<ShiftAssignmentEdit[]>(() => preview ? [] : loadStoredPendingChanges(initialPropertyId))
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const [restDaysState, setRestDaysState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const [futureRestDaysState, setFutureRestDaysState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const [restCodeSetupState, setRestCodeSetupState] = useState<'idle' | 'saving' | 'error'>('idle')
  const [monthStatusState, setMonthStatusState] = useState<'idle' | 'saving' | 'error'>('idle')
  const [assignState, setAssignState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const [assignConflicts, setAssignConflicts] = useState<AssignmentConflict[]>([])
  const [clearDraftState, setClearDraftState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const [clearDraftConfirmOpen, setClearDraftConfirmOpen] = useState(false)
  const [inferRotationState, setInferRotationState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const [inferRotationIssues, setInferRotationIssues] = useState<string[]>([])
  const [tabDirection, setTabDirection] = useState<1 | -1>(1)
  const [tabTransitionActive, setTabTransitionActive] = useState(false)
  const didMountPendingChangesRef = useRef(false)
  useEffect(() => {
    // Skip the very first run entirely: pendingChanges (and draftProperties,
    // via its initializer above) may have just been restored from
    // sessionStorage, and this effect also fires on that initial mount
    // (previewProperties is "new" the first time too) -- resetting either
    // one right back out would defeat the restore. Every later run is a
    // real data reload (e.g. switching property), where resetting both is
    // correct.
    if (didMountPendingChangesRef.current) {
      setDraftProperties(previewProperties)
      setPendingChanges([])
    }
    didMountPendingChangesRef.current = true
    setSaveState('idle')
  }, [previewProperties])
  useEffect(() => {
    if (preview || !initialPropertyId || typeof window === 'undefined') return
    try {
      const key = PENDING_CHANGES_STORAGE_PREFIX + initialPropertyId
      if (pendingChanges.length > 0) window.sessionStorage.setItem(key, JSON.stringify(pendingChanges))
      else window.sessionStorage.removeItem(key)
    } catch {
      // sessionStorage unavailable (private browsing, full quota) -- edits
      // just won't survive a tab reload, same as before this existed.
    }
  }, [pendingChanges, preview, initialPropertyId])
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
  useEffect(() => {
    if (clearDraftState !== 'saved') return
    const id = window.setTimeout(() => setClearDraftState('idle'), 3000)
    return () => window.clearTimeout(id)
  }, [clearDraftState])
  useEffect(() => {
    if (inferRotationState !== 'saved') return
    const id = window.setTimeout(() => setInferRotationState('idle'), 3000)
    return () => window.clearTimeout(id)
  }, [inferRotationState])

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
  async function inferRotation() {
    if (!onInferRotation || !unit || !unit.month || pendingChanges.length > 0) return
    setInferRotationState('saving')
    setInferRotationIssues([])
    try {
      const [yearText, monthText] = unit.month.split('-')
      const year = Number(yearText)
      const month = Number(monthText) - 1
      const dates = unit.assignmentDates ?? []
      const updates: RotationSlotUpdate[] = []
      const unmatchedIds: string[] = []
      for (const person of unit.people) {
        if (person.restMode !== 'rotating') continue
        const values = unit.assignments[person.id] ?? []
        const restDates = new Set(dates.filter((_date, index) => values[index] === 'R'))
        const slot = inferRotationSlot(restDates, year, month, dates.length)
        if (slot == null) unmatchedIds.push(person.id)
        else updates.push({ staffProfileId: person.id, rotationSlot: slot })
      }
      const result = await onInferRotation(unit.id, updates)
      const nameOf = (id: string) => unit.people.find((person) => person.id === id)?.name ?? 'Dipendente'
      setInferRotationIssues([...unmatchedIds, ...result.skipped].map(nameOf))
      setInferRotationState('saved')
    } catch {
      setInferRotationState('error')
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
  async function clearDraftShifts() {
    if (!onClearDraftShifts || !property || !unit) return
    setClearDraftConfirmOpen(false)
    setClearDraftState('saving')
    try {
      const result = await onClearDraftShifts(unit.id)
      const dateIndexByDate = new Map((unit.assignmentDates ?? []).map((date, index) => [date, index]))
      setDraftProperties((current) => current.map((candidate) => candidate.id !== property.id ? candidate : ({
        ...candidate,
        units: candidate.units.map((candidateUnit) => {
          if (candidateUnit.id !== unit.id) return candidateUnit
          const assignments = { ...candidateUnit.assignments }
          for (const [profileId, dates] of Object.entries(result.cleared)) {
            const next = [...(assignments[profileId] ?? [])]
            for (const date of dates) {
              const index = dateIndexByDate.get(date)
              if (index != null) next[index] = ''
            }
            assignments[profileId] = next
          }
          return { ...candidateUnit, assignments }
        }),
      })))
      setClearDraftState('saved')
    } catch {
      setClearDraftState('error')
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
      <div hidden={tab !== 'calendar'}><div className="shift-calendar-toolbar"><div className="shift-calendar-view-row"><div className="shift-period-control"><button type="button" aria-label="Periodo precedente" onClick={() => changeMonth(-1)}><ChevronLeft size={17} /></button><strong>{periodLabel}</strong><button type="button" aria-label="Periodo successivo" onClick={() => changeMonth(1)}><ChevronRight size={17} /></button></div><span className={`shift-status-chip ${monthFinal ? 'is-final' : 'is-draft'}`}>{monthFinal ? 'Definitivo' : 'Bozza'}</span><div className="shift-view-segment" aria-label="Visualizzazione calendario"><button type="button" className={calendarView === 'month' ? 'is-active' : undefined} onClick={() => { setCalendarView('month') }}>Mese</button><button type="button" className={calendarView === 'week' ? 'is-active' : undefined} onClick={() => { setCalendarView('week') }}>Settimana</button></div></div>{!readOnly ? <div className="shift-calendar-actions"><button type="button" disabled={preview || monthFinal || !onGenerateAssignments || assignState === 'saving'} onClick={() => void generateAssignments()}>{assignState === 'saving' ? 'Assegnazione…' : 'Assegna automaticamente'}</button>{hasRestCode ? <ToolbarMenu label="Altre azioni sui riposi" items={[{ label: restDaysState === 'saving' ? 'Impostazione…' : 'Imposta riposi', disabled: preview || monthFinal || !onSetRestDays || restDaysState === 'saving', onClick: () => void setRestDays() }, { label: futureRestDaysState === 'saving' ? 'Impostazione…' : 'Imposta riposi 12 mesi', disabled: preview || !onSetFutureRestDays || futureRestDaysState === 'saving', onClick: () => void setFutureRestDays() }, { label: inferRotationState === 'saving' ? 'Analisi…' : 'Imposta rotazione da questo mese', disabled: preview || !onInferRotation || inferRotationState === 'saving' || pendingChanges.length > 0, onClick: () => void inferRotation() }]} /> : <button type="button" disabled={preview || !onSaveCode || restCodeSetupState === 'saving'} onClick={() => void createDefaultRestCode()} title="Crea il codice turno &quot;R&quot; (Riposo), necessario per poter impostare i riposi">{restCodeSetupState === 'saving' ? 'Configurazione…' : 'Configura codice Riposo'}</button>}<button type="button" disabled={preview || !onSetMonthStatus || monthStatusState === 'saving'} onClick={() => void toggleMonthStatus()}>{monthStatusState === 'saving' ? 'Aggiornamento…' : (monthFinal ? 'Riporta a bozza' : 'Rendi definitivo')}</button>{onClearDraftShifts ? <button type="button" className="is-danger" disabled={preview || monthFinal || clearDraftState === 'saving'} onClick={() => setClearDraftConfirmOpen(true)}>{clearDraftState === 'saving' ? 'Svuotamento…' : 'Svuota bozza'}</button> : null}<button className="is-primary" type="button" disabled={preview || pendingChanges.length === 0 || saveState === 'saving'} onClick={() => void saveAssignments()}>{saveState === 'saving' ? 'Salvataggio…' : 'Salva turni'}</button></div> : null}</div><p className="shift-calendar-help">Lo stato Bozza/Definitivo riguarda solo {periodLabel.toLowerCase()}: ogni mese ha il proprio stato indipendente. “Assegna automaticamente” genera i turni solo per il mese visualizzato; gli altri mesi non vengono toccati. I turni bloccati restano fissi, mentre gli altri possono essere ricalcolati. Salva turni quando vuoi rendere permanenti le modifiche.</p><UnitSelector property={property} unitId={unit.id} onSelect={setUnitId} />{saveState === 'error' ? <div className="shift-empty" role="alert">Impossibile salvare le modifiche. Riprova.</div> : null}{restDaysState === 'error' ? <div className="shift-empty" role="alert">Impossibile impostare i riposi. Riprova.</div> : null}{futureRestDaysState === 'error' ? <div className="shift-empty" role="alert">Impossibile impostare i riposi dei mesi successivi. Riprova.</div> : null}{restCodeSetupState === 'error' ? <div className="shift-empty" role="alert">Impossibile creare il codice Riposo. Riprova.</div> : null}{!hasRestCode && !readOnly && onSaveCode && restCodeSetupState !== 'error' ? <div className="shift-empty" role="status">Questa unità non ha ancora un codice "R" (Riposo): creane uno per poter usare "Imposta riposi".</div> : null}{monthStatusState === 'error' ? <div className="shift-empty" role="alert">Impossibile aggiornare lo stato del mese. Riprova.</div> : null}{assignState === 'error' ? <div className="shift-empty" role="alert">Impossibile generare l'assegnazione automatica. Riprova.</div> : null}{clearDraftState === 'error' ? <div className="shift-empty" role="alert">Impossibile svuotare la bozza. Riprova.</div> : null}{inferRotationState === 'error' ? <div className="shift-empty" role="alert">Impossibile impostare la rotazione. Riprova.</div> : null}{inferRotationState === 'saved' && inferRotationIssues.length > 0 ? <div className="shift-empty shift-assign-conflicts" role="alert"><strong>Nessuno schema di riposo riconosciuto per {inferRotationIssues.length} {inferRotationIssues.length === 1 ? 'persona' : 'persone'}:</strong><ul>{inferRotationIssues.map((name, index) => <li key={index}>{name}: i riposi di questo mese non seguono uno schema regolare, o coincidono con quelli di un'altra persona.</li>)}</ul></div> : null}{assignConflicts.length > 0 ? <div className="shift-empty shift-assign-conflicts" role="alert"><strong>{assignConflicts.length} {assignConflicts.length === 1 ? 'turno non coperto' : 'turni non coperti'}:</strong><ul>{assignConflicts.slice(0, 8).map((conflict, index) => <li key={index}>{conflict.message}</li>)}</ul>{assignConflicts.length > 8 ? <span>…e altri {assignConflicts.length - 8}.</span> : null}</div> : null}<Toast open={saveState === 'saved'}>Turni salvati.</Toast><Toast open={restDaysState === 'saved'}>Riposi impostati.</Toast><Toast open={assignState === 'saved' && assignConflicts.length === 0}>Turni assegnati automaticamente.</Toast><Toast open={clearDraftState === 'saved'}>Bozza svuotata.</Toast><Toast open={inferRotationState === 'saved' && inferRotationIssues.length === 0}>Rotazione impostata dal mese corrente.</Toast><Modal open={clearDraftConfirmOpen} title="Svuotare la bozza?" description="Eliminare tutti i turni generati automaticamente di questo mese? I turni bloccati, le assenze e i permessi non vengono toccati. Questa azione non si può annullare." onClose={() => setClearDraftConfirmOpen(false)} footer={<><Button variant="secondary" onClick={() => setClearDraftConfirmOpen(false)}>Annulla</Button><Button variant="danger" onClick={() => void clearDraftShifts()}>Svuota bozza</Button></>} /><section className="shift-schedule-card"><ScheduleGrid unit={unit} view={calendarView} editable={!readOnly && !preview && !monthFinal} onAssignmentChange={editAssignment} onLockChange={onSetShiftLocked ? setShiftLocked : undefined} /><div className="shift-legend">{unit.codes.map((code) => <span key={code.code}><strong style={{ background: code.color, color: code.textColor ?? '#fff' }}>{code.code}</strong>{code.label}{code.time ? ` (${code.time})` : ''}</span>)}</div></section>{!readOnly ? <BottomActionBar><strong>{periodLabel}</strong><button className="is-primary" type="button" disabled={preview || pendingChanges.length === 0 || saveState === 'saving'} onClick={() => void saveAssignments()}>{saveState === 'saving' ? 'Salvataggio…' : 'Salva turni'}</button></BottomActionBar> : null}</div>
      <div hidden={tab !== 'employees'}><EmployeesPanel property={{ ...property, units: property.units.filter((candidate) => candidate.status !== 'inactive') }} onReorderMembers={onReorderMembers} onSavePlanning={onSaveStaffPlanning} availableTeamMembers={draftAvailableTeamMembers} onAddStaffMember={onAddStaffMember ? addStaffMember : undefined} /></div>
      <div hidden={tab !== 'units'}><UnitsPanel units={property.units} jobTitleRoster={property.jobTitleRoster ?? []} onSaveUnit={onSaveUnit ? saveUnit : undefined} onArchiveUnit={onArchiveUnit ? archiveUnit : undefined} onRestoreUnit={onRestoreUnit ? restoreUnit : undefined} /></div>
      <div hidden={tab !== 'rules'}><UnitSelector property={property} unitId={unit.id} onSelect={setUnitId} /><RulesPanel unit={unit} onSaveRules={onSaveRules ? saveRules : undefined} /></div>
      <div hidden={tab !== 'codes'}><UnitSelector property={property} unitId={unit.id} onSelect={setUnitId} /><CodesPanel unit={unit} onSaveCode={onSaveCode ? saveCode : undefined} onDeleteCode={onDeleteCode ? (codeId) => deleteCode(unit.id, codeId) : undefined} /></div>
      <div hidden={tab !== 'mine'}><MyShiftsPanel unit={unit} currentStaffProfileId={currentStaffProfileId} /></div><div hidden={tab !== 'preferences'}><PersonalPanel unit={unit} initialPreferences={initialPreferences} onSavePreferences={onSavePreferences} /></div>
      <div hidden={tab !== 'swaps'}><RequestsPanel kind="swaps" unit={unit} currentStaffProfileId={currentStaffProfileId} onSubmitRequest={onSubmitRequest ? (request) => onSubmitRequest(unit.id, request) : undefined} /></div><div hidden={tab !== 'absences'}><RequestsPanel kind="absences" unit={unit} currentStaffProfileId={currentStaffProfileId} onSubmitRequest={onSubmitRequest ? (request) => onSubmitRequest(unit.id, request) : undefined} /></div><div hidden={tab !== 'preassignments'}><RequestsPanel kind="preassignments" unit={unit} currentStaffProfileId={currentStaffProfileId} onSubmitRequest={onSubmitRequest ? (request) => onSubmitRequest(unit.id, request) : undefined} /></div>
      <div hidden={tab !== 'vacation'}><VacationPlanner property={property} periods={vacationPeriods} settings={vacationSettings} currentStaffProfileId={currentStaffProfileId} canManage={capabilities.manage} onRequestPeriod={onRequestVacationPeriod} onDecidePeriod={onDecideVacationPeriod} onSaveSettings={onSaveVacationSettings} /></div>
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
