import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { TrendingUp } from 'lucide-react'
import { PageHeader, Tabs, useRememberedTab } from '@homisuite/ui'
import { EmbeddedNav } from '@/staff/embedded-nav'
import { MinimalTopBar } from '@/staff/minimal-top-bar'
import { SimpleQueueTiles } from '@/staff/simple-queue-tiles'
import { useToast } from '@/components/toast-context'
import { useConfirm } from '@/components/confirm-dialog'
import { EmptyState, IconInboxEmpty } from '@/components/empty-state'
import { claimRequest, fetchQueue, listQueueJobTitles, rejectRequest, subscribeToQueue } from '@/lib/staff-api'
import { useRequestAlerts } from '@/hooks/use-request-alerts'
import { playAlertSound } from '@/lib/beep'
import { RequestRow } from '@/staff/request-row'
import { ReorderableColumn } from '@/staff/reorderable-column'
import { NewRequestForm } from '@/staff/new-request-form'
import { WhoOnDuty } from '@/staff/who-on-duty'
import { cn } from '@/lib/cn'
import { useLocale } from '@/lib/i18n/locale-context'
import { useHotelName } from '@/lib/hotel-branding-context'
import { useSimpleMode } from '@/lib/simple-mode-context'
import { getErrorMessage } from '@/lib/errors'
import type { QueueJobTitle, QueuedRequest, StaffProfile } from '@/lib/staff-types'

type Tab = 'new' | 'inProgress' | 'done'

const DONE_PAGE_SIZE = 15

