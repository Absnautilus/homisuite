import { useCallback, useEffect, useMemo, useState } from 'react'
import { CalendarDays, CarFront, Hotel, Puzzle, UtensilsCrossed, type LucideIcon } from 'lucide-react'
import { supabase } from '../core/client'
import { useModuleRuntime } from '../core/ModuleRuntimeContext'
import { PageState } from '../components/PageState'

type ModuleRow = {
  id: string
  slug: string
  display_name: string
  status: 'active' | 'beta' | 'deprecated'
}

type PropertyModuleRow = {
  module_id: string
  enabled: boolean
}

const catalog: Record<string, { title: string; description: string; icon: LucideIcon }> = {
  guest_requests: {
    title: 'Housekeeping',
    description: 'Richieste ospiti, assegnazione operativa e gestione delle attività in camera.',
    icon: Hotel,
  },
  dining: {
    title: 'Ristorazione',
    description: 'Ristoranti, disponibilità e prenotazioni gestite dalla struttura.',
    icon: UtensilsCrossed,
  },
  shifts: {
    title: 'Turni',
    description: 'Pianificazione dei turni, coperture e organizzazione del personale.',
    icon: CalendarDays,
  },
  transfers: {
    title: 'Transfer',
    description: 'Organizzazione e tracciamento dei transfer e degli spostamenti degli ospiti.',
    icon: CarFront,
  },
}

export function ModulesPage() {
  const runtime = useModuleRuntime()
  const propertyId = runtime.property?.id ?? null
  const [registered, setRegistered] = useState<ModuleRow[]>([])
  const [propertyModules, setPropertyModules] = useState<PropertyModuleRow[]>([])
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading')

  const load = useCallback(async (propertyIdToLoad: string, isCancelled: () => boolean) => {
    setState('loading')
    const [modulesResult, entitlementsResult] = await Promise.all([
      supabase.from('modules').select('id, slug, display_name, status').order('display_name'),
      supabase.from('property_modules').select('module_id, enabled').eq('property_id', propertyIdToLoad),
    ])

    if (isCancelled()) return
    if (modulesResult.error || entitlementsResult.error) {
      console.error('ModulesPage', modulesResult.error ?? entitlementsResult.error)
      setState('error')
      return
    }

    setRegistered((modulesResult.data ?? []) as ModuleRow[])
    setPropertyModules((entitlementsResult.data ?? []) as PropertyModuleRow[])
    setState('ready')
  }, [])

  useEffect(() => {
    if (!propertyId) return
    let cancelled = false
    void load(propertyId, () => cancelled)
    return () => {
      cancelled = true
    }
  }, [propertyId, load])

  const enabledById = useMemo(
    () => new Map(propertyModules.map((item) => [item.module_id, item.enabled])),
    [propertyModules],
  )

  return (
    <div className="page-stack">
      <section className="page-heading">
        <p className="eyebrow">{runtime.property?.name}</p>
        <h1>Moduli</h1>
        <p className="page-subtitle">I moduli disponibili in Homisuite e quelli attivi per questa struttura.</p>
      </section>

      {state === 'loading' && <PageState kind="loading" title="Caricamento moduli…" />}
      {state === 'error' && (
        <PageState
          kind="error"
          title="Impossibile caricare i moduli."
          description="Riprova tra qualche istante. Se il problema continua, contatta l'assistenza."
          action={{ label: 'Riprova', onClick: () => { if (propertyId) void load(propertyId, () => false) } }}
        />
      )}

      {state === 'ready' && (
        <section className="module-grid">
          {registered.map((module) => {
            const meta = catalog[module.slug] ?? {
              title: module.display_name,
              description: 'Modulo Homisuite.',
              icon: Puzzle,
            }
            // Entitlement (this property's own property_modules row) and
            // lifecycle (the module's own rollout stage) are two different
            // questions -- a Beta module can be fully Attivo here, and an
            // Attivo module can still be Deprecato platform-wide. Kept as
            // two visually distinct labels so neither reads as the other.
            const enabled = enabledById.get(module.id) === true
            const lifecycleLabel = module.status === 'beta' ? 'Beta' : module.status === 'deprecated' ? 'Deprecato' : 'Disponibile'
            const lifecycleClass = module.status === 'beta' ? 'module-lifecycle is-beta' : module.status === 'deprecated' ? 'module-lifecycle is-deprecated' : 'module-lifecycle'
            const Icon = meta.icon

            return (
              <article className="module-card" key={module.id}>
                <div className="module-card-top">
                  <div className="module-icon"><Icon size={20} /></div>
                  <span className={enabled ? 'status-pill status-pill-ok' : 'status-pill'}>
                    {enabled ? 'Attivo' : 'Non attivo'}
                  </span>
                </div>
                <div>
                  <h2>{meta.title}</h2>
                  <p>{meta.description}</p>
                </div>
                <p className={lifecycleClass}>{lifecycleLabel}</p>
              </article>
            )
          })}
        </section>
      )}

      <section className="attention-card">
        <div>
          <p className="eyebrow">Disponibilità</p>
          <h2>Configurazione della struttura</h2>
          <p>L'attivazione dei moduli è gestita a livello di struttura e resta separata dai permessi dei singoli membri del team.</p>
        </div>
      </section>
    </div>
  )
}
