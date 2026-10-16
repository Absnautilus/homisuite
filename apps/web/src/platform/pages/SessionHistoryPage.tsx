import { useCallback, useEffect, useState } from 'react'
import { ShieldOff } from 'lucide-react'
import { Button } from '@homisuite/ui'
import type { PlatformOperationalSessionRecord } from '@homisuite/core-sdk'
import { core } from '../../core/client'
import { PageState } from '../../components/PageState'
import { useConfirm } from '../../components/ConfirmDialog'
import { usePlatformContext } from '../PlatformContext'

const STATUS_LABELS: Record<PlatformOperationalSessionRecord['status'], string> = {
  active: 'Attiva',
  closed: 'Chiusa',
  expired: 'Scaduta',
  revoked: 'Revocata',
}

// Fase C, PR C4 -- the session-history view the "evaluation of remote
// revocation UX" item asked for. Lists every admin's operational sessions
// (platform.audit.read, not platform.support.read -- see
// platform_list_operational_sessions's own doc comment for why), and lets
// an admin holding platform.admins.manage revoke another admin's still-
// active session from here -- the same platform_revoke_operational_session
// RPC already built and tested in C1, previously reachable only by a
// direct RPC call with no console path to it.
export function SessionHistoryPage() {
  const { hasPlatformPermission } = usePlatformContext()
  const [sessions, setSessions] = useState<PlatformOperationalSessionRecord[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [revokingId, setRevokingId] = useState<string | null>(null)
  const [confirmDialog, confirm] = useConfirm()
  const canRevoke = hasPlatformPermission('platform.admins.manage')

  const load = useCallback(() => {
    core.getPlatformOperationalSessions(100, 0)
      .then(setSessions)
      .catch((cause) => setError(cause instanceof Error ? cause.message : 'Errore sconosciuto'))
  }, [])

  useEffect(() => { load() }, [load])

  async function onRevoke(session: PlatformOperationalSessionRecord) {
    const ok = await confirm({
      title: `Revocare la sessione di ${session.adminFullName ?? 'questo admin'}?`,
      description: `La vista operativa su ${session.propertyName ?? 'questa struttura'} verrà chiusa immediatamente. I suoi privilegi di Platform Admin restano invariati -- potrà aprirne subito una nuova.`,
      confirmLabel: 'Revoca',
    })
    if (!ok) return
    setRevokingId(session.id)
    try {
      await core.revokePlatformOperationalSession(session.id)
      load()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Errore sconosciuto')
    } finally {
      setRevokingId(null)
    }
  }

  return (
    <>
      <h1>Sessioni operative</h1>
      <p className="muted">Ultime 100 sessioni di vista operativa aperte da qualunque Platform Admin, più recenti per prime.</p>
      {error ? <PageState kind="error" title="Impossibile caricare le sessioni." description={error} /> : null}
      {!error && !sessions ? <PageState kind="loading" title="Caricamento…" /> : null}
      {sessions && sessions.length === 0 ? <PageState kind="empty" title="Nessuna sessione operativa registrata." /> : null}
      {sessions && sessions.length > 0 ? (
        <table className="platform-table">
          <thead>
            <tr>
              <th>Admin</th><th>Struttura</th><th>Stato</th><th>Aperta</th><th>Scade/Chiusa</th><th>Motivo</th><th></th>
            </tr>
          </thead>
          <tbody>
            {sessions.map((session) => (
              <tr key={session.id}>
                <td>{session.adminFullName ?? '—'}</td>
                <td>{session.propertyName ?? '—'}</td>
                <td><span className={`platform-badge ${session.status}`}>{STATUS_LABELS[session.status]}</span></td>
                <td>{new Date(session.openedAt).toLocaleString('it-IT')}</td>
                <td>
                  {session.closedAt
                    ? `${new Date(session.closedAt).toLocaleString('it-IT')}${session.closedByFullName ? ` · ${session.closedByFullName}` : ''}`
                    : new Date(session.expiresAt).toLocaleString('it-IT')}
                </td>
                <td>{session.reason ?? '—'}</td>
                <td>
                  {canRevoke && session.status === 'active' ? (
                    <Button variant="secondary" size="sm" disabled={revokingId === session.id} onClick={() => void onRevoke(session)}>
                      <ShieldOff size={14} /> {revokingId === session.id ? 'Revoca…' : 'Revoca'}
                    </Button>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
      {confirmDialog}
    </>
  )
}