export function RequestQueue({ profile, canManageQueue, embeddedNav, onCompleteOverride }: {
  profile: StaffProfile
  canManageQueue: boolean
  embeddedNav?: { basePath: string; staysAllowed: boolean; manageAllowed: boolean; minimal?: boolean }
  onCompleteOverride?: (requestId: string) => Promise<void>
}) {
  const { t } = useLocale()
  const hotelName = useHotelName()
  const { enabled: simpleModeEnabled } = useSimpleMode()
  // Only where there's an actual shell to simplify the way back to --
  // standalone/legacy deployments and the already-bare facchino tier
  // (embeddedNav.minimal) are unaffected either way.
  const showSimpleHome = Boolean(embeddedNav) && !embeddedNav?.minimal && simpleModeEnabled
  const [queue, setQueue] = useState<QueuedRequest[] | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [tab, setTabRaw] = useRememberedTab('housekeeping.queue.tab', 'new')
  const setTab = setTabRaw as (next: Tab) => void
  const [donePage, setDonePage] = useState(0)
  const [jobTitles, setJobTitles] = useState<QueueJobTitle[]>([])
  const [now, setNow] = useState(() => new Date())
  const { push, pushCard } = useToast()
  const [confirmDialog, confirm] = useConfirm()
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
            // Confirms before actually rejecting, same as the request list's
            // own reject button -- a quick tap on the toast must not
            // silently reject something nobody meant to decline. The card
            // stays open on cancel (ToastStack only dismisses it when this
            // resolves true).
            ...(managesFrontDesk ? {
              onReject: async () => {
                const ok = await confirm({
                  title: t('staff.row.rejectTitle'),
                  description: t('staff.row.rejectDesc', { room: request.room_number, type: itemName }),
                  confirmLabel: t('staff.row.rejectConfirm'),
                })
                if (!ok) return false
                await rejectRequest(request.id, profile.id)
                return true
              },
            } : {}),
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

  // A rejected request stays status='requested' (see rejectRequest's own
  // comment) so it keeps rendering in this same "Nuove" column -- but it
  // must not count toward the badge/alert/empty-state logic below, which
  // exists to say "this needs action." It's rendered separately, below the
  // reorderable pending list, since dragging a dead row around a priority
  // list makes no sense.
  const pending = (queue ?? []).filter((r) => r.status === 'requested' && !r.rejected_at)
  const rejectedPending = (queue ?? []).filter((r) => r.status === 'requested' && r.rejected_at)
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

  // Just the day's own count, no target -- there's no "obiettivo" concept
  // (per-property goal, rolling average, ...) to back a progress bar with
  // yet, so this stays a plain number rather than a fabricated one.
  const completedToday = useMemo(() => {
    const startOfToday = new Date()
    startOfToday.setHours(0, 0, 0, 0)
    return (queue ?? []).filter((r) => r.status === 'completed' && r.completed_at && new Date(r.completed_at) >= startOfToday).length
  }, [queue])

  const onAlert = useCallback((message: string, tone: 'info' | 'warning') => push(message, tone), [push])
  useRequestAlerts(active, onAlert)

  const showMinimalBar = Boolean(embeddedNav?.minimal) || showSimpleHome
  const emptyStateClassName = cn('rounded-none border-0 bg-transparent shadow-none', showMinimalBar ? 'py-6' : 'py-10')

  return (
    // MinimalTopBar's own action row is fixed to the viewport bottom in
    // that case -- this bottom padding keeps it from covering whatever's
    // last in the queue, the same clearance ShellLayout's own bottom nav
    // already gets its page content.
    <div className={showMinimalBar ? 'space-y-4 pb-24' : 'space-y-4'}>
      {showMinimalBar ? (
        <MinimalTopBar profile={profile} simpleModeToggle={!embeddedNav?.minimal} />
      ) : embeddedNav ? (
        <div data-tour="hk-nav">
          <EmbeddedNav
            profile={profile}
            basePath={embeddedNav.basePath}
            staysAllowed={embeddedNav.staysAllowed}
            manageAllowed={embeddedNav.manageAllowed}
            secondary={{
              items: [
                { value: 'new', label: t('staff.queue.tabNew'), attention: pending.length > 0 ? pending.length : false },
                { value: 'inProgress', label: t('staff.queue.columnInProgress'), attention: inProgress.length > 0 ? inProgress.length : false },
                { value: 'done', label: t('staff.queue.tabDone') },
              ],
              value: tab,
              onValueChange: (value) => setTab(value as Tab),
              ariaLabel: t('staff.queue.title'),
            }}
          />
          <div className="admin-panel-title"><h2>{t('staff.nav.requests')}</h2></div>
        </div>
      ) : (
        <PageHeader eyebrow={hotelName} title={t('staff.queue.title')} description={t('staff.queue.subtitle')} />
      )}

      {(managesFrontDesk || !showMinimalBar) && (
        <div className="flex flex-wrap items-center justify-between gap-3">
          {!showMinimalBar ? <WhoOnDuty hotelId={profile.hotel_id} /> : <span />}
          {managesFrontDesk && (
            <div className="ml-auto" data-tour="hk-new-request">
              <NewRequestForm staffId={profile.id} hotelId={profile.hotel_id} onCreated={reload} />
            </div>
          )}
        </div>
      )}

      {showMinimalBar && (
        <div className="rounded-2xl border border-line bg-surface p-4 shadow-sm sm:p-5" data-tour="hk-tabs">
          <SimpleQueueTiles
            tab={tab as Tab}
            onSelect={setTab}
            newCount={pending.length}
            inProgressCount={inProgress.length}
            doneCount={done.length}
          />
        </div>
      )}

      {showMinimalBar && (
        <div className="flex items-center gap-2.5 rounded-2xl border border-line bg-surface px-4 py-3 sm:px-5">
          <TrendingUp className="h-4 w-4 shrink-0 text-accent" aria-hidden="true" />
          <p className="text-sm font-bold text-foreground">{t('staff.queue.completedToday', { count: completedToday })}</p>
        </div>
      )}

      <section className="overflow-hidden rounded-lg border border-line bg-surface shadow-sm" data-tour="hk-queue">
        {!embeddedNav && (
          <div className="border-b border-line bg-surface px-4 py-3 sm:px-5" data-tour="hk-tabs">
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
        )}
        <div className="p-4 sm:p-5">
      {loadError ? (
        <div className="rounded-lg border border-bad-ink/25 bg-bad-bg p-4 text-sm text-bad-ink">
          {t('staff.queue.loadError')}
        </div>
      ) : queue === null ? (
        <p className="text-sm text-muted">{t('staff.queue.loading')}</p>
      ) : (
        // All three tabs stay mounted, only visibility toggles -- switching
        // the tab used to unmount/remount a whole ReorderableColumn (every
        // RequestRow in it, fresh DOM and effects each time), which is what
        // read as a lag on every tab switch.
        <>
          <div hidden={tab !== 'new'}>
            {pending.length === 0 && rejectedPending.length === 0 ? (
              <EmptyState
                icon={<IconInboxEmpty className="h-6 w-6" />}
                title={t('staff.queue.emptyActiveTitle')}
                description={t('staff.queue.emptyActiveDesc')}
                className={emptyStateClassName}
              />
            ) : (
              <div className="space-y-3">
                {pending.length > 0 && (
                  <ReorderableColumn
                    items={pending}
                    now={now}
                    staffId={profile.id}
                    canReorder={canReorder}
                    canFlagUrgent={managesFrontDesk}
                    canManageRequest={managesFrontDesk}
                    jobTitles={jobTitles}
                    onReordered={reload}
                    onCompleteOverride={onCompleteOverride}
                  />
                )}
                {/* Rejected rows aren't part of the reorderable priority list --
                    there's nothing to prioritize about a row nobody will act
                    on -- but they stay in this same "Nuove" view rather than
                    moving to "Completate", so whoever rejected it is visible
                    to the rest of the shift at a glance. */}
                {rejectedPending.length > 0 && (
                  <div className="space-y-3">
                    {rejectedPending.map((request) => (
                      <RequestRow key={request.id} request={request} now={now} staffId={profile.id} mode="active" canManageRequest={managesFrontDesk} jobTitles={jobTitles} />
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
          <div hidden={tab !== 'inProgress'}>
            {inProgress.length === 0 ? (
              <EmptyState
                icon={<IconInboxEmpty className="h-6 w-6" />}
                title={t('staff.queue.emptyInProgressTitle')}
                description={t('staff.queue.emptyInProgressDesc')}
                className={emptyStateClassName}
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
                onCompleteOverride={onCompleteOverride}
              />
            )}
          </div>
          <div hidden={tab !== 'done'}>
            {done.length === 0 ? (
              <EmptyState icon={<IconInboxEmpty className="h-6 w-6" />} title={t('staff.queue.emptyDoneTitle')} description={t('staff.queue.emptyDoneDesc')} className={emptyStateClassName} />
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
        </>
      )}
        </div>
      </section>
      {confirmDialog}
    </div>
  )
}
