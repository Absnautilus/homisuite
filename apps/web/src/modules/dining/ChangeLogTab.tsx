import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../../core/client'
import { listChangeLog } from './api'
import type { ChangeLogEntry } from './types'
import { readableDiningError } from './readableDiningError'

interface ChangeLogTabProps {
  hotelId: string
}

function formatTimestamp(value: string): string {
  return new Date(value).toLocaleString('it-IT', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}

export function ChangeLogTab({ hotelId }: ChangeLogTabProps) {
  const [entries, setEntries] = useState<ChangeLogEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      setError(null)
      setEntries(await listChangeLog(supabase, hotelId))
    } catch (cause) {
      setError(readableDiningError(cause))
    } finally {
      setLoading(false)
    }
  }, [hotelId])

  useEffect(() => { void load() }, [load])

  return (
    <section className="shell-card">
      <div className="section-heading">
        <h2>Registro modifiche</h2>
        <p>Chi ha creato, modificato o eliminato cosa nel modulo Ristorazione.</p>
      </div>
      {error ? <div className="shell-alert error" role="alert">{error}<button type="button" onClick={() => void load()}>Riprova</button></div> : null}
      <div className="dining-change-log" role="table" aria-label="Registro modifiche">
        <div className="dining-change-log-row dining-change-log-head" role="row">
          <span role="columnheader">Quando</span>
          <span role="columnheader">Chi</span>
          <span role="columnheader">Cosa</span>
        </div>
        {entries.map((entry) => (
          <div className="dining-change-log-row" role="row" key={entry.id}>
            <span role="cell">{formatTimestamp(entry.created_at)}</span>
            <span role="cell">{entry.actor_name}</span>
            <span role="cell">{entry.summary}</span>
          </div>
        ))}
        {!loading && entries.length === 0 ? <div className="dining-reservations-empty muted">Nessuna modifica registrata.</div> : null}
      </div>
    </section>
  )
}
