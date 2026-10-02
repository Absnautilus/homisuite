import { useEffect, useState } from 'react'
import { ShiftPlannerModule, type ShiftAvailableTeamMember, type ShiftPlannerCapabilities, type ShiftPreviewProperty, type ShiftRequestInboxItem } from '@homisuite/shifts-module'
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
import { saveUnit, archiveUnit, restoreUnit } from './saveUnit'
import { saveStaffRestSettings } from './saveStaffRestSettings'
import { setShiftLocked } from './saveShiftLock'
import { createAbsenceRequest, createPreassignmentRequest, createShiftSwapRequest, decideAbsenceRequest, decidePreassignment, loadShiftRequestInbox, respondShiftSwap, type ShiftAbsenceInboxRow, type ShiftPreassignmentInboxRow, type ShiftSwapInboxRow } from './shiftRequestActions'
import { loadStaffShiftPreferences, saveStaffShiftPreferences, type StaffShiftPreferences } from './staffPreferences'

type State =
  | { status: 'loading' }
  | { status: 'ready'; property: ShiftPreviewProperty; capabilities: ShiftPlannerCapabilities; currentStaffProfileId?: string; preferences?: StaffShiftPreferences; requestInbox?: ShiftRequestInboxItem[]; availableTeamMembers: ShiftAvailableTeamMember[] }
  | { status: 'not-entitled' | 'forbidden' | 'empty' | 'error' }

export function ShiftPlannerPage() {
  const runtime = useModuleRuntime()
  const propertyId = runtime.property?.id ?? null
  const propertyName = runtime.property?.name ?? 'Struttura'
  const entitled = runtime.entitlements.some((item) => item.enabled && item.slug === 'shifts')
  const [state, setState] = useState<State>({ status: 'loading' })
  const [month, setMonth] = useState(() => new Date().toISOString().slice(0, 7))
  const [requestRevision, setRequestRevision] = useState(0)

  useEffect(() => {
    let cancelled = false
    if (!entitled) {
      setState({ status: 'not-entitled' })
      return () => { cancelled = true }
    }
    if (!propertyId) {
      setState({ status: 'loading' })
      return () => { cancelled = true }
    }

    setState({ status: 'loading' })
    void Promise.all([
      runtime.hasPermission('shifts.view'),
      runtime.hasPermission('shifts.manage'),
      runtime.hasPermission('shifts.requests.manage'),
    ]).then(async ([view, manage, manageRequests]) => {
      if (cancelled) return
      if (!view) {
        setState({ status: 'forbidden' })
        return
      }
      const live = await loadLiveShiftData(supabase, propertyId, propertyName, month)
      if (cancelled) return
      if (live.property.units.length === 0) {
        setState({ status: 'empty' })
        return
      }
      const preferences = live.currentStaffProfileId ? await loadStaffShiftPreferences(supabase, propertyId, live.currentStaffProfileId) : undefined
      const rawInbox = manageRequests || live.currentStaffProfileId ? await loadShiftRequestInbox(supabase, propertyId) : { absences: [], preassignments: [], swaps: [] }
      const availableTeamMembers = manage ? await loadAvailableTeamMembers(supabase, propertyId) : []
      const personName = (id: string) => live.property.units.flatMap((unit) => unit.people).find((person) => person.id === id)?.name ?? 'Dipendente'
      const requestInbox = [
        ...(manageRequests ? rawInbox.absences.map((item: ShiftAbsenceInboxRow) => ({ id: item.id, kind: 'absences' as const, planningUnitId: item.planning_unit_id, staffProfileId: item.staff_profile_id, status: item.status, date: item.starts_on, label: item.absence_kind === 'leave' ? 'Ferie' : item.absence_kind === 'permission' ? 'Permesso' : item.absence_kind === 'illness' ? 'Malattia' : 'Assenza', note: item.note })) : []),
        ...(manageRequests ? rawInbox.preassignments.map((item: ShiftPreassignmentInboxRow) => ({ id: item.id, kind: 'preassignments' as const, planningUnitId: item.planning_unit_id, staffProfileId: item.staff_profile_id, status: item.status, date: item.shift_date, label: `Pre-assegnazione ${Array.isArray(item.shift_codes) ? item.shift_codes[0]?.code ?? '' : item.shift_codes?.code ?? ''}`, note: item.note })) : []),
        ...rawInbox.swaps.filter((item: ShiftSwapInboxRow) => manageRequests || item.target_staff_profile_id === live.currentStaffProfileId).map((item: ShiftSwapInboxRow) => ({ id: item.id, kind: 'swaps' as const, planningUnitId: item.planning_unit_id, staffProfileId: item.requester_staff_profile_id, targetStaffProfileId: item.target_staff_profile_id ?? undefined, status: item.status, label: `Cambio turno · ${personName(item.requester_staff_profile_id)} → ${item.target_staff_profile_id ? personName(item.target_staff_profile_id) : 'Da assegnare'}`, note: item.note })),
      ]
      if (cancelled) return
      setState({ status: 'ready', property: live.property, capabilities: { view, manage, manageRequests }, currentStaffProfileId: live.currentStaffProfileId, preferences, requestInbox, availableTeamMembers })
    }).catch((cause) => {
      console.error('ShiftPlannerPage: live data load failed', cause)
      if (!cancelled) setState({ status: 'error' })
    })
    return () => { cancelled = true }
  }, [entitled, propertyId, propertyName, runtime.hasPermission, month, requestRevision])

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
  }} onSaveStaffPlanning={async ({ staffProfileId, restMode, restDays }) => {
    if (!propertyId) throw new Error('Missing active property')
    await saveStaffRestSettings(supabase, propertyId, staffProfileId, restMode, restDays)
  }} availableTeamMembers={readyState.availableTeamMembers} onAddStaffMember={async ({ profileId, planningUnitId }) => {
    if (!propertyId) throw new Error('Missing active property')
    return addStaffMember(supabase, propertyId, profileId, planningUnitId)
  }} onSaveRules={async ({ planningUnitId, coverage, hard, soft, restRotationPairsPerCycle, roleCodes }) => {
    if (!propertyId) throw new Error('Missing active property')
    const unit = readyState.property.units.find((candidate) => candidate.id === planningUnitId)
    if (!unit) throw new Error('Unknown planning unit')
    await saveRuleSet(supabase, propertyId, unit, { coverage, hard, soft, restRotationPairsPerCycle, roleCodes })
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
  }} onGenerateAssignments={async (planningUnitId) => {
    if (!propertyId || !profileId) throw new Error('Missing active property/profile')
    const unit = readyState.property.units.find((candidate) => candidate.id === planningUnitId)
    if (!unit) throw new Error('Unknown planning unit')
    return generateUnitAssignments(supabase, propertyId, profileId, unit)
  }} onSetShiftLocked={async (planningUnitId, staffProfileId, shiftDate, locked) => {
    if (!propertyId) throw new Error('Missing active property')
    await setShiftLocked(supabase, propertyId, planningUnitId, staffProfileId, shiftDate, locked)
  }} onSaveUnit={async (input) => {
    if (!propertyId) throw new Error('Missing active property')
    return saveUnit(supabase, propertyId, input)
  }} onArchiveUnit={async (unitId) => {
    if (!propertyId) throw new Error('Missing active property')
    await archiveUnit(supabase, propertyId, unitId)
  }} onRestoreUnit={async (unitId) => {
    if (!propertyId) throw new Error('Missing active property')
    await restoreUnit(supabase, propertyId, unitId)
  }} />
}
