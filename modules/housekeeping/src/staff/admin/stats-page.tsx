import { useEffect, useState } from 'react'
import { Tabs } from '@homisuite/ui'
import { Card, CardBody } from '@/components/ui/card'
import { fetchCompletionStats, type StatsSummary } from '@/lib/admin-api'
import { formatDuration } from '@/lib/format'
import { getErrorMessage } from '@/lib/errors'
import { useLocale } from '@/lib/i18n/locale-context'
import type { TranslationKey } from '@/lib/i18n/dictionaries'

type RangePreset = '7d' | '30d' | '90d' | 'all'

const RANGE_DAYS: Record<Exclude<RangePreset, 'all'>, number> = { '7d': 7, '30d': 30, '90d': 90 }

// undefined means all-time (fetchCompletionStats' own previous behavior) --
// everything else scopes to completed_at within the last N days from now.
function rangeFor(preset: RangePreset): { from: string; to: string } | undefined {
  if (preset === 'all') return undefined
  const to = new Date()
  const from = new Date(to.getTime() - RANGE_DAYS[preset] * 24 * 60 * 60 * 1000)
  return { from: from.toISOString(), to: to.toISOString() }
}

export function StatsPage({ hotelId }: { hotelId: string }) {
  const { t } = useLocale()
  const [range, setRange] = useState<RangePreset>('30d')
  const [stats, setStats] = useState<StatsSummary | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    // Reset to the loading state on every range change too, not just on
    // mount -- otherwise switching range briefly keeps showing the
    // previous range's numbers (or, once that's fetched, an incorrect
    // "nothing completed yet" empty state) while the new query is in flight.
    setStats(null)
    setError(null)
    fetchCompletionStats(hotelId, rangeFor(range))
      .then(setStats)
      .catch((err) => {
        console.error(err)
        setError(getErrorMessage(err))
      })
  }, [hotelId, range])

  const rangeItems = [
    { value: '7d', label: t('staff.stats.range7d') },
    { value: '30d', label: t('staff.stats.range30d') },
    { value: '90d', label: t('staff.stats.range90d') },
    { value: 'all', label: t('staff.stats.rangeAll') },
  ]

  return (
    <div className="space-y-6">
      <div className="admin-panel-title"><h2>{t('staff.stats.title')}</h2><p>{t('staff.stats.subtitle')}</p></div>

      <Tabs
        items={rangeItems}
        value={range}
        onValueChange={(value) => setRange(value as RangePreset)}
        variant="surface"
        aria-label={t('staff.stats.rangeAriaLabel')}
      />

      {error ? (
        <div className="rounded-lg border border-bad-ink/25 bg-bad-bg p-4 text-sm text-bad-ink">{t('staff.stats.loadError')}</div>
      ) : stats === null ? (
        <p className="text-sm text-muted">{t('staff.stats.loading')}</p>
      ) : stats.overallCount === 0 ? (
        <p className="text-sm text-muted">{t('staff.stats.empty')}</p>
      ) : (
        <>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <Card>
              <CardBody>
                <p className="text-xs font-bold tracking-wide text-muted uppercase">{t('staff.stats.completedCount')}</p>
                <p className="mt-1 font-head text-3xl font-extrabold text-foreground">{stats.overallCount}</p>
              </CardBody>
            </Card>
            <Card>
              <CardBody>
                <p className="text-xs font-bold tracking-wide text-muted uppercase">{t('staff.stats.avgWait')}</p>
                <p className="mt-1 font-head text-3xl font-extrabold text-foreground">
                  {stats.overallAvgWaitMinutes !== null ? formatDuration(stats.overallAvgWaitMinutes) : '—'}
                </p>
                <p className="mt-1 text-xs text-muted">{t('staff.stats.avgWaitHint')}</p>
              </CardBody>
            </Card>
            <Card>
              <CardBody>
                <p className="text-xs font-bold tracking-wide text-muted uppercase">{t('staff.stats.avgExec')}</p>
                <p className="mt-1 font-head text-3xl font-extrabold text-foreground">
                  {stats.overallAvgExecMinutes !== null ? formatDuration(stats.overallAvgExecMinutes) : '—'}
                </p>
                <p className="mt-1 text-xs text-muted">{t('staff.stats.avgExecHint')}</p>
              </CardBody>
            </Card>
          </div>

          <Card>
            <CardBody>
              <h2 className="mb-4 text-sm font-semibold text-foreground">{t('staff.stats.byDepartment')}</h2>
              <BarList
                rows={stats.byDepartment.map((d) => ({
                  key: d.department ?? 'none',
                  label: d.department ? t(`department.${d.department}` as const) : t('department.none'),
                  minutes: d.avgMinutes,
                  count: d.count,
                }))}
                t={t}
              />
            </CardBody>
          </Card>

          {stats.byOperator.length > 0 && (
            <Card>
              <CardBody>
                <h2 className="mb-1 text-sm font-semibold text-foreground">{t('staff.stats.byOperator')}</h2>
                <p className="mb-4 text-xs text-muted">{t('staff.stats.byOperatorHint')}</p>
                <BarList
                  rows={stats.byOperator.map((o) => ({ key: o.staffId, label: o.name, minutes: o.avgExecMinutes, count: o.count }))}
                  t={t}
                />
              </CardBody>
            </Card>
          )}
        </>
      )}
    </div>
  )
}

function BarList({
  rows,
  t,
}: {
  rows: { key: string; label: string; minutes: number; count: number }[]
  t: (key: TranslationKey, vars?: Record<string, string | number>) => string
}) {
  const max = Math.max(...rows.map((r) => r.minutes), 1)
  return (
    <div className="space-y-3">
      {rows.map((r) => {
        const pct = Math.max(4, Math.round((r.minutes / max) * 100))
        return (
          <div key={r.key}>
            <div className="mb-1 flex items-baseline justify-between text-sm">
              <span className="font-medium text-foreground">{r.label}</span>
              <span className="text-muted">
                {formatDuration(r.minutes)} · {t('staff.stats.requestCount', { count: r.count })}
              </span>
            </div>
            <div className="h-2 w-full overflow-hidden rounded-full bg-surface-2">
              <div className="h-full rounded-full bg-accent" style={{ width: `${pct}%` }} />
            </div>
          </div>
        )
      })}
    </div>
  )
}
