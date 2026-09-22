import { useEffect, useState } from 'react'
import { ShiftPlannerModule, type ShiftPlannerCapabilities, type ShiftPreviewProperty } from '@homisuite/shifts-module'
import '@homisuite/shifts-module/style.css'
import { PageState } from '../../components/PageState'
import { supabase } from '../../core/client'
import { useModuleRuntime } from '../../core/ModuleRuntimeContext'
import { loadLiveShiftData } from './shiftLiveData'

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

  return <ShiftPlannerModule initialPropertyId={state.property.id} previewProperties={[state.property]} capabilities={state.capabilities} />
}
