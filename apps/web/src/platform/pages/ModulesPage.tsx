import { useCallback, useEffect, useMemo, useState } from 'react'
import { ChevronDown, ChevronUp, Puzzle } from 'lucide-react'
import { PageHeader } from '@homisuite/ui'
import { supabase } from '../../core/client'
import { PageState } from '../../components/PageState'
import { MODULE_CATALOG, type ModuleStatus } from '../../pages/ModulesPage'
import { usePlatformContext } from '../PlatformContext'

type ModuleRow = { id: string; slug: string; display_name: string; status: ModuleStatus }
type TestingAccessRow = { property_id: string; property_name: string; organization_name: string; testing_access: boolean }

const STATUS_OPTIONS: Array<{ value: ModuleStatus; label: string }> = [
  { value: 'in_development', label: 'In sviluppo' },
  { value: 'testing', label: 'In collaudo' },
  { value: 'beta', label: 'Beta' },
  { value: 'active', label: 'Disponibile' },
  { value: 'deprecated', label: 'Deprecato' },
]

/**
 * The platform-wide counterpart to the tenant Moduli page: here a Platform
 * Admin sets a module's own rollout stage (which determines who even sees
 * it on that tenant page) and, for a module in collaudo, exactly which
 * properties are opted in -- the two things that page itself can only
 * display, never change.
 */
export function ModulesPage() {
  const runtime = usePlatformContext()
  const [modules, setModules] = useState<ModuleRow[]>([])
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading')
  const [savingId, setSavingId] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [testingAccess, setTestingAccess] = useState<Record<string, TestingAccessRow[]>>({})
  const [loadingAccessId, setLoadingAccessId] = useState<string | null>(null)

  // PlatformLayout only ever mounts this page once runtime.status is
  // 'ready', so the permission check alone is enough here.
  const canManage = runtime.hasPlatformPermission('platform.modules.manage')

  const load = useCallback(async () => {
    setState('loading')
    const { data, error } = await supabase.from('modules').select('id, slug, display_name, status').order('display_name')
    if (error) {
      console.error('platform ModulesPage', error)
      setState('error')
      return
    }
    setModules((data ?? []) as ModuleRow[])
    setState('ready')
  }, [])

  useEffect(() => { void load() }, [load])

  async function changeStatus(moduleId: string, status: ModuleStatus) {
    setActionError(null)
    setSavingId(moduleId)
    try {
      const { error } = await supabase.rpc('platform_set_module_status', { p_module_id: moduleId, p_status: status })
      if (error) throw error
      await load()
    } catch (cause) {
      setActionError(cause instanceof Error ? cause.message : 'Impossibile aggiornare lo stato del modulo.')
    } finally {
      setSavingId(null)
    }
  }

  async function loadTestingAccess(moduleId: string) {
    setLoadingAccessId(moduleId)
    setActionError(null)
    try {
      const { data, error } = await supabase.rpc('platform_list_module_testing_access', { p_module_id: moduleId })
      if (error) throw error
      setTestingAccess((prev) => ({ ...prev, [moduleId]: (data ?? []) as TestingAccessRow[] }))
    } catch (cause) {
      setActionError(cause instanceof Error ? cause.message : 'Impossibile caricare le strutture abilitate.')
    } finally {
      setLoadingAccessId(null)
    }
  }

  function toggleExpanded(moduleId: string) {
    const next = expandedId === moduleId ? null : moduleId
    setExpandedId(next)
    if (next && !testingAccess[next]) void loadTestingAccess(next)
  }

  async function toggleTestingAccess(moduleId: string, propertyId: string, enabled: boolean) {
    setActionError(null)
    try {
      const { error } = await supabase.rpc('platform_set_module_testing_access', { p_module_id: moduleId, p_property_id: propertyId, p_enabled: enabled })
      if (error) throw error
      setTestingAccess((prev) => ({
        ...prev,
        [moduleId]: (prev[moduleId] ?? []).map((row) => (row.property_id === propertyId ? { ...row, testing_access: enabled } : row)),
      }))
    } catch (cause) {
      setActionError(cause instanceof Error ? cause.message : 'Impossibile aggiornare la struttura abilitata.')
    }
  }

  const rows = useMemo(() => modules.map((module) => ({ module, meta: MODULE_CATALOG[module.slug] })), [modules])

  return (
    <div className="page-stack">
      <PageHeader title="Moduli" description="Stato di rilascio di ogni modulo e, per quelli in collaudo, le strutture abilitate a provarlo." />

      {state === 'loading' && <PageState kind="loading" title="Caricamento moduli…" />}
      {state === 'error' && (
        <PageState kind="error" title="Impossibile caricare i moduli." action={{ label: 'Riprova', onClick: () => void load() }} />
      )}
      {actionError ? <div className="shell-alert error" role="alert">{actionError}</div> : null}
      {!canManage && state === 'ready' ? (
        <div className="shell-alert" role="status">Il tuo profilo non ha il permesso platform.modules.manage: puoi vedere l'elenco ma non modificarlo.</div>
      ) : null}

      {state === 'ready' && (
        <div className="platform-module-list">
          {rows.map(({ module, meta }) => {
            const Icon = meta?.icon ?? Puzzle
            const isExpanded = expandedId === module.id
            const access = testingAccess[module.id] ?? []
            return (
              <article className="platform-module-row" key={module.id}>
                <div className="platform-module-row-main">
                  <div className="module-icon"><Icon size={18} /></div>
                  <div className="platform-module-row-copy">
                    <strong>{meta?.title ?? module.display_name}</strong>
                    <span>{meta?.description ?? 'Modulo Homisuite.'}</span>
                  </div>
                  <label className="platform-module-status-select">
                    <span className="sr-only">Stato di {meta?.title ?? module.display_name}</span>
                    <select
                      value={module.status}
                      disabled={!canManage || savingId === module.id}
                      onChange={(event) => void changeStatus(module.id, event.target.value as ModuleStatus)}
                    >
                      {STATUS_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                    </select>
                  </label>
                  {module.status === 'testing' ? (
                    <button type="button" className="platform-module-expand" onClick={() => toggleExpanded(module.id)} aria-expanded={isExpanded}>
                      Strutture abilitate {isExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                    </button>
                  ) : null}
                </div>
                {isExpanded && module.status === 'testing' ? (
                  <div className="platform-module-access-list">
                    {loadingAccessId === module.id && access.length === 0 ? (
                      <p className="platform-module-access-loading">Caricamento strutture…</p>
                    ) : (
                      access.map((row) => (
                        <label className="platform-module-access-row" key={row.property_id}>
                          <input
                            type="checkbox"
                            checked={row.testing_access}
                            disabled={!canManage}
                            onChange={(event) => void toggleTestingAccess(module.id, row.property_id, event.target.checked)}
                          />
                          <span>{row.property_name}</span>
                          <small>{row.organization_name}</small>
                        </label>
                      ))
                    )}
                  </div>
                ) : null}
              </article>
            )
          })}
        </div>
      )}
    </div>
  )
}
