import { useCallback, useEffect, useMemo, useState } from 'react'
import type { SupabaseClient } from '@supabase/supabase-js'
import { BarChart3 } from 'lucide-react'
import { PageState } from '../../components/PageState'
import { loadStats } from './api'
import { formatMinutes, percent, SOURCE_LABELS } from './labels'
import type { InboxStats } from './types'

const PERIODS = [
  { days: 7, label: '7 giorni' },
  { days: 30, label: '30 giorni' },
  { days: 90, label: '90 giorni' },
]

const DAY_FORMAT = new Intl.DateTimeFormat('it-IT', { day: 'numeric', month: 'short', timeZone: 'UTC' })
const WEEKDAY_FORMAT = new Intl.DateTimeFormat('it-IT', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' })

function dayLabel(day: string, long = false): string {
  const date = new Date(`${day}T00:00:00Z`)
  return (long ? WEEKDAY_FORMAT : DAY_FORMAT).format(date)
}

// How the inbox is doing: volumes, how fast guests get an answer, how often
// the assistant's draft goes out as it is. Agents see the totals and their
// own figures; managers also see each colleague.
export function StatsTab({ client, propertyId, active }: { client: SupabaseClient; propertyId: string; active: boolean }) {
  const [days, setDays] = useState(30)
  const [stats, setStats] = useState<InboxStats | null>(null)
  const [failed, setFailed] = useState(false)

  const load = useCallback(async () => {
    try {
      setFailed(false)
      setStats(await loadStats(client, propertyId, days))
    } catch (cause) {
      console.error('Smart Inbox: stats not loaded', cause)
      setFailed(true)
    }
  }, [client, propertyId, days])

  useEffect(() => { if (active) void load() }, [active, load])

  if (failed && !stats) return <PageState kind="error" title="Impossibile caricare le statistiche." action={{ label: 'Riprova', onClick: () => void load() }} />
  if (!stats) return <PageState kind="loading" title="Caricamento statistiche…" />

  return (
    <div className="page-stack smart-inbox-stats">
      <div className="smart-inbox-filters" role="group" aria-label="Periodo">
        {PERIODS.map((period) => (
          <button
            key={period.days}
            type="button"
            className={`smart-inbox-filter-chip period${days === period.days ? ' active' : ''}`}
            aria-pressed={days === period.days}
            onClick={() => setDays(period.days)}
          >
            Ultimi {period.label}
          </button>
        ))}
      </div>

      <dl className="smart-inbox-kpis">
        <div><dt>Messaggi ricevuti</dt><dd>{stats.received.toLocaleString('it-IT')}</dd></div>
        <div><dt>Risposte inviate</dt><dd>{stats.replied.toLocaleString('it-IT')}</dd></div>
        <div>
          <dt>Tempo di risposta</dt>
          <dd>{formatMinutes(stats.median_response_minutes)}</dd>
          <small>tipico (mediana) · media {formatMinutes(stats.avg_response_minutes)}</small>
        </div>
        <div>
          <dt>Bozze inviate senza modifiche</dt>
          <dd>{percent(stats.unchanged, stats.replied)}</dd>
          <small>{stats.unchanged} su {stats.replied} risposte</small>
        </div>
        <div><dt>Da rispondere ora</dt><dd>{stats.open_now.toLocaleString('it-IT')}</dd></div>
      </dl>

      <DailyChart data={stats.by_day} />

      <div className="smart-inbox-stats-grid">
        <section className="shell-card">
          <div className="section-heading"><h2>Per canale</h2></div>
          {stats.by_channel.length === 0 ? <p className="muted smart-inbox-note smart-inbox-pad">Nessun messaggio nel periodo.</p> : (
            <table className="smart-inbox-table">
              <thead><tr><th scope="col">Canale</th><th scope="col">Ricevuti</th><th scope="col">Risposte</th></tr></thead>
              <tbody>
                {stats.by_channel.map((row) => (
                  <tr key={row.source}><th scope="row">{SOURCE_LABELS[row.source] ?? row.source}</th><td>{row.received}</td><td>{row.replied}</td></tr>
                ))}
              </tbody>
            </table>
          )}
        </section>

        <section className="shell-card">
          <div className="section-heading">
            <h2>{stats.agents_visible === 'all' ? 'Per agent' : 'Le tue risposte'}</h2>
            {stats.agents_visible === 'self' ? <p>I dati dei colleghi li vedono solo i responsabili.</p> : null}
          </div>
          {stats.by_agent.length === 0 ? <p className="muted smart-inbox-note smart-inbox-pad">Nessuna risposta nel periodo.</p> : (
            <table className="smart-inbox-table">
              <thead><tr><th scope="col">Agent</th><th scope="col">Risposte</th><th scope="col">Senza modifiche</th><th scope="col">Tempo medio</th></tr></thead>
              <tbody>
                {stats.by_agent.map((row) => (
                  <tr key={row.profile_id}>
                    <th scope="row">{row.full_name ?? 'Collega'}</th>
                    <td>{row.replied}</td>
                    <td>{percent(row.unchanged, row.replied)}</td>
                    <td>{formatMinutes(row.avg_response_minutes)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      </div>
    </div>
  )
}

// Received vs replied per day: two series, one axis, grouped bars with a
// legend, a hover/focus tooltip per day and the same numbers as a table.
function DailyChart({ data }: { data: InboxStats['by_day'] }) {
  const [hover, setHover] = useState<number | null>(null)
  const [asTable, setAsTable] = useState(false)
  const max = useMemo(() => Math.max(1, ...data.map((row) => Math.max(row.received, row.replied))), [data])
  const ticks = useMemo(() => {
    const step = Math.max(1, Math.ceil(max / 4))
    const top = step * Math.ceil(max / step)
    return { top, values: [0, step, step * 2, step * 3, step * 4].filter((value) => value <= top) }
  }, [max])
  const labelEvery = data.length > 31 ? 14 : data.length > 7 ? 5 : 1
  const total = data.reduce((sum, row) => sum + row.received + row.replied, 0)
  const active = hover !== null ? data[hover] : null

  return (
    <section className="shell-card smart-inbox-chart">
      <div className="smart-inbox-chart-head">
        <div>
          <h2><BarChart3 size={16} aria-hidden="true" /> Messaggi e risposte per giorno</h2>
          <ul className="smart-inbox-legend">
            <li><span className="swatch received" aria-hidden="true" /> Ricevuti</li>
            <li><span className="swatch replied" aria-hidden="true" /> Risposte inviate</li>
          </ul>
        </div>
        <button type="button" className="link-button" onClick={() => setAsTable((value) => !value)}>
          {asTable ? 'Mostra grafico' : 'Mostra come tabella'}
        </button>
      </div>

      {asTable ? (
        <div className="smart-inbox-table-scroll">
          <table className="smart-inbox-table">
            <thead><tr><th scope="col">Giorno</th><th scope="col">Ricevuti</th><th scope="col">Risposte</th></tr></thead>
            <tbody>
              {[...data].reverse().map((row) => (
                <tr key={row.day}><th scope="row">{dayLabel(row.day, true)}</th><td>{row.received}</td><td>{row.replied}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : total === 0 ? (
        <p className="muted smart-inbox-note smart-inbox-pad">Nessun messaggio nel periodo.</p>
      ) : (
        <div className="smart-inbox-plot" onMouseLeave={() => setHover(null)}>
          <div className="smart-inbox-yaxis" aria-hidden="true">
            {[...ticks.values].reverse().map((value) => <span key={value} style={{ bottom: `${(value / ticks.top) * 100}%` }}>{value}</span>)}
          </div>
          <div className="smart-inbox-bars" role="list" aria-label="Messaggi e risposte per giorno">
            {ticks.values.map((value) => <span key={value} className="gridline" style={{ bottom: `${(value / ticks.top) * 100}%` }} aria-hidden="true" />)}
            {data.map((row, index) => (
              <div
                key={row.day}
                role="listitem"
                tabIndex={0}
                className={`smart-inbox-day${hover === index ? ' hover' : ''}`}
                aria-label={`${dayLabel(row.day, true)}: ${row.received} ricevuti, ${row.replied} risposte`}
                onMouseEnter={() => setHover(index)}
                onFocus={() => setHover(index)}
                onBlur={() => setHover(null)}
              >
                <span className="bar received" style={{ height: `${(row.received / ticks.top) * 100}%` }} />
                <span className="bar replied" style={{ height: `${(row.replied / ticks.top) * 100}%` }} />
                {index % labelEvery === 0 || index === data.length - 1 ? <span className="xlabel" aria-hidden="true">{dayLabel(row.day)}</span> : null}
              </div>
            ))}
            {active && hover !== null ? (
              <div className="smart-inbox-tooltip" style={{ left: `${((hover + 0.5) / data.length) * 100}%` }} role="status">
                <strong>{dayLabel(active.day, true)}</strong>
                <span><i className="swatch received" aria-hidden="true" /> Ricevuti <b>{active.received}</b></span>
                <span><i className="swatch replied" aria-hidden="true" /> Risposte <b>{active.replied}</b></span>
              </div>
            ) : null}
          </div>
        </div>
      )}
    </section>
  )
}
