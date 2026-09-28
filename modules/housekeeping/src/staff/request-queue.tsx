import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { PageHeader, Tabs } from '@homisuite/ui'
import { EmbeddedNav } from '@/staff/embedded-nav'
import { useToast } from '@/components/toast-context'
import { EmptyState, IconInboxEmpty } from '@/components/empty-state'
import { cancelRequest, claimRequest, fetchQueue, listQueueJobTitles, subscribeToQueue } from '@/lib/staff-api'
import { useRequestAlerts } from '@/hooks/use-request-alerts'
import { playAlertSound } from '@/lib/beep'
import { RequestRow } from '@/staff/request-row'
import { ReorderableColumn } from '@/staff/reorderable-column'
import { NewRequestForm } from '@/staff/new-request-form'
import { useLocale } from '@/lib/i18n/locale-context'
import { useHotelName } from '@/lib/hotel-branding-context'
import { getErrorMessage } from '@/lib/errors'
import type { QueueJobTitle, QueuedRequest, StaffProfile } from '@/lib/staff-types'

type Tab = 'new' | 'inProgress' | 'done'

const DONE_PAGE_SIZE = 15

export function RequestQueue({ profile, canManageQueue, embeddedNav }: {
  profile: StaffProfile
  canManageQueue: boolean
  embeddedNav?: { basePath: string; staysAllowed: boolean; manageAllowed: boolean }
}) {
  const { t } = useLocale()
  const hotelName = useHotelName()
  const [queue, setQueue] = useState<QueuedRequest[] | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [tab, setTab] = useState<Tab>('new')
  const [donePage, setDonePage] = useState(0)
  const [jobTitles, setJobTitles] = useState<QueueJobTitle[]>([])
  const [now, setNow] = useState(() => new Date())
  const { push, pushCard } = useToast()
  const knownIds = useRef<Set<string> | null>(null)

  // Operational queue controls belong to Reception. In embedded Core mode
  // bridged profiles deliberately carry a compatibility role of `admin`, so
  // role is not an authorization signal here; department is. Porters and
  // other operational units can work requests assigned to them, but cannot
  // reprioritize, flag urgent, reassign, edit, cancel or reopen requests.
  const managesFrontDesk = canManageQueue
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
            ...(managesFrontDesk ? { onReject: () => void cancelRequest(request.id) } : {}),
          })
          playAlertSound()
        }
      }
    } catch (err) {
      console.error(err)
      setLoadError(getErrorMessage(err))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pushCard, profile.id, profile.hotel_id, managesFrontDesk])

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
      {embeddedNav ? (
        <>
          <EmbeddedNav profile={profile} {...embeddedNav} />
          <div className="admin-panel-title"><h2>{t('staff.nav.requests')}</h2></div>
        </>
      ) : (
        <PageHeader eyebrow={hotelName} title={t('staff.queue.title')} description={t('staff.queue.subtitle')} />
      )}

      {managesFrontDesk && (
        <div className="flex justify-end">
          <NewRequestForm staffId={profile.id} hotelId={profile.hotel_id} onCreated={reload} />
        </div>
      )}

      <section className="overflow-hidden rounded-lg border border-line bg-surface shadow-sm">
        <div className="border-b border-line bg-surface px-4 py-3 sm:px-5">
          <Tabs
            items={[
              { value: 'new', label: `${t('staff.queue.tabNew')} (${pending.length})` },
              { value: 'inProgress', label: `${t('staff.queue.columnInProgress')} (${inProgress.length})` },
              { value: 'done', label: t('staff.queue.tabDone') },
            ]}
            value={tab}
            onValueChange={(value) => setTab(value as Tab)}
            variant="surface"
            aria-label={t('staff.queue.title')}
          />
        </div>
        <div className="p-4 sm:p-5">
      {loadError ? (
        <div className="rounded-lg border border-bad-ink/25 bg-bad-bg p-4 text-sm text-bad-ink">
          {t('staff.queue.loadError')}
        </div>
      ) : queue === null ? (
        <p className="text-sm text-muted">{t('staff.queue.loading')}</p>
      ) : tab === 'new' ? (
        pending.length === 0 ? (
          <EmptyState
            icon={<IconInboxEmpty className="h-6 w-6" />}
            title={t('staff.queue.emptyActiveTitle')}
            description={t('staff.queue.emptyActiveDesc')}
            className="rounded-none border-0 bg-transparent py-10 shadow-none"
          />
        ) : (
          <ReorderableColumn
            items={pending}
            now={now}
            staffId={profile.id}
            canReorder={canReorder}
            canFlagUrgent={managesFrontDesk}
            canManageRequest={managesFrontDesk}
            jobTitles={jobTitles}
            onReordered={reload}
          />
        )
      ) : tab === 'inProgress' ? (
        inProgress.length === 0 ? (
          <EmptyState
            icon={<IconInboxEmpty className="h-6 w-6" />}
            title={t('staff.queue.emptyInProgressTitle')}
            description={t('staff.queue.emptyInProgressDesc')}
            className="rounded-none border-0 bg-transparent py-10 shadow-none"
          />
        ) : (
          <ReorderableColumn
            items={inProgress}
            now={now}
            staffId={profile.id}
            canReorder={canReorder}
            canFlagUrgent={managesFrontDesk}
            canManageRequest={managesFrontDesk}
            jobTitles={jobTitles}
            onReordered={reload}
          />
        )
      ) : done.length === 0 ? (
        <EmptyState icon={<IconInboxEmpty className="h-6 w-6" />} title={t('staff.queue.emptyDoneTitle')} description={t('staff.queue.emptyDoneDesc')} className="rounded-none border-0 bg-transparent py-10 shadow-none" />
      ) : (
        <div className="space-y-3">
          {donePageItems.map((request) => (
            <RequestRow key={request.id} request={request} now={now} staffId={profile.id} mode="done" canManageRequest={managesFrontDesk} jobTitles={jobTitles} />
          ))}
          {doneTotalPages > 1 && (
            <div className="flex items-center justify-center gap-3 pt-2">
              <button
                type="button"
                disabled={clampedDonePage === 0}
                onClick={() => setDonePage((p) => Math.max(0, p - 1))}
                className="cursor-pointer rounded-md border border-line bg-surface px-3 py-1.5 text-sm text-muted hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
              >
                {t('staff.queue.donePagePrev')}
              </button>
              <span className="text-xs text-muted">{t('staff.queue.donePageLabel', { page: clampedDonePage + 1, total: doneTotalPages })}</span>
              <button
                type="button"
                disabled={clampedDonePage >= doneTotalPages - 1}
                onClick={() => setDonePage((p) => Math.min(doneTotalPages - 1, p + 1))}
                className="cursor-pointer rounded-md border border-line bg-surface px-3 py-1.5 text-sm text-muted hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
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
