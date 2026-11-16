import { useCallback, useEffect, useMemo, useState } from 'react'
import { ChevronDown, ChevronUp, Puzzle } from 'lucide-react'
import { Button, PageHeader, Toggle } from '@homisuite/ui'
import { supabase } from '../../core/client'
import { PageState } from '../../components/PageState'
import { Select } from '../../components/Select'
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
 * display, never change. Every row is a draft until "Salva": nothing is
 * written until the admin explicitly commits it, so skimming through
 * statuses or toggles never changes anything by accident.
 */
export function ModulesPage() {
  const runtime = usePlatformContext()
  const [modules, setModules] = useState<ModuleRow[]>([])
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading')
  const [saving, setSaving] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [testingAccess, setTestingAccess] = useState<Record<string, TestingAccessRow[]>>({})
  const [loadingAccessId, setLoadingAccessId] = useState<string | null>(null)
  const [draftStatus, setDraftStatus] = useState<Record<string, ModuleStatus>>({})
  const [draftAccess, setDraftAccess] = useState<Record<string, Record<string, boolean>>>({})

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
    const rows = (data ?? []) as ModuleRow[]
    setModules(rows)
    setDraftStatus(Object.fromEntries(rows.map((module) => [module.id, module.status])))
    setState('ready')
  }, [])

  useEffect(() => { void load() }, [load])

  async function loadTestingAccess(moduleId: string) {
    setLoadingAccessId(moduleId)
    setActionError(null)
    try {
      const { data, error } = await supabase.rpc('platform_list_module_testing_access', { p_module_id: moduleId })
      if (error) throw error
      const rows = (data ?? []) as TestingAccessRow[]
      setTestingAccess((prev) => ({ ...prev, [moduleId]: rows }))
      setDraftAccess((prev) => ({ ...prev, [moduleId]: Object.fromEntries(rows.map((row) => [row.property_id, row.testing_access])) }))
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

  function hasPendingChanges(module: ModuleRow): boolean {
    if (draftStatus[module.id] !== module.status) return true
    const originalAccess = testingAccess[module.id]
    const draft = draftAccess[module.id]
    if (!originalAccess || !draft) return false
    return originalAccess.some((row) => draft[row.property_id] !== row.testing_access)
  }

  const rows = useMemo(() => modules.map((module) => ({ module, meta: MODULE_CATALOG[module.slug] })), [modules])
  // Not memoized: hasPendingChanges itself closes over state that changes
  // every render, so memoizing this would need the same deps anyway -- the
  // module list is short enough that recomputing it plainly is simpler.
  const dirtyModules = modules.filter(hasPendingChanges)

  // One save for the whole page, at the bottom, instead of a button per
  // row: an admin reclassifying several modules at once reviews everything
  // first, then commits it all in a single action.
  async function saveAll() {
    setActionError(null)
    setSaving(true)
    try {
      for (const module of dirtyModules) {
        const nextStatus = draftStatus[module.id]
        if (nextStatus !== module.status) {
          const { error } = await supabase.rpc('platform_set_module_status', { p_module_id: module.id, p_status: nextStatus })
          if (error) throw error
        }
        const originalAccess = testingAccess[module.id] ?? []
        const draft = draftAccess[module.id] ?? {}
        for (const row of originalAccess) {
          if (draft[row.property_id] === row.testing_access) continue
          const { error } = await supabase.rpc('platform_set_module_testing_access', {
            p_module_id: module.id, p_property_id: row.property_id, p_enabled: draft[row.property_id],
          })
          if (error) throw error
        }
      }
      await load()
      await Promise.all(dirtyModules.filter((module) => testingAccess[module.id]).map((module) => loadTestingAccess(module.id)))
    } catch (cause) {
      setActionError(cause instanceof Error ? cause.message : 'Impossibile salvare le modifiche.')
    } finally {
      setSaving(false)
    }
  }

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
            const draftModuleAccess = draftAccess[module.id] ?? {}
            const pending = hasPendingChanges(module)
            return (
              <article className={`platform-module-row${pending ? ' is-dirty' : ''}`} key={module.id}>
                <div className="platform-module-row-main">
                  <div className="module-icon"><Icon size={18} /></div>
                  <div className="platform-module-row-copy">
                    <strong>{meta?.title ?? module.display_name}</strong>
                    <span>{meta?.description ?? 'Modulo Homisuite.'}</span>
                  </div>
                  <Select
                    name={`module-status-${module.id}`}
                    value={draftStatus[module.id] ?? module.status}
                    disabled={!canManage || saving}
                    onChange={(next) => setDraftStatus((prev) => ({ ...prev, [module.id]: next as ModuleStatus }))}
                  >
                    {STATUS_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                  </Select>
                  {(draftStatus[module.id] ?? module.status) === 'testing' ? (
                    <button type="button" className="platform-module-expand" onClick={() => toggleExpanded(module.id)} aria-expanded={isExpanded}>
                      Strutture abilitate {isExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                    </button>
                  ) : null}
                  {pending ? <span className="platform-module-dirty-badge">Modificato</span> : null}
                </div>
                {isExpanded && (draftStatus[module.id] ?? module.status) === 'testing' ? (
                  <div className="platform-module-access-list">
                    {loadingAccessId === module.id && access.length === 0 ? (
                      <p className="platform-module-access-loading">Caricamento strutture…</p>
                    ) : (
                      access.map((row) => (
                        <div className="platform-module-access-row" key={row.property_id}>
                          <Toggle
                            checked={draftModuleAccess[row.property_id] ?? row.testing_access}
                            disabled={!canManage || saving}
                            onCheckedChange={(checked) => setDraftAccess((prev) => ({
                              ...prev,
                              [module.id]: { ...(prev[module.id] ?? {}), [row.property_id]: checked },
                            }))}
                            aria-label={`Abilita ${row.property_name} al collaudo`}
                          />
                          <span>{row.property_name}</span>
                          <small>{row.organization_name}</small>
                        </div>
                      ))
                    )}
                  </div>
                ) : null}
              </article>
            )
          })}
          <div className="platform-module-save-bar">
            <span>{dirtyModules.length === 0 ? 'Nessuna modifica da salvare.' : `${dirtyModules.length} ${dirtyModules.length === 1 ? 'modulo modificato' : 'moduli modificati'}.`}</span>
            <Button variant="primary" disabled={!canManage || dirtyModules.length === 0 || saving} onClick={() => void saveAll()}>
              {saving ? 'Salvataggio…' : 'Salva modifiche'}
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
