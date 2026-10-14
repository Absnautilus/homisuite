import { useEffect, useState } from 'react'
import type { PlatformAuditLogEntry } from '@homisuite/core-sdk'
import { core } from '../../core/client'
import { PageState } from '../../components/PageState'

const ACTION_LABELS: Record<string, string> = {
  'platform.console_accessed': 'Accesso alla console',
  'platform.organization_viewed': 'Organizzazione consultata',
  'platform.property_viewed': 'Proprietà consultata',
}

export function AuditLogPage() {
  const [entries, setEntries] = useState<PlatformAuditLogEntry[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    core.getPlatformAuditLog(100, 0)
      .then((result) => { if (!cancelled) setEntries(result) })
      .catch((cause) => { if (!cancelled) setError(cause instanceof Error ? cause.message : 'Errore sconosciuto') })
    return () => { cancelled = true }
  }, [])

  return (
    <>
      <h1>Registro attività</h1>
      <p className="muted">Ultime 100 operazioni registrate sulla console Platform Admin.</p>
      {error ? <PageState kind="error" title="Impossibile caricare il registro." description={error} /> : null}
      {!error && !entries ? <PageState kind="loading" title="Caricamento…" /> : null}
      {entries && entries.length === 0 ? <PageState kind="empty" title="Nessuna attività registrata." /> : null}
      {entries && entries.length > 0 ? (
        <table className="platform-table">
          <thead>
            <tr><th>Quando</th><th>Chi</th><th>Azione</th><th>Dettaglio</th></tr>
          </thead>
          <tbody>
            {entries.map((entry) => (
              <tr key={entry.id}>
                <td>{new Date(entry.createdAt).toLocaleString('it-IT')}</td>
                <td>{entry.actorFullName ?? '—'}</td>
                <td>{ACTION_LABELS[entry.action] ?? entry.action}</td>
                <td>{entry.targetType ? `${entry.targetType} · ${entry.targetId}` : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
    </>
  )
}
