import { useEffect, useState } from 'react'
import type { PlatformAuditLogEntry, PlatformPropertyOption } from '@homisuite/core-sdk'
import { core } from '../../core/client'
import { PageState } from '../../components/PageState'
import { Select } from '../../components/Select'

const ACTION_LABELS: Record<string, string> = {
  'platform.console_accessed': 'Accesso alla console',
  'platform.organization_viewed': 'Organizzazione consultata',
  'platform.property_viewed': 'Proprietà consultata',
  'platform.operational_session_opened': 'Vista operativa aperta',
  'platform.operational_session_closed': 'Vista operativa chiusa',
  'platform.operational_session_revoked': 'Vista operativa revocata',
  'platform.operational_view_accessed': 'Modulo operativo consultato',
}

const ALL_PROPERTIES = '__all__'

/**
 * `propertyFilter` also drives PropertyDetailPage's own "Archivio" section,
 * which renders this same component pinned to one property (no picker, no
 * "every property" option) -- see that file's own usage.
 */
export function AuditLogPage({ propertyId, title = 'Registro attività', description }: { propertyId?: string; title?: string; description?: string }) {
  const [entries, setEntries] = useState<PlatformAuditLogEntry[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [properties, setProperties] = useState<PlatformPropertyOption[]>([])
  const [propertyFilter, setPropertyFilter] = useState(propertyId ?? ALL_PROPERTIES)

  useEffect(() => {
    if (propertyId) return // pinned by the caller -- no picker, nothing to load
    let cancelled = false
    core.getPlatformAllProperties()
      .then((result) => { if (!cancelled) setProperties(result) })
      .catch(() => { /* the picker just stays empty; the log itself still loads */ })
    return () => { cancelled = true }
  }, [propertyId])

  useEffect(() => {
    let cancelled = false
    setEntries(null)
    core.getPlatformAuditLog(100, 0, propertyFilter === ALL_PROPERTIES ? undefined : propertyFilter)
      .then((result) => { if (!cancelled) setEntries(result) })
      .catch((cause) => { if (!cancelled) setError(cause instanceof Error ? cause.message : 'Errore sconosciuto') })
    return () => { cancelled = true }
  }, [propertyFilter])

  return (
    <>
      <div className="platform-page-head">
        <div>
          <h1>{title}</h1>
          <p className="muted">{description ?? 'Ultime 100 operazioni registrate sulla console Platform Admin.'}</p>
        </div>
        {!propertyId ? (
          <Select name="audit-property-filter" value={propertyFilter} onChange={setPropertyFilter}>
            <option value={ALL_PROPERTIES}>Tutte le strutture</option>
            {properties.map((property) => <option key={property.id} value={property.id}>{property.name} · {property.organizationName}</option>)}
          </Select>
        ) : null}
      </div>
      {error ? <PageState kind="error" title="Impossibile caricare il registro." description={error} /> : null}
      {!error && !entries ? <PageState kind="loading" title="Caricamento…" /> : null}
      {entries && entries.length === 0 ? <PageState kind="empty" title="Nessuna attività registrata." /> : null}
      {entries && entries.length > 0 ? (
        <table className="platform-table">
          <thead>
            <tr><th>Quando</th><th>Chi</th><th>Azione</th><th>Struttura</th><th>Dettaglio</th></tr>
          </thead>
          <tbody>
            {entries.map((entry) => (
              <tr key={entry.id}>
                <td>{new Date(entry.createdAt).toLocaleString('it-IT')}</td>
                <td>{entry.actorFullName ?? '—'}</td>
                <td>{ACTION_LABELS[entry.action] ?? entry.action}</td>
                <td>{entry.propertyName ?? '—'}</td>
                <td>{entry.targetType ? `${entry.targetType} · ${entry.targetId}` : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
    </>
  )
}
