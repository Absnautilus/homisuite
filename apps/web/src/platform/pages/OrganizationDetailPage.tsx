import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import type { PlatformOrganization, PlatformProperty } from '@homisuite/core-sdk'
import { core } from '../../core/client'
import { PageState } from '../../components/PageState'
import { usePlatformContext } from '../PlatformContext'

export function OrganizationDetailPage() {
  const { organizationId } = useParams<{ organizationId: string }>()
  const navigate = useNavigate()
  const { selectedOrganization, selectOrganization } = usePlatformContext()
  const [organizations, setOrganizations] = useState<PlatformOrganization[] | null>(null)
  const [properties, setProperties] = useState<PlatformProperty[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  // The organization list call also resolves this page's own breadcrumb
  // name -- platform_list_organizations() is the only RPC that returns it,
  // and re-fetching it here (rather than requiring it be passed via router
  // state) keeps this page correct on a direct deep link too.
  useEffect(() => {
    if (!organizationId) return
    let cancelled = false
    setError(null)
    setProperties(null)
    Promise.all([core.getPlatformOrganizations(), core.getPlatformProperties(organizationId)])
      .then(([orgs, props]) => {
        if (cancelled) return
        setOrganizations(orgs)
        setProperties(props)
        selectOrganization(orgs.find((org) => org.id === organizationId) ?? null)
      })
      .catch((cause) => { if (!cancelled) setError(cause instanceof Error ? cause.message : 'Errore sconosciuto') })
    return () => { cancelled = true }
  }, [organizationId, selectOrganization])

  const organizationName = organizations?.find((org) => org.id === organizationId)?.name ?? selectedOrganization?.name

  if (!organizationId) return null

  return (
    <>
      <p className="platform-breadcrumb">
        <button type="button" onClick={() => navigate('/admin')}>Organizzazioni</button> / {organizationName ?? '…'}
      </p>
      <h1>{organizationName ?? 'Organizzazione'}</h1>
      <p className="muted">Proprietà appartenenti a questa organizzazione.</p>
      {error ? <PageState kind="error" title="Impossibile caricare le proprietà." description={error} /> : null}
      {!error && !properties ? <PageState kind="loading" title="Caricamento…" /> : null}
      {properties && properties.length === 0 ? <PageState kind="empty" title="Nessuna proprietà per questa organizzazione." /> : null}
      {properties && properties.length > 0 ? (
        <table className="platform-table">
          <thead>
            <tr><th>Nome</th><th>Stato</th><th>Fuso orario</th></tr>
          </thead>
          <tbody>
            {properties.map((property) => (
              <tr key={property.id} className="clickable" onClick={() => navigate(`/admin/organizations/${organizationId}/properties/${property.id}`)}>
                <td>{property.name}</td>
                <td><span className="platform-badge">{property.status}</span></td>
                <td>{property.timezone}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
    </>
  )
}
