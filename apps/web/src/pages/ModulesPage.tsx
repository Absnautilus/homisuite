import { useEffect, useMemo, useState } from 'react'
import { CalendarDays, Hotel, UtensilsCrossed, Wrench, type LucideIcon } from 'lucide-react'
import { supabase } from '../core/client'
import { useModuleRuntime } from '../core/ModuleRuntimeContext'

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
    icon: Wrench,
  },
}

export function ModulesPage() {
  const runtime = useModuleRuntime()
  const propertyId = runtime.property?.id ?? null
  const [registered, setRegistered] = useState<ModuleRow[]>([])
  const [propertyModules, setPropertyModules] = useState<PropertyModuleRow[]>([])
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading')

  useEffect(() => {
    if (!propertyId) return
    const resolvedPropertyId = propertyId
    let cancelled = false

    async function load() {
      setState('loading')
      const [modulesResult, entitlementsResult] = await Promise.all([
        supabase.from('modules').select('id, slug, display_name, status').order('display_name'),
        supabase.from('property_modules').select('module_id, enabled').eq('property_id', resolvedPropertyId),
      ])

      if (cancelled) return
      if (modulesResult.error || entitlementsResult.error) {
        setState('error')
        return
      }

      setRegistered((modulesResult.data ?? []) as ModuleRow[])
      setPropertyModules((entitlementsResult.data ?? []) as PropertyModuleRow[])
      setState('ready')
    }

    void load()
    return () => {
      cancelled = true
    }
  }, [propertyId])

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

      {state === 'loading' && <section className="empty-state"><span>Caricamento moduli…</span></section>}
      {state === 'error' && <section className="empty-state"><span>Impossibile caricare i moduli.</span></section>}

      {state === 'ready' && (
        <section className="module-grid">
          {registered.map((module) => {
            const meta = catalog[module.slug] ?? {
              title: module.display_name,
              description: 'Modulo Homisuite.',
              icon: Wrench,
            }
            const enabled = enabledById.get(module.id) === true
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
                <p className="eyebrow">{module.status === 'beta' ? 'Beta' : module.status === 'deprecated' ? 'Deprecato' : 'Disponibile'}</p>
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
