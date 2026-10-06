import { useEffect, useMemo, useState } from 'react'
import { ArrowLeft, CheckCircle2, Clock, Globe, Map as MapIcon, Minus, Phone, Plus, Sparkles } from 'lucide-react'
import { Card, CardBody, CardHeader } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { FieldError, FieldGroup, Input, Label, Textarea } from '@/components/ui/field'
import { Badge } from '@/components/ui/badge'
import { CategoryIcon } from '@/components/category-icon'
import { createDiningReservationRequest, fetchDiningCatalog, fetchDiningHours, isInvalidSessionError } from '@/lib/guest-api'
import { useLocale } from '@/lib/i18n/locale-context'
import type { DiningCategory, DiningHour, DiningRestaurant } from '@/lib/types'

const DAY_LABELS_IT = ['Domenica', 'Lunedì', 'Martedì', 'Mercoledì', 'Giovedì', 'Venerdì', 'Sabato']
const PRICE_TIER = ['€', '€€', '€€€', '€€€€']

type Step =
  | { name: 'discover' }
  | { name: 'detail'; restaurant: DiningRestaurant }
  | { name: 'request'; restaurant: DiningRestaurant }
  | { name: 'confirmed'; restaurant: DiningRestaurant }

export function DiningFlow({ token, onSessionExpired }: { token: string; onSessionExpired: () => void }) {
  const { t } = useLocale()
  const [catalog, setCatalog] = useState<{ categories: DiningCategory[]; restaurants: DiningRestaurant[] } | null>(null)
  const [catalogError, setCatalogError] = useState<string | null>(null)
  const [step, setStep] = useState<Step>({ name: 'discover' })

  useEffect(() => {
    fetchDiningCatalog()
      .then(setCatalog)
      .catch(() => setCatalogError(t('dining.loadError')))
  }, [t])

  if (catalogError) return <p className="text-center text-sm text-bad-ink">{catalogError}</p>
  if (!catalog) return <p className="text-center text-sm text-muted">{t('flow.loading')}</p>

  if (step.name === 'discover') {
    return (
      <Discover
        categories={catalog.categories}
        restaurants={catalog.restaurants}
        onSelect={(restaurant) => setStep({ name: 'detail', restaurant })}
      />
    )
  }

  if (step.name === 'detail') {
    return (
      <RestaurantDetail
        restaurant={step.restaurant}
        category={catalog.categories.find((c) => c.id === step.restaurant.category_id) ?? null}
        onBack={() => setStep({ name: 'discover' })}
        onRequest={() => setStep({ name: 'request', restaurant: step.restaurant })}
      />
    )
  }

  if (step.name === 'request') {
    return (
      <RequestWizard
        restaurant={step.restaurant}
        token={token}
        onBack={() => setStep({ name: 'detail', restaurant: step.restaurant })}
        onSessionExpired={onSessionExpired}
        onSubmitted={() => setStep({ name: 'confirmed', restaurant: step.restaurant })}
      />
    )
  }

  return <ConfirmPanel restaurant={step.restaurant} onNewRequest={() => setStep({ name: 'discover' })} />
}

function Discover({ categories, restaurants, onSelect }: {
  categories: DiningCategory[]
  restaurants: DiningRestaurant[]
  onSelect: (restaurant: DiningRestaurant) => void
}) {
  const { t } = useLocale()
  const categoryName = (id: string) => categories.find((c) => c.id === id)?.name ?? ''
  const recommended = restaurants.filter((r) => r.is_recommended)
  const others = restaurants.filter((r) => !r.is_recommended)

  return (
    <div className="space-y-5">
      {recommended.length > 0 && (
        <section>
          <h3 className="mb-2 text-sm font-semibold text-foreground">{t('dining.recommended')}</h3>
          <div className="space-y-2">
            {recommended.map((restaurant) => <RestaurantRow key={restaurant.id} restaurant={restaurant} categoryName={categoryName(restaurant.category_id)} onSelect={onSelect} />)}
          </div>
        </section>
      )}
      <section>
        <h3 className="mb-2 text-sm font-semibold text-foreground">{recommended.length > 0 ? t('dining.others') : t('dining.allRestaurants')}</h3>
        <div className="space-y-2">
          {others.map((restaurant) => <RestaurantRow key={restaurant.id} restaurant={restaurant} categoryName={categoryName(restaurant.category_id)} onSelect={onSelect} />)}
        </div>
      </section>
      {restaurants.length === 0 && <p className="py-4 text-center text-sm text-muted">{t('dining.empty')}</p>}
    </div>
  )
}

