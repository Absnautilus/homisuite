import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import type { PlatformOrganization } from '@homisuite/core-sdk'
import { core } from '../../core/client'
import { PageState } from '../../components/PageState'

export function OrganizationsPage() {
  const navigate = useNavigate()
  const [organizations, setOrganizations] = useState<PlatformOrganization[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    core.getPlatformOrganizations()
      .then((result) => { if (!cancelled) setOrganizations(result) })
      .catch((cause) => { if (!cancelled) setError(cause instanceof Error ? cause.message : 'Errore sconosciuto') })
    return () => { cancelled = true }
  }, [])

  return (
    <>
      <h1>Organizzazioni</h1>
      <p className="muted">Tutte le organizzazioni clienti registrate su Homisuite.</p>
      {error ? <PageState kind="error" title="Impossibile caricare le organizzazioni." description={error} /> : null}
      {!error && !organizations ? <PageState kind="loading" title="Caricamento…" /> : null}
      {organizations && organizations.length === 0 ? <PageState kind="empty" title="Nessuna organizzazione registrata." /> : null}
      {organizations && organizations.length > 0 ? (
        <table className="platform-table">
          <thead>
            <tr><th>Nome</th><th>Slug</th><th>Creata il</th></tr>
          </thead>
          <tbody>
            {organizations.map((organization) => (
              <tr key={organization.id} className="clickable" onClick={() => navigate(`/admin/organizations/${organization.id}`)}>
                <td>{organization.name}</td>
                <td>{organization.slug}</td>
                <td>{new Date(organization.createdAt).toLocaleDateString('it-IT')}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
    </>
  )
}
