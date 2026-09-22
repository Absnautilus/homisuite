import { useState, type PointerEvent as ReactPointerEvent } from 'react'
import { Card, CardBody } from '@/components/ui/card'
import { IconButton } from '@/components/ui/icon-button'
import { Badge, StatusBadge } from '@/components/ui/badge'
import { Select, Input, Textarea } from '@/components/ui/field'
import { Button } from '@/components/ui/button'
import { AlertTriangle, ArrowDownToLine, ArrowLeft, Check, Clock, GripVertical, PackageCheck, Pencil, Trash2, X } from 'lucide-react'
import { Avatar } from '@/components/avatar'
import { AutoText } from '@/components/auto-text'
import { formatElapsed, formatTime } from '@/lib/format'
import { cancelRequest, claimRequest, completeRequest, deleteRequest, markItemReturned, reassignRequestToJobTitle, revertRequest, setRequestUrgent, updateRequest } from '@/lib/staff-api'
import type { QueueJobTitle, QueuedRequest } from '@/lib/staff-types'
import { useConfirm } from '@/components/confirm-dialog'
import { useLocale } from '@/lib/i18n/locale-context'

export function RequestRow({
  request,
  now,
  staffId,
  mode,
  canReorder = false,
  canFlagUrgent = false,
  canManageRequest = false,
  jobTitles,
  onMoveUp,
  onMoveDown,
  onDragPointerDown,
  onDragPointerMove,
  onDragPointerUp,
}: {
  request: QueuedRequest
  now: Date
  staffId: string
  mode: 'active' | 'done'
  canReorder?: boolean
  canFlagUrgent?: boolean
  canManageRequest?: boolean
  jobTitles: QueueJobTitle[]
  onMoveUp?: () => void
  onMoveDown?: () => void
  onDragPointerDown?: (e: ReactPointerEvent<HTMLButtonElement>) => void
  onDragPointerMove?: (e: ReactPointerEvent<HTMLButtonElement>) => void
  onDragPointerUp?: (e: ReactPointerEvent<HTMLButtonElement>) => void
}) {
  const { t } = useLocale()
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [confirmDialog, confirm] = useConfirm()
  const [editing, setEditing] = useState(false)
  const [editRoom, setEditRoom] = useState(request.room_number)
  const [editQuantity, setEditQuantity] = useState(String(request.quantity ?? ''))
  const [editNote, setEditNote] = useState(request.note ?? '')
  const typeName = request.request_types?.name ?? t('staff.row.defaultTypeName')
  const typeNameI18n = request.request_types?.name_i18n
  const categoryName = request.request_types?.request_categories?.name
  const categoryNameI18n = request.request_types?.request_categories?.name_i18n
  const trackable = request.request_types?.available_quantity != null

  async function run(action: () => Promise<void>) {
    setPending(true)
    setError(null)
    try {
      await action()
    } catch {
      setError(t('staff.row.opFailed'))
    } finally {
      setPending(false)
    }
  }

  function startEdit() {
    setEditRoom(request.room_number)
    setEditQuantity(String(request.quantity ?? ''))
    setEditNote(request.note ?? '')
    setError(null)
    setEditing(true)
  }

  // Doesn't reuse run() -- a failed save must keep the form open (with the
  // person's edits intact) instead of snapping back to the read-only view
  // underneath a now-stale error message.
  async function onSaveEdit() {
    const room = editRoom.trim()
    if (!room) return
    setPending(true)
    setError(null)
    try {
      await updateRequest(request.id, {
        room_number: room,
        quantity: trackable ? (editQuantity.trim() ? Number(editQuantity) : null) : request.quantity,
        note: editNote.trim() || null,
      })
      setEditing(false)
    } catch {
      setError(t('staff.row.opFailed'))
    } finally {
      setPending(false)
    }
  }

  async function onCancel() {
    const ok = await confirm({
      title: t('staff.row.cancelTitle'),
      description: t('staff.row.cancelDesc', { room: request.room_number, type: typeName }),
      confirmLabel: t('staff.row.cancelConfirm'),
    })
    if (ok) run(() => cancelRequest(request.id))
  }

  async function onDelete() {
    const ok = await confirm({
      title: t('staff.row.deleteTitle'),
      description: t('staff.row.deleteDesc', { room: request.room_number, type: typeName }),
      confirmLabel: t('staff.row.deleteConfirm'),
    })
    if (ok) run(() => deleteRequest(request.id))
  }

  const elapsedLabel =
    mode !== 'active'
      ? request.status === 'completed'
        ? t('staff.row.resolvedIn', { time: formatElapsed(request.created_at, new Date(request.completed_at ?? request.created_at)) })
        : t('staff.row.cancelledLabel')
      : request.status === 'in_progress' && request.accepted_at
        ? t('staff.row.inChargeSince', { time: formatElapsed(request.accepted_at, now) })
        : t('staff.row.waitingSince', { time: formatElapsed(request.created_at, now) })

  const draggable =
    canReorder && mode === 'active' && (request.status === 'requested' || request.status === 'in_progress') && Boolean(onDragPointerDown)

  return (
    <Card>
      {confirmDialog}
      <CardBody>
        <div className="flex items-start justify-between gap-3">
          {editing ? (
            <div className="min-w-0 flex-1 space-y-2">
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                <Input
                  aria-label={t('staff.newRequest.room')}
                  value={editRoom}
                  onChange={(e) => setEditRoom(e.target.value)}
                  maxLength={20}
                  disabled={pending}
                />
                {trackable && (
                  <Input
                    type="number"
                    min={1}
                    aria-label={t('staff.row.editQuantity')}
                    placeholder={t('staff.row.editQuantity')}
                    value={editQuantity}
                    onChange={(e) => setEditQuantity(e.target.value)}
                    disabled={pending}
                  />
                )}
              </div>
              <Textarea
                aria-label={t('staff.newRequest.notes')}
                placeholder={t('staff.newRequest.notesPlaceholder')}
                rows={2}
                value={editNote}
                onChange={(e) => setEditNote(e.target.value)}
                disabled={pending}
              />
              <div className="flex justify-end gap-2">
                <Button type="button" variant="ghost" size="sm" disabled={pending} onClick={() => setEditing(false)}>
                  {t('staff.confirm.cancel')}
                </Button>
                <Button type="button" size="sm" disabled={pending || !editRoom.trim()} onClick={onSaveEdit}>
                  {t('staff.row.editSave')}
                </Button>
              </div>
            </div>
          ) : (
            // Done/cancelled rows are a review list, not a queue to act on
            // at a glance -- once archived, the same bold camera/title
            // treatment active rows need is just noise, so this header
            // quiets down instead of matching the active card's prominence.
            <div className="flex min-w-0 flex-1 items-start gap-3">
              <div className={`flex shrink-0 flex-col items-center rounded-lg px-3 py-1.5 text-center ${mode === 'done' ? '' : 'bg-surface-2'}`}>
                <span className="text-[0.625rem] font-bold uppercase tracking-wide text-muted">{t('staff.newRequest.room')}</span>
                <span className={mode === 'done' ? 'text-base leading-none font-bold text-muted' : 'text-2xl leading-none font-extrabold text-foreground'}>
                  {request.room_number}
                </span>
              </div>
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <p className={mode === 'done' ? 'text-sm leading-tight font-semibold text-muted' : 'text-lg leading-tight font-bold text-foreground'}>
                    <AutoText text={typeName} translations={typeNameI18n} />
                  </p>
                  {request.quantity ? (
                    <span
                      className={
                        mode === 'done'
                          ? 'inline-flex shrink-0 items-center rounded-full bg-surface-2 px-2 py-0.5 text-xs font-semibold text-muted'
                          : 'inline-flex shrink-0 items-center rounded-full bg-accent-soft px-2.5 py-0.5 text-xs font-bold text-accent'
                      }
                    >
                      × {request.quantity}
                    </span>
                  ) : null}
                </div>
                <p className="mt-0.5 text-sm text-muted">
                  {formatTime(request.created_at)}
                  {categoryName && (
                    <>
                      {' · '}
                      <AutoText text={categoryName} translations={categoryNameI18n} />
                    </>
                  )}
                </p>
              </div>
            </div>
          )}
          {!editing && (
            <div className="flex shrink-0 items-center gap-1">
              {canManageRequest && request.created_by_staff && (
                <IconButton tone="neutral" icon={Pencil} label={t('staff.row.edit')} disabled={pending} onClick={startEdit} />
              )}
              {canFlagUrgent && mode === 'active' && (
                <IconButton
                  tone="danger"
                  icon={AlertTriangle}
                  active={request.urgent}
                  label={request.urgent ? t('staff.row.unmarkUrgent') : t('staff.row.markUrgent')}
                  disabled={pending}
                  onClick={() => run(() => setRequestUrgent(request.id, !request.urgent))}
                />
              )}
              {draggable && (
                <>
                  <div className="flex flex-col">
                    <button
                      type="button"
                      disabled={!onMoveUp}
                      onClick={onMoveUp}
                      aria-label={t('staff.row.moveUp')}
                      className="cursor-pointer leading-none text-muted hover:text-accent disabled:cursor-not-allowed disabled:opacity-30"
                    >
                      ▲
                    </button>
                    <button
                      type="button"
                      disabled={!onMoveDown}
                      onClick={onMoveDown}
                      aria-label={t('staff.row.moveDown')}
                      className="cursor-pointer leading-none text-muted hover:text-accent disabled:cursor-not-allowed disabled:opacity-30"
                    >
                      ▼
                    </button>
                  </div>
                  <button
                    type="button"
                    aria-label={t('staff.row.drag')}
                    title={t('staff.row.drag')}
                    aria-roledescription={t('staff.row.drag')}
                    onPointerDown={onDragPointerDown}
                    onPointerMove={onDragPointerMove}
                    onPointerUp={onDragPointerUp}
                    onPointerCancel={onDragPointerUp}
                    className="flex h-9 w-9 shrink-0 cursor-grab touch-none items-center justify-center rounded-lg border-0 bg-transparent text-muted transition-colors select-none hover:text-accent active:cursor-grabbing"
                  >
                    <GripVertical className="h-4 w-4" />
                  </button>
                </>
              )}
            </div>
          )}
        </div>

        <div className="mt-2 flex flex-wrap items-center gap-2">
          {request.accepted_by_staff && <Avatar name={request.accepted_by_staff.name} />}
          <StatusBadge status={request.status} label={t(`statusLabel.${request.status}` as const)} />
          {request.assigned_job_title_ids.map((jobTitleId) => {
            const jobTitle = jobTitles.find((item) => item.id === jobTitleId)
            return jobTitle ? <Badge key={jobTitleId}>{jobTitle.name}</Badge> : null
          })}
          {request.urgent && (
            <Badge className="border border-bad-ink/25 bg-bad-bg text-bad-ink">
              <AlertTriangle className="mr-1 h-3 w-3" />
              {t('staff.row.urgent')}
            </Badge>
          )}
        </div>

        {!editing && request.note && <p className="mt-2 rounded-md bg-surface-2 p-2 text-sm text-muted">{request.note}</p>}

        {!editing && (
          <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-line pt-3">
            <div className="flex items-center gap-1.5">
              <Clock className="h-3.5 w-3.5 shrink-0 text-muted" />
              <p className="text-xs text-muted">{elapsedLabel}</p>
              {mode === 'done' && trackable && request.status === 'completed' && (
                <Badge className={request.returned_at ? 'bg-ok-bg text-ok-ink' : 'bg-wait-bg text-wait-ink'}>
                  {request.returned_at ? t('staff.row.returned') : t('staff.row.notReturned')}
                </Badge>
              )}
            </div>

            {mode === 'active' && (
              <div className="flex flex-wrap items-center gap-2">
                {canManageRequest && <Select
                  value={request.assigned_job_title_ids.length === 1 ? request.assigned_job_title_ids[0] : ''}
                  disabled={pending || jobTitles.length === 0}
                  onChange={(e) => run(() => reassignRequestToJobTitle(request.id, e.target.value))}
                  className="min-w-36 w-auto py-1 text-xs"
                >
                  <option value="" disabled>Mansione</option>
                  {jobTitles.map((jobTitle) => (
                    <option key={jobTitle.id} value={jobTitle.id}>
                      {jobTitle.name}
                    </option>
                  ))}
                </Select>}
                {/* Destructive/routing controls are Reception-only. Operational
                    staff can still claim and complete work assigned to them. */}
                {canManageRequest && (request.status === 'requested' ? (
                  <IconButton tone="hintCaution" icon={X} label={t('staff.row.reject')} disabled={pending} onClick={onCancel} />
                ) : (
                  <IconButton tone="danger" icon={X} label={t('staff.row.cancel')} disabled={pending} onClick={onCancel} />
                ))}
                {canManageRequest && request.status === 'in_progress' && (
                  <IconButton tone="neutral" icon={ArrowLeft} label={t('staff.row.revert')} disabled={pending} onClick={() => run(() => revertRequest(request.id, 'in_progress'))} />
                )}
                {request.status === 'requested' && (
                  <IconButton tone="hintPositive" filled shape="circle" size="lg" icon={ArrowDownToLine} label={t('staff.row.claim')} disabled={pending} onClick={() => run(() => claimRequest(request.id, staffId))} />
                )}
                {request.status === 'in_progress' && (
                  <IconButton tone="ok" filled shape="circle" size="lg" icon={Check} label={t('staff.row.complete')} disabled={pending} onClick={() => run(() => completeRequest(request.id))} />
                )}
              </div>
            )}

            {mode === 'done' && (
              <div className="flex flex-wrap items-center gap-2">
                {trackable && request.status === 'completed' && !request.returned_at && (
                  <IconButton tone="ok" icon={PackageCheck} label={t('staff.row.markReturned')} disabled={pending} onClick={() => run(() => markItemReturned(request.id))} />
                )}
                {canManageRequest && <IconButton
                  tone="neutral"
                  icon={ArrowLeft}
                  label={t('staff.row.revert')}
                  disabled={pending}
                  onClick={() => run(() => revertRequest(request.id, request.status === 'completed' ? 'completed' : 'cancelled'))}
                />}
                {canManageRequest && <IconButton tone="danger" icon={Trash2} label={t('staff.row.delete')} disabled={pending} onClick={onDelete} />}
              </div>
            )}
          </div>
        )}
        {error && <p className="mt-2 text-xs text-bad-ink">{error}</p>}
      </CardBody>
    </Card>
  )
}