function RestaurantRow({ restaurant, categoryName, onSelect }: { restaurant: DiningRestaurant; categoryName: string; onSelect: (r: DiningRestaurant) => void }) {
  const meta = [categoryName, restaurant.cuisine, restaurant.price_tier ? PRICE_TIER[restaurant.price_tier - 1] : null, restaurant.walk_minutes ? `${restaurant.walk_minutes} min a piedi` : null]
    .filter(Boolean)
    .join(' · ')
  return (
    <button
      type="button"
      onClick={() => onSelect(restaurant)}
      className="flex w-full cursor-pointer items-center gap-3 rounded-lg border border-line bg-white p-3.5 text-left shadow-sm transition-colors hover:border-accent-soft-line hover:bg-accent-soft"
    >
      <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-accent-soft text-sm font-bold text-accent">{restaurant.name[0]}</span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1.5">
          <span className="truncate text-sm font-semibold text-foreground">{restaurant.name}</span>
          {restaurant.is_recommended && <Sparkles size={13} className="shrink-0 text-accent" />}
        </span>
        {meta && <span className="block text-xs text-muted">{meta}</span>}
      </span>
    </button>
  )
}

function RestaurantDetail({ restaurant, category, onBack, onRequest }: {
  restaurant: DiningRestaurant
  category: DiningCategory | null
  onBack: () => void
  onRequest: () => void
}) {
  const { t } = useLocale()
  const [hours, setHours] = useState<DiningHour[] | null>(null)

  useEffect(() => {
    fetchDiningHours(restaurant.id).then(setHours).catch(() => setHours([]))
  }, [restaurant.id])

  const hoursByDay = useMemo(() => {
    const map = new Map<number, DiningHour[]>()
    for (const hour of hours ?? []) {
      const list = map.get(hour.day_of_week) ?? []
      list.push(hour)
      map.set(hour.day_of_week, list)
    }
    return map
  }, [hours])

  return (
    <div className="space-y-4">
      <button type="button" onClick={onBack} className="flex cursor-pointer items-center gap-1.5 text-xs font-semibold text-muted hover:text-foreground">
        <ArrowLeft size={14} /> {t('flow.back')}
      </button>

      <div className="flex h-36 items-center justify-center rounded-lg bg-gradient-to-br from-accent-soft to-surface-2 text-accent">
        <CategoryIcon icon={category?.icon ?? null} className="h-10 w-10" />
      </div>

      <div>
        <div className="flex items-center gap-2">
          <h2 className="text-lg font-bold text-foreground">{restaurant.name}</h2>
          {restaurant.is_recommended && <Badge className="bg-accent-soft text-accent"><Sparkles size={11} className="mr-1" />{t('dining.recommendedBadge')}</Badge>}
        </div>
        <p className="text-xs text-muted">
          {[category?.name, restaurant.cuisine, restaurant.price_tier ? PRICE_TIER[restaurant.price_tier - 1] : null].filter(Boolean).join(' · ')}
        </p>
      </div>

      {restaurant.concierge_description && (
        <div className="rounded-lg border border-accent-soft-line bg-accent-soft p-4">
          <p className="mb-1 text-[0.65rem] font-bold uppercase tracking-wide text-accent">{t('dining.concierge')}</p>
          <p className="text-sm italic text-foreground/80">&ldquo;{restaurant.concierge_description}&rdquo;</p>
        </div>
      )}
      {!restaurant.concierge_description && restaurant.description && (
        <p className="text-sm text-foreground/80">{restaurant.description}</p>
      )}

      {hoursByDay.size > 0 && (
        <Card>
          <CardHeader className="flex items-center gap-2 py-3"><Clock size={15} className="text-muted" /><h3 className="text-xs font-bold uppercase tracking-wide text-muted">{t('dining.hours')}</h3></CardHeader>
          <CardBody className="space-y-1.5 py-3">
            {DAY_LABELS_IT.map((label, day) => {
              const dayHours = hoursByDay.get(day)
              if (!dayHours) return null
              return (
                <div key={day} className="flex justify-between text-sm">
                  <span className="font-medium text-foreground">{label}</span>
                  <span className="text-muted">{dayHours.map((h) => `${h.opens_at.slice(0, 5)}–${h.closes_at.slice(0, 5)}`).join(', ')}</span>
                </div>
              )
            })}
          </CardBody>
        </Card>
      )}

      <div className="flex flex-wrap gap-2">
        {restaurant.maps_url && (
          <a href={restaurant.maps_url} target="_blank" rel="noreferrer" className="flex items-center gap-1.5 rounded-sm border border-line-strong bg-surface px-3 py-2 text-xs font-semibold text-foreground/75 hover:bg-surface-2">
            <MapIcon size={14} /> {t('dining.openMaps')}
          </a>
        )}
        {restaurant.website_url && (
          <a href={restaurant.website_url} target="_blank" rel="noreferrer" className="flex items-center gap-1.5 rounded-sm border border-line-strong bg-surface px-3 py-2 text-xs font-semibold text-foreground/75 hover:bg-surface-2">
            <Globe size={14} /> {t('dining.website')}
          </a>
        )}
        {restaurant.phone && (
          <a href={`tel:${restaurant.phone}`} className="flex items-center gap-1.5 rounded-sm border border-line-strong bg-surface px-3 py-2 text-xs font-semibold text-foreground/75 hover:bg-surface-2">
            <Phone size={14} /> {restaurant.phone}
          </a>
        )}
      </div>

      <Button type="button" className="w-full" onClick={onRequest}>{t('dining.requestTable')}</Button>
    </div>
  )
}

