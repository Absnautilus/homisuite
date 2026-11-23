import { useEffect, useState } from 'react'
import { Star } from 'lucide-react'
import { Card, CardBody } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { StatusBadge } from '@/components/ui/badge'
import { Textarea } from '@/components/ui/field'
import { cancelDiningReservation, createDiningReservationFeedback, fetchDiningCatalog, isInvalidSessionError, listMyDiningReservations } from '@/lib/guest-api'
import { useLocale } from '@/lib/i18n/locale-context'
import type { DiningReservation, DiningReservationStatus, DiningRestaurant } from '@/lib/types'

// Dining has its own, richer status set than guest_requests' simple
// requested/in_progress/completed/cancelled (see DiningReservationStatus's
// own comment) -- reusing StatusBadge's existing four color buckets rather
// than inventing a fifth set of badge colors just for this screen.
const STATUS_BUCKET: Record<DiningReservationStatus, 'requested' | 'in_progress' | 'completed' | 'cancelled'> = {
  new: 'requested',
  pending: 'requested',
  scheduled: 'requested',
  in_progress: 'in_progress',
  unavailable: 'in_progress',
  confirmed: 'completed',
  cancelled: 'cancelled',
  declined: 'cancelled',
}

function isRateable(reservation: DiningReservation): boolean {
  const today = new Date().toISOString().slice(0, 10)
  return reservation.confirmation_status === 'confirmed' && reservation.reservation_date < today
}

// Mirrors cancel_dining_reservation's own WHERE clause -- not already
// cancelled/declined, and not already in the past -- so the button only
// ever shows when the RPC would actually succeed.
function isCancellable(reservation: DiningReservation): boolean {
  const today = new Date().toISOString().slice(0, 10)
  return reservation.confirmation_status !== 'cancelled' && reservation.confirmation_status !== 'declined' && reservation.reservation_date >= today
}

export function DiningMyReservations({ token, onSessionExpired }: { token: string; onSessionExpired: () => void }) {
  const { t } = useLocale()
  const [reservations, setReservations] = useState<DiningReservation[] | null>(null)
  const [restaurants, setRestaurants] = useState<DiningRestaurant[]>([])
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetchDiningCatalog()
      .then(({ restaurants }) => setRestaurants(restaurants))
      .catch(() => {
        // the cards still work without a resolved restaurant name, just less useful
      })
  }, [])

  useEffect(() => {
    listMyDiningReservations(token)
      .then(setReservations)
      .catch((cause) => {
        if (isInvalidSessionError(cause)) {
          onSessionExpired()
          return
        }
        setError(t('dining.loadReservationsError'))
      })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token])

  const restaurantName = (id: string) => restaurants.find((r) => r.id === id)?.name ?? ''

  if (error) return <p className="text-center text-sm text-bad-ink">{error}</p>
  if (!reservations) return <p className="text-center text-sm text-muted">{t('flow.loading')}</p>
  if (reservations.length === 0) return <p className="text-center text-sm text-muted">{t('dining.myReservationsEmpty')}</p>

  return (
    <div className="space-y-3">
      {reservations.map((reservation) => (
        <ReservationCard
          key={reservation.id}
          reservation={reservation}
          restaurantName={restaurantName(reservation.restaurant_id)}
          token={token}
          onSessionExpired={onSessionExpired}
          onFeedbackSaved={(rating, comment) => {
            setReservations((prev) =>
              prev?.map((r) => (r.id === reservation.id ? { ...r, feedback_rating: rating, feedback_comment: comment } : r)) ?? null,
            )
          }}
          onCancelled={(updated) => {
            setReservations((prev) => prev?.map((r) => (r.id === updated.id ? updated : r)) ?? null)
          }}
        />
      ))}
    </div>
  )
}

function formatDate(iso: string, locale: string): string {
  return new Date(`${iso}T00:00:00`).toLocaleDateString(locale, { day: '2-digit', month: 'long' })
}

