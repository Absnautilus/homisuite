import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useToast } from '@/components/toast-context'
import { EmptyState, IconInboxEmpty } from '@/components/empty-state'
import { cn } from '@/lib/cn'
import { cancelRequest, claimRequest, fetchQueue, listQueueJobTitles, subscribeToQueue } from '@/lib/staff-api'
import { useRequestAlerts } from '@/hooks/use-request-alerts'
import { playAlertSound } from '@/lib/beep'
import { RequestRow } from '@/staff/request-row'
import { ReorderableColumn } from '@/staff/reorderable-column'
import { NewRequestForm } from '@/staff/new-request-form'
import { useLocale } from '@/lib/i18n/locale-context'
import { getErrorMessage } from '@/lib/errors'
import type { QueueJobTitle, QueuedRequest, StaffProfile } from '@/lib/staff-types'

type Tab = 'active' | 'done'

const DONE_PAGE_SIZE = 15

export function RequestQueue({ profile }: { profile: StaffProfile }) {
  const { t } = useLocale()
  const [queue, setQueue] = useState<QueuedRequest[] | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [tab, setTab] = useState<Tab>('active')
  const [donePage, setDonePage] = useState(0)
  const [jobTitles, setJobTitles] = useState<QueueJobTitle[]>([])
  const [now, setNow] = useState(() => new Date())
  const { push, pushCard } = useToast()
  const knownIds = useRef<Set<string> | null>(null)

  const managesFrontDesk = profile.role === 'admin' || profile.role === 'master' || (profile.role === 'operatore' && profile.department === 'reception')
  const canReorder = managesFrontDesk

  const reload = useCallback(async () => {
    try {
      const [data, jobTitleOptions] = await Promise.all([
        fetchQueue(profile.hotel_id),
        listQueueJobTitles(profile.hotel_id),
      ])
      setLoadError(null)
      setQueue(data)
      setJobTitles(jobTitleOptions)

      if (knownIds.current === null) {
        knownIds.current = new Set(data.map((r) => r.id))
        return
      }
      for (const request of data) {
        if (!knownIds.current.has(request.id)) {
          knownIds.current.add(request.id)
          const itemName = request.request_types?.name ?? t('staff.queue.newRequestFallbackItem')
          const title = `${t('staff.newRequest.room')} ${request.room_number} · ${itemName}${request.quantity ? ` × ${request.quantity}` : ''}`
          pushCard({
            title,
            onAccept: () => void claimRequest(request.id, profile.id),
            onReject: () => void cancelRequest(request.id),
          })
          playAlertSound()
        }
      }
    } catch (err) {
      setLoadError(getErrorMessage(err))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pushCard, profile.id, profile.hotel_id])

  useEffect(() => {
    reload()
    const unsubscribe = subscribeToQueue(profile.hotel_id, () => {
      reload()
    })
    return unsubscribe
  }, [reload, profile.hotel_id])

  useEffect(() => {
    const interval = setInterval(() => setNow(new Date()), 30_000)
    return () => clearInterval(interval)
  }, [])

  const pending = (queue ?? []).filter((r) => r.status === 'requested')
  const inProgress = (queue ?? []).filter((r) => r.status === 'in_progress')
  const active = [...pending, ...inProgress]
  const done = useMemo(
    () =>
      (queue ?? [])
        .filter((r) => r.status === 'completed' || r.status === 'cancelled')
        .sort((a, b) => new Date(b.completed_at ?? b.created_at).getTime() - new Date(a.completed_at ?? a.created_at).getTime()),
    [queue],
  )

  const doneTotalPages = Math.max(1, Math.ceil(done.length / DONE_PAGE_SIZE))
  const clampedDonePage = Math.min(donePage, doneTotalPages - 1)
  const donePageItems = done.slice(clampedDonePage * DONE_PAGE_SIZE, clampedDonePage * DONE_PAGE_SIZE + DONE_PAGE_SIZE)

  const onAlert = useCallback((message: string, tone: 'info' | 'warning') => push(message, tone), [push])
  useRequestAlerts(active, onAlert)

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div className="min-w-0">
          <h1 className="font-head text-2xl font-bold tracking-tight text-foreground">{t('staff.queue.title')}</h1>
          <p className="mt-1 text-sm text-muted">{t('staff.queue.subtitle')}</p>
        </div>
      </div>

      <div>
        <NewRequestForm staffId={profile.id} hotelId={profile.hotel_id} onCreated={reload} />
      </div>

      <section className="overflow-hidden rounded-lg border border-line bg-surface shadow-sm">
        <div className="flex justify-end border-b border-line bg-surface px-4 py-3">
          <div className="flex gap-1 rounded-md bg-surface-2 p-1 sm:w-fit">
            <TabButton active={tab === 'active'} onClick={() => setTab('active')}>
              {t('staff.queue.tabActive')} ({active.length})
            </TabButton>
            <TabButton active={tab === 'done'} onClick={() => setTab('done')}>
              {t('staff.queue.tabDone')}
            </TabButton>
          </div>
        </div>
        <div className="p-4 sm:p-5">
      {loadError ? (
        <div className="rounded-lg border border-bad-ink/25 bg-bad-bg p-4 text-sm text-bad-ink">
          {t('staff.queue.loadError', { error: loadError })}
        </div>
      ) : queue === null ? (
        <p className="text-sm text-muted">{t('staff.queue.loading')}</p>
      ) : tab === 'active' ? (
        active.length === 0 ? (
          <EmptyState
            icon={<IconInboxEmpty className="h-6 w-6" />}
            title={t('staff.queue.emptyActiveTitle')}
            description={t('staff.queue.emptyActiveDesc')}
            className="rounded-none border-0 bg-transparent py-10 shadow-none"
          />
        ) : (
          <div className="grid grid-cols-1 items-start gap-5 xl:grid-cols-2">
            <section className="min-w-0">
              <h2 className="mb-3 flex items-center gap-2 px-1 text-sm font-semibold text-wait-ink">
                <span className="h-2 w-2 rounded-full bg-wait-ink" />
                {t('staff.queue.columnNew')} ({pending.length})
              </h2>
              {pending.length === 0 ? (
                <div className="rounded-lg border border-line bg-surface/70 px-4 py-6 text-sm text-muted">
                  {t('staff.queue.emptyNewShort')}
                </div>
              ) : (
                <ReorderableColumn
                  items={pending}
                  now={now}
                  staffId={profile.id}
                  canReorder={canReorder}
                  canFlagUrgent={managesFrontDesk}
                  jobTitles={jobTitles}
                  onReordered={reload}
                />
              )}
            </section>
            <section className="min-w-0">
              <h2 className="mb-3 flex items-center gap-2 px-1 text-sm font-semibold text-prog-ink">
                <span className="h-2 w-2 rounded-full bg-prog-ink" />
                {t('staff.queue.columnInProgress')} ({inProgress.length})
              </h2>
              {inProgress.length === 0 ? (
                <div className="rounded-lg border border-line bg-surface/70 px-4 py-6 text-sm text-muted">
                  {t('staff.queue.emptyInProgressShort')}
                </div>
              ) : (
                <ReorderableColumn
                  items={inProgress}
                  now={now}
                  staffId={profile.id}
                  canReorder={canReorder}
                  canFlagUrgent={managesFrontDesk}
                  jobTitles={jobTitles}
                  onReordered={reload}
                />
              )}
            </section>
          </div>
        )
      ) : done.length === 0 ? (
        <EmptyState icon={<IconInboxEmpty className="h-6 w-6" />} title={t('staff.queue.emptyDoneTitle')} description={t('staff.queue.emptyDoneDesc')} className="rounded-none border-0 bg-transparent py-10 shadow-none" />
      ) : (
        <div className="space-y-3">
          {donePageItems.map((request) => (
            <RequestRow key={request.id} request={request} now={now} staffId={profile.id} mode="done" jobTitles={jobTitles} />
          ))}
          {doneTotalPages > 1 && (
            <div className="flex items-center justify-center gap-3 pt-2">
              <button
                type="button"
                disabled={clampedDonePage === 0}
                onClick={() => setDonePage((p) => Math.max(0, p - 1))}
                className="cursor-pointer rounded-md border border-line bg-white px-3 py-1.5 text-sm text-muted hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
              >
                {t('staff.queue.donePagePrev')}
              </button>
              <span className="text-xs text-muted">{t('staff.queue.donePageLabel', { page: clampedDonePage + 1, total: doneTotalPages })}</span>
              <button
                type="button"
                disabled={clampedDonePage >= doneTotalPages - 1}
                onClick={() => setDonePage((p) => Math.min(doneTotalPages - 1, p + 1))}
                className="cursor-pointer rounded-md border border-line bg-white px-3 py-1.5 text-sm text-muted hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
              >
                {t('staff.queue.donePageNext')}
              </button>
            </div>
          )}
        </div>
      )}
        </div>
      </section>
    </div>
  )
}

function TabButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex-1 cursor-pointer whitespace-nowrap rounded px-3 py-1.5 text-sm font-medium transition-colors sm:flex-none',
        active ? 'bg-white text-foreground shadow-sm' : 'text-muted hover:text-foreground',
      )}
    >
      {children}
    </button>
  )
}
