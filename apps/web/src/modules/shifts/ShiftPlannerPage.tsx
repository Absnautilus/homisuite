import { useCallback, useEffect, useRef, useState } from 'react'
import { ShiftPlannerModule, type ShiftAvailableTeamMember, type ShiftPlannerCapabilities, type ShiftPreviewProperty, type ShiftRequestInboxItem, type VacationPeriod, type VacationSettings } from '@homisuite/shifts-module'
import '@homisuite/shifts-module/style.css'
import { PageState } from '../../components/PageState'
import { supabase } from '../../core/client'
import { useModuleRuntime } from '../../core/ModuleRuntimeContext'
import { loadLiveShiftData } from './shiftLiveData'
import { loadAvailableTeamMembers } from './availableTeamMembers'
import { addStaffMember } from './addStaffMember'
import { saveShiftAssignments } from './saveShiftAssignments'
import { saveMemberOrder } from './saveMemberOrder'
import { saveRuleSet } from './saveRuleSet'
import { setUnitRestDays, setUnitFutureRestDays } from './saveRestDays'
import { saveShiftCode, deleteOrArchiveShiftCode } from './saveShiftCode'
import { setMonthStatus } from './saveMonthStatus'
import { generateUnitAssignments } from './generateAssignments'
import { clearDraftShifts } from './clearDraftShifts'
import { saveInferredRotationSlots } from './saveInferredRotationSlots'
import { saveUnit, archiveUnit, restoreUnit } from './saveUnit'
import { saveStaffRestSettings } from './saveStaffRestSettings'
import { saveStaffAssignmentRole } from './saveStaffAssignmentRole'
import { setShiftLocked } from './saveShiftLock'
import { createAbsenceRequest, createPreassignmentRequest, createShiftSwapRequest, decideAbsenceRequest, decidePreassignment, loadShiftRequestInbox, respondShiftSwap, type ShiftAbsenceInboxRow, type ShiftPreassignmentInboxRow, type ShiftSwapInboxRow } from './shiftRequestActions'
import { loadStaffShiftPreferences, saveStaffShiftPreferences, type StaffShiftPreferences } from './staffPreferences'
import { loadVacationData, requestVacationPeriod, decideVacationPeriod, saveVacationSettings } from './vacationData'

type State =
  | { status: 'loading' }
  | { status: 'ready'; property: ShiftPreviewProperty; capabilities: ShiftPlannerCapabilities; currentStaffProfileId?: string; preferences?: StaffShiftPreferences; requestInbox?: ShiftRequestInboxItem[]; availableTeamMembers: ShiftAvailableTeamMember[]; vacationPeriods: VacationPeriod[]; vacationSettings: VacationSettings }
  | { status: 'not-entitled' | 'forbidden' | 'empty' | 'error' }