function RequestWizard({ restaurant, token, onBack, onSessionExpired, onSubmitted }: {
  restaurant: DiningRestaurant
  token: string
  onBack: () => void
  onSessionExpired: () => void
  onSubmitted: () => void
}) {
  const { t } = useLocale()
  const [date, setDate] = useState('')
  const [time, setTime] = useState('20:00')
  const [pax, setPax] = useState(2)
  const [note, setNote] = useState('')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function onConfirm() {
    setPending(true)
    setError(null)
    try {
      await createDiningReservationRequest(token, restaurant.id, date, time, pax, note.trim() || null)
      onSubmitted()
    } catch (cause) {
      if (isInvalidSessionError(cause)) {
        onSessionExpired()
        return
      }
      setError(t('dining.sendError'))
    } finally {
      setPending(false)
    }
  }

  return (
    <Card>
      <CardHeader className="flex items-center gap-2">
        <button type="button" onClick={onBack} className="cursor-pointer text-muted hover:text-foreground" aria-label={t('flow.back')}><ArrowLeft size={18} /></button>
        <h2 className="text-sm font-semibold text-foreground">{t('dining.requestFor', { name: restaurant.name })}</h2>
      </CardHeader>
      <CardBody>
        <FieldGroup>
          <Label htmlFor="dining-date">{t('dining.date')}</Label>
          <Input id="dining-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </FieldGroup>
        <FieldGroup>
          <Label htmlFor="dining-time">{t('dining.time')}</Label>
          <Input id="dining-time" type="time" value={time} onChange={(e) => setTime(e.target.value)} />
        </FieldGroup>
        <FieldGroup>
          <Label>{t('dining.pax')}</Label>
          <div className="flex items-center gap-3">
            <Button type="button" variant="outline" size="sm" disabled={pax <= 1} onClick={() => setPax((p) => Math.max(1, p - 1))} aria-label={t('flow.quantityDecrease')}><Minus size={14} /></Button>
            <span className="w-8 text-center text-sm font-medium tabular-nums">{pax}</span>
            <Button type="button" variant="outline" size="sm" onClick={() => setPax((p) => Math.min(12, p + 1))} aria-label={t('flow.quantityIncrease')}><Plus size={14} /></Button>
          </div>
        </FieldGroup>
        <FieldGroup>
          <Label htmlFor="dining-note">{t('dining.preferences')}</Label>
          <Textarea id="dining-note" rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder={t('dining.preferencesPlaceholder')} />
        </FieldGroup>
        <FieldError>{error ?? undefined}</FieldError>
        <Button type="button" disabled={!date || pending} className="mt-2 w-full" onClick={onConfirm}>{pending ? t('flow.sendPending') : t('dining.send')}</Button>
      </CardBody>
    </Card>
  )
}

function ConfirmPanel({ restaurant, onNewRequest }: { restaurant: DiningRestaurant; onNewRequest: () => void }) {
  const { t } = useLocale()
  return (
    <div className="rounded-lg border border-ok-ink/25 bg-ok-bg p-6 text-center">
      <CheckCircle2 size={28} className="mx-auto mb-2 text-ok-ink" />
      <p className="text-lg font-semibold text-ok-ink">{t('dining.confirmTitle')}</p>
      <p className="mt-2 text-sm text-ok-ink">{t('dining.confirmBody', { name: restaurant.name })}</p>
      <Button variant="outline" className="mt-4 bg-white" onClick={onNewRequest}>{t('dining.allRestaurants')}</Button>
    </div>
  )
}
