import { useCallback, useEffect, useMemo, useState } from 'react'
import { PageHeader, Toggle } from '@homisuite/ui'
import { CalendarDays, CarFront, Hotel, Mail, Puzzle, Settings, UtensilsCrossed, type LucideIcon } from 'lucide-react'
import { Link } from 'react-router-dom'
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

const catalog: Record<string, { title: string; description: string; icon: LucideIcon; path: string; settingsPath?: string }> = {
  guest_requests: {
    title: 'Housekeeping',
    description: 'Richieste ospiti, assegnazione operativa e gestione delle attività in camera.',
    icon: Hotel,
    path: '/housekeeping',
  },
  dining: {
    title: 'Ristorazione',
    description: 'Ristoranti, disponibilità e prenotazioni gestite dalla struttura.',
    icon: UtensilsCrossed,
    path: '/dining',
    settingsPath: '/dining?tab=impostazioni',
  },
  shifts: {
    title: 'Turni',
    description: 'Pianificazione dei turni, coperture e organizzazione del personale.',
    icon: CalendarDays,
    path: '/turni',
  },
  transfers: {
    title: 'Transfer',
    description: 'Organizzazione e tracciamento dei transfer e degli spostamenti degli ospiti.',
    icon: CarFront,
    path: '/transfer',
  },
  smart_inbox: {
    title: 'Smart Inbox',
    description: 'Le email degli ospiti da Outlook, con bozze di risposta preparate dall\'assistente sulle informazioni della struttura.',
    icon: Mail,
    path: '/smart-inbox',
    settingsPath: '/smart-inbox?tab=impostazioni',
  },
}

export function ModulesPage() {
  const runtime = useModuleRuntime()
  const propertyId = runtime.property?.id ?? null
  const [registered, setRegistered] = useState<ModuleRow[]>([])
  const [propertyModules, setPropertyModules] = useState<PropertyModuleRow[]>([])
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading')
  const [savingId, setSavingId] = useState<string | null>(null)
  const [toggleError, setToggleError] = useState<string | null>(null)

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

  async function toggleModule(moduleId: string, nextEnabled: boolean) {
    if (!propertyId) return
    setToggleError(null)
    setSavingId(moduleId)
    try {
      const { error } = await supabase.rpc('set_property_module_enabled', {
        p_property_id: propertyId,
        p_module_id: moduleId,
        p_enabled: nextEnabled,
      })
      if (error) throw error
      await Promise.all([load(propertyId, () => false), runtime.refresh()])
    } catch (cause) {
      setToggleError(cause instanceof Error ? cause.message : 'Impossibile aggiornare il modulo.')
    } finally {
      setSavingId(null)
    }
  }

  return (
    <div className="page-stack">
      <PageHeader eyebrow={runtime.property?.name} title="Moduli" description="I moduli disponibili in Homisuite e quelli attivi per questa struttura." />

      {state === 'loading' && <PageState kind="loading" title="Caricamento moduli…" />}
      {state === 'error' && (
        <PageState
          kind="error"
          title="Impossibile caricare i moduli."
          description="Riprova tra qualche istante. Se il problema continua, contatta l'assistenza."
          action={{ label: 'Riprova', onClick: () => { if (propertyId) void load(propertyId, () => false) } }}
        />
      )}

      {toggleError ? <div className="shell-alert error" role="alert">{toggleError}</div> : null}

      {state === 'ready' && (
        <section className="module-grid" data-tour="modules-list">
          {registered.map((module) => {
            const meta = catalog[module.slug] ?? {
              title: module.display_name,
              description: 'Modulo Homisuite.',
              icon: Puzzle,
              path: '/',
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
                <div className="module-card-footer">
                  <label className="module-card-toggle">
                    <Toggle
                      checked={enabled}
                      onCheckedChange={(next) => void toggleModule(module.id, next)}
                      disabled={savingId === module.id}
                      aria-label={enabled ? `Disattiva ${meta.title}` : `Attiva ${meta.title}`}
                    />
                    <span>{enabled ? 'Attivo' : 'Non attivo'}</span>
                  </label>
                  {enabled ? (
                    <Link
                      className="module-card-settings"
                      to={meta.settingsPath ?? meta.path}
                      aria-label={`Impostazioni ${meta.title}`}
                      title={`Impostazioni ${meta.title}`}
                    >
                      <Settings size={16} />
                    </Link>
                  ) : null}
                </div>
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
