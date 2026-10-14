import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import type { PlatformProperty, PlatformPropertyModule } from '@homisuite/core-sdk'
import { core } from '../../core/client'
import { PageState } from '../../components/PageState'
import { usePlatformContext } from '../PlatformContext'

export function PropertyDetailPage() {
  const { organizationId, propertyId } = useParams<{ organizationId: string; propertyId: string }>()
  const navigate = useNavigate()
  const { selectedOrganization, selectProperty } = usePlatformContext()
  const [properties, setProperties] = useState<PlatformProperty[] | null>(null)
  const [modules, setModules] = useState<PlatformPropertyModule[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!organizationId || !propertyId) return
    let cancelled = false
    setError(null)
    setModules(null)
    Promise.all([core.getPlatformProperties(organizationId), core.getPlatformPropertyModules(propertyId)])
      .then(([props, mods]) => {
        if (cancelled) return
        setProperties(props)
        setModules(mods)
        selectProperty(props.find((property) => property.id === propertyId) ?? null)
      })
      .catch((cause) => { if (!cancelled) setError(cause instanceof Error ? cause.message : 'Errore sconosciuto') })
    return () => { cancelled = true }
  }, [organizationId, propertyId, selectProperty])

  const propertyName = properties?.find((property) => property.id === propertyId)?.name

  if (!organizationId || !propertyId) return null

  return (
    <>
      <p className="platform-breadcrumb">
        <button type="button" onClick={() => navigate('/admin')}>Organizzazioni</button>
        {' / '}
        <button type="button" onClick={() => navigate(`/admin/organizations/${organizationId}`)}>{selectedOrganization?.name ?? '…'}</button>
        {' / '}{propertyName ?? '…'}
      </p>
      <h1>{propertyName ?? 'Proprietà'}</h1>
      <p className="muted">Moduli abilitati per questa proprietà.</p>
      {error ? <PageState kind="error" title="Impossibile caricare i moduli." description={error} /> : null}
      {!error && !modules ? <PageState kind="loading" title="Caricamento…" /> : null}
      {modules && modules.length === 0 ? <PageState kind="empty" title="Nessun modulo registrato." /> : null}
      {modules && modules.length > 0 ? (
        <table className="platform-table">
          <thead>
            <tr><th>Modulo</th><th>Stato</th></tr>
          </thead>
          <tbody>
            {modules.map((module) => (
              <tr key={module.moduleId}>
                <td>{module.displayName}</td>
                <td><span className={`platform-badge${module.enabled ? ' enabled' : ''}`}>{module.enabled ? 'Abilitato' : 'Disabilitato'}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
    </>
  )
}
