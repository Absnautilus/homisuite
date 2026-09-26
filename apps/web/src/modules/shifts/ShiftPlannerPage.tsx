import { useEffect, useState } from 'react'
import { ShiftPlannerModule, type ShiftPlannerCapabilities, type ShiftPreviewProperty } from '@homisuite/shifts-module'
import '@homisuite/shifts-module/style.css'
import { PageState } from '../../components/PageState'
import { supabase } from '../../core/client'
import { useModuleRuntime } from '../../core/ModuleRuntimeContext'
import { loadLiveShiftData } from './shiftLiveData'
import { saveShiftAssignments } from './saveShiftAssignments'
import { saveMemberOrder } from './saveMemberOrder'
import { saveRuleSet } from './saveRuleSet'
import { setUnitRestDays } from './saveRestDays'
import { saveShiftCode, deleteOrArchiveShiftCode } from './saveShiftCode'
import { setMonthStatus } from './saveMonthStatus'
import { generateUnitAssignments } from './generateAssignments'
import { saveUnit, archiveUnit } from './saveUnit'

type State =
  | { status: 'loading' }
  | { status: 'ready'; property: ShiftPreviewProperty; capabilities: ShiftPlannerCapabilities }
  | { status: 'not-entitled' | 'forbidden' | 'empty' | 'error' }

export function ShiftPlannerPage() {
  const runtime = useModuleRuntime()
  const propertyId = runtime.property?.id ?? null
  const propertyName = runtime.property?.name ?? 'Struttura'
  const entitled = runtime.entitlements.some((item) => item.enabled && item.slug === 'shifts')
  const [state, setState] = useState<State>({ status: 'loading' })

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
      const live = await loadLiveShiftData(supabase, propertyId, propertyName)
      if (cancelled) return
      if (live.property.units.length === 0) {
        setState({ status: 'empty' })
        return
      }
      setState({ status: 'ready', property: live.property, capabilities: { view, manage, manageRequests } })
    }).catch((cause) => {
      console.error('ShiftPlannerPage: live data load failed', cause)
      if (!cancelled) setState({ status: 'error' })
    })
    return () => { cancelled = true }
  }, [entitled, propertyId, propertyName, runtime.hasPermission])

  if (state.status === 'loading') return <PageState kind="loading" title="Caricamento Turni…" />
  if (state.status === 'not-entitled') return <PageState kind="unavailable" title="Turni non è abilitato per questa struttura." />
  if (state.status === 'forbidden') return <PageState kind="unavailable" title="Non hai accesso al modulo Turni per questa struttura." />
  if (state.status === 'empty') return <PageState kind="empty" title="Turni non è ancora configurato." description="Crea almeno un’unità di pianificazione per iniziare." />
  if (state.status === 'error') return <PageState kind="error" title="Impossibile caricare Turni." description="Riprova tra qualche istante." action={{ label: 'Ricarica', onClick: () => window.location.reload() }} />

  if (state.status !== 'ready') return null

  const readyState = state
  const profileId = runtime.profile?.id
  return <ShiftPlannerModule initialPropertyId={readyState.property.id} previewProperties={[readyState.property]} capabilities={readyState.capabilities} onSaveAssignments={async (changes) => {
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
  }} onSaveUnit={async (input) => {
    if (!propertyId) throw new Error('Missing active property')
    return saveUnit(supabase, propertyId, input)
  }} onArchiveUnit={async (unitId) => {
    if (!propertyId) throw new Error('Missing active property')
    await archiveUnit(supabase, propertyId, unitId)
  }} />
}