function ReservationCard({ reservation, restaurantName, token, onSessionExpired, onFeedbackSaved, onCancelled }: {
  reservation: DiningReservation
  restaurantName: string
  token: string
  onSessionExpired: () => void
  onFeedbackSaved: (rating: 1 | 2 | 3 | 4 | 5, comment: string | null) => void
  onCancelled: (updated: DiningReservation) => void
}) {
  const { t, locale } = useLocale()
  const [editing, setEditing] = useState(false)
  const [cancelling, setCancelling] = useState(false)
  const [cancelError, setCancelError] = useState<string | null>(null)
  const bucket = STATUS_BUCKET[reservation.confirmation_status]
  const rateable = isRateable(reservation)
  const cancellable = isCancellable(reservation)

  async function handleCancel() {
    setCancelling(true)
    setCancelError(null)
    try {
      const updated = await cancelDiningReservation(token, reservation.id)
      onCancelled(updated)
    } catch (cause) {
      if (isInvalidSessionError(cause)) {
        onSessionExpired()
        return
      }
      setCancelError(t('dining.cancelError'))
    } finally {
      setCancelling(false)
    }
  }

  return (
    <Card>
      <CardBody>
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-sm font-semibold text-foreground">{restaurantName}</p>
            <p className="mt-0.5 text-xs text-muted">
              {formatDate(reservation.reservation_date, locale)} · {reservation.reservation_time.slice(0, 5)} · {t('dining.pax')} {reservation.party_size}
            </p>
          </div>
          <div className="flex shrink-0 flex-col items-end gap-1.5">
            <StatusBadge status={bucket} label={t(`dining.myStatus.${bucket}`)} />
            {cancellable && (
              <button type="button" disabled={cancelling} onClick={() => void handleCancel()} className="cursor-pointer text-xs text-muted hover:text-bad-ink disabled:cursor-wait">
                {t('status.cancel')}
              </button>
            )}
          </div>
        </div>
        {cancelError && <p className="mt-1.5 text-xs text-bad-ink">{cancelError}</p>}

        {reservation.feedback_rating && !editing ? (
          <div className="mt-3 border-t border-line pt-3">
            <StarRow value={reservation.feedback_rating} />
            {reservation.feedback_comment && <p className="mt-1.5 text-xs text-foreground/80">{reservation.feedback_comment}</p>}
            <button type="button" onClick={() => setEditing(true)} className="mt-1.5 cursor-pointer text-xs font-semibold text-accent hover:underline">
              {t('dining.feedbackEdit')}
            </button>
          </div>
        ) : rateable && !editing ? (
          <div className="mt-3 border-t border-line pt-3">
            <button type="button" onClick={() => setEditing(true)} className="cursor-pointer text-xs font-semibold text-accent hover:underline">
              {t('dining.leaveFeedback')}
            </button>
          </div>
        ) : null}

        {rateable && editing ? (
          <FeedbackForm
            reservation={reservation}
            token={token}
            onSessionExpired={onSessionExpired}
            onDone={(rating, comment) => {
              onFeedbackSaved(rating, comment)
              setEditing(false)
            }}
            onCancel={() => setEditing(false)}
          />
        ) : null}
      </CardBody>
    </Card>
  )
}

function StarRow({ value, size = 15 }: { value: number; size?: number }) {
  return (
    <div className="flex gap-0.5" aria-hidden="true">
      {[1, 2, 3, 4, 5].map((n) => (
        <Star key={n} size={size} className={n <= value ? 'fill-accent text-accent' : 'text-line-strong'} />
      ))}
    </div>
  )
}

function FeedbackForm({ reservation, token, onSessionExpired, onDone, onCancel }: {
  reservation: DiningReservation
  token: string
  onSessionExpired: () => void
  onDone: (rating: 1 | 2 | 3 | 4 | 5, comment: string | null) => void
  onCancel: () => void
}) {
  const { t } = useLocale()
  const [rating, setRating] = useState<1 | 2 | 3 | 4 | 5>(reservation.feedback_rating ?? 5)
  const [comment, setComment] = useState(reservation.feedback_comment ?? '')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit() {
    setPending(true)
    setError(null)
    try {
      await createDiningReservationFeedback(token, reservation.id, rating, comment.trim() || null)
      onDone(rating, comment.trim() || null)
    } catch (cause) {
      if (isInvalidSessionError(cause)) {
        onSessionExpired()
        return
      }
      setError(t('dining.feedbackSendError'))
    } finally {
      setPending(false)
    }
  }

  return (
    <div className="mt-3 space-y-2.5 border-t border-line pt-3">
      <div className="flex gap-1">
        {[1, 2, 3, 4, 5].map((n) => (
          <button
            key={n}
            type="button"
            onClick={() => setRating(n as 1 | 2 | 3 | 4 | 5)}
            aria-label={t('dining.feedbackRatingValue', { value: n })}
            className="cursor-pointer p-0.5"
          >
            <Star size={22} className={n <= rating ? 'fill-accent text-accent' : 'text-line-strong'} />
          </button>
        ))}
      </div>
      <Textarea
        rows={2}
        maxLength={500}
        value={comment}
        onChange={(e) => setComment(e.target.value)}
        placeholder={t('dining.feedbackCommentPlaceholder')}
      />
      {error && <p className="text-xs text-bad-ink">{error}</p>}
      <div className="flex gap-2">
        <Button type="button" size="sm" disabled={pending} onClick={() => void submit()}>
          {pending ? t('flow.sendPending') : t('dining.feedbackSend')}
        </Button>
        <Button type="button" variant="outline" size="sm" disabled={pending} onClick={onCancel}>
          {t('flow.back')}
        </Button>
      </div>
    </div>
  )
}