export function ShiftPlannerPage() {
  const runtime = useModuleRuntime()
  const propertyId = runtime.property?.id ?? null
  const propertyName = runtime.property?.name ?? 'Struttura'
  const entitled = runtime.entitlements.some((item) => item.enabled && item.slug === 'shifts')
  const [state, setState] = useState<State>({ status: 'loading' })
  const [month, setMonth] = useState(() => new Date().toISOString().slice(0, 7))
  const [requestRevision, setRequestRevision] = useState(0)

  // Monotonic token guarding every refresh (the initial load and any silent
  // post-mutation refresh below): a refresh only commits state if it's still
  // the most recent one in flight, so a slow stale call can't clobber a
  // newer load that started after it (e.g. switching property mid-fetch).
  const loadTokenRef = useRef(0)

  const refreshLiveData = useCallback(async (options?: { silent?: boolean }) => {
    const silent = options?.silent ?? false
    const token = ++loadTokenRef.current
    const isCurrent = () => loadTokenRef.current === token
    if (!entitled) {
      if (!silent) setState({ status: 'not-entitled' })
      return
    }
    if (!propertyId) {
      if (!silent) setState({ status: 'loading' })
      return
    }
    if (!silent) setState({ status: 'loading' })
    try {
      const [view, manage, manageRequests] = await Promise.all([
        runtime.hasPermission('shifts.view'),
        runtime.hasPermission('shifts.manage'),
        runtime.hasPermission('shifts.requests.manage'),
      ])
      if (!isCurrent()) return
      if (!view) {
        if (!silent) setState({ status: 'forbidden' })
        return
      }
      const live = await loadLiveShiftData(supabase, propertyId, propertyName, month)
      if (!isCurrent()) return
      if (live.property.units.length === 0) {
        if (!silent) setState({ status: 'empty' })
        return
      }
      const preferences = live.currentStaffProfileId ? await loadStaffShiftPreferences(supabase, propertyId, live.currentStaffProfileId) : undefined
      const rawInbox = manageRequests || live.currentStaffProfileId ? await loadShiftRequestInbox(supabase, propertyId) : { absences: [], preassignments: [], swaps: [] }
      const availableTeamMembers = manage ? await loadAvailableTeamMembers(supabase, propertyId) : []
      const { periods: vacationPeriods, settings: vacationSettings } = await loadVacationData(supabase, propertyId)
      if (!isCurrent()) return
      const personName = (id: string) => live.property.units.flatMap((unit) => unit.people).find((person) => person.id === id)?.name ?? 'Dipendente'
      const requestInbox = [
        ...(manageRequests ? rawInbox.absences.map((item: ShiftAbsenceInboxRow) => ({ id: item.id, kind: 'absences' as const, planningUnitId: item.planning_unit_id, staffProfileId: item.staff_profile_id, status: item.status, date: item.starts_on, label: item.absence_kind === 'leave' ? 'Ferie' : item.absence_kind === 'permission' ? 'Permesso' : item.absence_kind === 'illness' ? 'Malattia' : 'Assenza', note: item.note })) : []),
        ...(manageRequests ? rawInbox.preassignments.map((item: ShiftPreassignmentInboxRow) => ({ id: item.id, kind: 'preassignments' as const, planningUnitId: item.planning_unit_id, staffProfileId: item.staff_profile_id, status: item.status, date: item.shift_date, label: `Pre-assegnazione ${Array.isArray(item.shift_codes) ? item.shift_codes[0]?.code ?? '' : item.shift_codes?.code ?? ''}`, note: item.note })) : []),
        ...rawInbox.swaps.filter((item: ShiftSwapInboxRow) => manageRequests || item.target_staff_profile_id === live.currentStaffProfileId).map((item: ShiftSwapInboxRow) => ({ id: item.id, kind: 'swaps' as const, planningUnitId: item.planning_unit_id, staffProfileId: item.requester_staff_profile_id, targetStaffProfileId: item.target_staff_profile_id ?? undefined, status: item.status, label: `Cambio turno · ${personName(item.requester_staff_profile_id)} → ${item.target_staff_profile_id ? personName(item.target_staff_profile_id) : 'Da assegnare'}`, note: item.note })),
      ]
      if (!isCurrent()) return
      setState({ status: 'ready', property: live.property, capabilities: { view, manage, manageRequests }, currentStaffProfileId: live.currentStaffProfileId, preferences, requestInbox, availableTeamMembers, vacationPeriods, vacationSettings })
    } catch (cause) {
      console.error('ShiftPlannerPage: live data load failed', cause)
      if (isCurrent() && !silent) setState({ status: 'error' })
    }
  }, [entitled, propertyId, propertyName, runtime, month])

  useEffect(() => {
    void refreshLiveData()
    // requestRevision is a manual bump (e.g. after a request decision); it
    // isn't a dependency of refreshLiveData itself, so it's listed here too.
  }, [refreshLiveData, requestRevision])

  if (state.status === 'loading') return <PageState kind="loading" title="" />
  if (state.status === 'not-entitled') return <PageState kind="unavailable" title="Turni non è abilitato per questa struttura." />
  if (state.status === 'forbidden') return <PageState kind="unavailable" title="Non hai accesso al modulo Turni per questa struttura." />
  if (state.status === 'empty') return <PageState kind="empty" title="Turni non è ancora configurato." description="Crea almeno un’unità di pianificazione per iniziare." />
  if (state.status === 'error') return <PageState kind="error" title="Impossibile caricare Turni." description="Riprova tra qualche istante." action={{ label: 'Ricarica', onClick: () => window.location.reload() }} />

  if (state.status !== 'ready') return null

  const readyState = state
  const profileId = runtime.profile?.id
  return <ShiftPlannerModule requestInbox={readyState.requestInbox} onRequestDecision={async (item, approve) => {
    if (item.kind === 'absences') await decideAbsenceRequest(supabase, item.id, approve)
    else if (item.kind === 'preassignments') await decidePreassignment(supabase, item.id, approve)
    else await respondShiftSwap(supabase, item.id, approve)
    setRequestRevision((value) => value + 1)
  }} initialPropertyId={readyState.property.id} previewProperties={[readyState.property]} capabilities={readyState.capabilities} currentStaffProfileId={readyState.currentStaffProfileId} month={month} onMonthChange={setMonth} initialPreferences={readyState.preferences} onSavePreferences={async (preferences) => {
    if (!propertyId || !readyState.currentStaffProfileId) throw new Error('Missing active staff profile')
    await saveStaffShiftPreferences(supabase, propertyId, readyState.currentStaffProfileId, preferences)
  }} onSubmitRequest={async (planningUnitId, request) => {
    if (!propertyId || !readyState.currentStaffProfileId) throw new Error('Missing active staff profile')
    if (request.kind === 'absences' && request.absenceKind) {
      await createAbsenceRequest(supabase, propertyId, planningUnitId, readyState.currentStaffProfileId, request.date, request.absenceKind, request.note)
      return
    }
    if (request.kind === 'swaps' && request.targetStaffProfileId && request.requestedShiftId && request.offeredShiftId) {
      await createShiftSwapRequest(supabase, propertyId, planningUnitId, readyState.currentStaffProfileId, request.requestedShiftId, request.targetStaffProfileId, request.offeredShiftId, request.note)
      return
    }
    if (request.kind === 'preassignments' && request.shiftCodeId) {
      await createPreassignmentRequest(supabase, propertyId, planningUnitId, readyState.currentStaffProfileId, request.shiftCodeId, request.date, request.note)
      return
    }
    throw new Error('Invalid shift request')
  }} onSaveAssignments={async (changes) => {
    if (!propertyId || !profileId) throw new Error('Missing active property/profile')
    const byUnit = new Map<string, typeof changes>()
    for (const change of changes) byUnit.set(change.planningUnitId, [...(byUnit.get(change.planningUnitId) ?? []), change])
    for (const [unitId, unitChanges] of byUnit) {
      const unit = readyState.property.units.find((candidate) => candidate.id === unitId)
      if (!unit) throw new Error('Unknown planning unit')
      await saveShiftAssignments(supabase, propertyId, profileId, unit, unitChanges)
    }
  }} onReorderMembers={async ({ planningUnitId, staffProfileIds }) => {
    if (!propertyId) throw new Error('Missing active property')
    await saveMemberOrder(supabase, propertyId, planningUnitId, staffProfileIds)
    void refreshLiveData({ silent: true })
  }} onSaveStaffPlanning={async ({ staffProfileId, planningUnitId, assignmentProfile, restMode, restDays }) => {
    if (!propertyId) throw new Error('Missing active property')
    await Promise.all([
      saveStaffRestSettings(supabase, propertyId, staffProfileId, restMode, restDays),
      saveStaffAssignmentRole(supabase, propertyId, planningUnitId, staffProfileId, assignmentProfile),
    ])
    void refreshLiveData({ silent: true })
  }} availableTeamMembers={readyState.availableTeamMembers} onAddStaffMember={async ({ profileId, planningUnitId }) => {
    if (!propertyId) throw new Error('Missing active property')
    const staffId = await addStaffMember(supabase, propertyId, profileId, planningUnitId)
    // ShiftPlannerModule only updates its own local copy of the roster so the
    // new person shows up immediately -- this page's own state (what
    // onGenerateAssignments reads to decide who's in the unit) is otherwise
    // never told about the change until the next unrelated reload, so a new
    // hire silently gets skipped by "Assegna automaticamente" until then.
    void refreshLiveData({ silent: true })
    return staffId
  }} onSaveRules={async ({ planningUnitId, coverage, hard, soft, restRotationPairsPerCycle, roleCodes }) => {
    if (!propertyId) throw new Error('Missing active property')
    const unit = readyState.property.units.find((candidate) => candidate.id === planningUnitId)
    if (!unit) throw new Error('Unknown planning unit')
    await saveRuleSet(supabase, propertyId, unit, { coverage, hard, soft, restRotationPairsPerCycle, roleCodes })
    void refreshLiveData({ silent: true })
  }} onSetRestDays={async (planningUnitId) => {
    if (!propertyId || !profileId) throw new Error('Missing active property/profile')
    const unit = readyState.property.units.find((candidate) => candidate.id === planningUnitId)
    if (!unit) throw new Error('Unknown planning unit')
    return setUnitRestDays(supabase, propertyId, profileId, unit)
  }} onSetFutureRestDays={async (planningUnitId) => {
    if (!propertyId || !profileId) throw new Error('Missing active property/profile')
    const unit = readyState.property.units.find((candidate) => candidate.id === planningUnitId)
    if (!unit) throw new Error('Unknown planning unit')
    return setUnitFutureRestDays(supabase, propertyId, profileId, unit, 12)
  }} onSaveCode={async (input) => {
    if (!propertyId) throw new Error('Missing active property')
    return saveShiftCode(supabase, propertyId, input)
  }} onDeleteCode={async (_planningUnitId, codeId) => {
    if (!propertyId) throw new Error('Missing active property')
    return deleteOrArchiveShiftCode(supabase, propertyId, codeId)
  }} onSetMonthStatus={async (planningUnitId, status) => {
    if (!propertyId || !profileId) throw new Error('Missing active property/profile')
    const unit = readyState.property.units.find((candidate) => candidate.id === planningUnitId)
    if (!unit) throw new Error('Unknown planning unit')
    await setMonthStatus(supabase, propertyId, profileId, unit, status)
    void refreshLiveData({ silent: true })
  }} onGenerateAssignments={async (planningUnitId) => {
    if (!propertyId || !profileId) throw new Error('Missing active property/profile')
    const unit = readyState.property.units.find((candidate) => candidate.id === planningUnitId)
    if (!unit) throw new Error('Unknown planning unit')
    const result = await generateUnitAssignments(supabase, propertyId, profileId, unit)
    void refreshLiveData({ silent: true })
    return result
  }} onClearDraftShifts={async (planningUnitId) => {
    if (!propertyId) throw new Error('Missing active property')
    const unit = readyState.property.units.find((candidate) => candidate.id === planningUnitId)
    if (!unit) throw new Error('Unknown planning unit')
    const result = await clearDraftShifts(supabase, propertyId, unit)
    void refreshLiveData({ silent: true })
    return result
  }} onInferRotation={async (_planningUnitId, updates) => {
    if (!propertyId) throw new Error('Missing active property')
    const result = await saveInferredRotationSlots(supabase, propertyId, updates)
    void refreshLiveData({ silent: true })
    return result
  }} onSetShiftLocked={async (planningUnitId, staffProfileId, shiftDate, locked) => {
    if (!propertyId) throw new Error('Missing active property')
    await setShiftLocked(supabase, propertyId, planningUnitId, staffProfileId, shiftDate, locked)
  }} onSaveUnit={async (input) => {
    if (!propertyId) throw new Error('Missing active property')
    const result = await saveUnit(supabase, propertyId, input)
    void refreshLiveData({ silent: true })
    return result
  }} onArchiveUnit={async (unitId) => {
    if (!propertyId) throw new Error('Missing active property')
    await archiveUnit(supabase, propertyId, unitId)
    void refreshLiveData({ silent: true })
  }} onRestoreUnit={async (unitId) => {
    if (!propertyId) throw new Error('Missing active property')
    await restoreUnit(supabase, propertyId, unitId)
    void refreshLiveData({ silent: true })
  }} vacationPeriods={readyState.vacationPeriods} vacationSettings={readyState.vacationSettings} onRequestVacationPeriod={async (input) => {
    if (!propertyId) throw new Error('Missing active property')
    await requestVacationPeriod(supabase, propertyId, input)
    void refreshLiveData({ silent: true })
  }} onDecideVacationPeriod={async (periodId, approve) => {
    if (!propertyId) throw new Error('Missing active property')
    await decideVacationPeriod(supabase, periodId, approve)
    void refreshLiveData({ silent: true })
  }} onSaveVacationSettings={async (settings) => {
    if (!propertyId) throw new Error('Missing active property')
    await saveVacationSettings(supabase, propertyId, settings)
    void refreshLiveData({ silent: true })
  }} />
}
