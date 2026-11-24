import { useEffect, useMemo, useState } from 'react'
import { ArrowLeft, CheckCircle2, ChevronDown, Clock, Globe, Map as MapIcon, Minus, Phone, Plus, Sparkles } from 'lucide-react'
import { useUndo } from '@homisuite/ui'
import { Card, CardBody, CardHeader } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { FieldError, FieldGroup, Input, Label, Textarea } from '@/components/ui/field'
import { Badge } from '@/components/ui/badge'
import { CategoryIcon } from '@/components/category-icon'
import { cancelDiningReservation, createDiningReservationRequest, fetchDiningCatalog, fetchDiningHours, fetchDiningPhotos, isInvalidSessionError } from '@/lib/guest-api'
import { useLocale } from '@/lib/i18n/locale-context'
import { useBackableStep } from '@/lib/use-backable-step'
import type { DiningCategory, DiningHour, DiningPhoto, DiningRestaurant } from '@/lib/types'

const PRICE_TIER = ['€', '€€', '€€€', '€€€€']

// day_of_week is 0=Sunday..6=Saturday (Postgres extract(dow)); 2024-01-07
// was itself a Sunday, so offsetting from it lines up every index with the
// matching weekday without hardcoding any language's names.
function weekdayLabel(locale: string, dayOfWeek: number): string {
  const date = new Date(Date.UTC(2024, 0, 7 + dayOfWeek))
  return new Intl.DateTimeFormat(locale, { weekday: 'long', timeZone: 'UTC' }).format(date)
}

type Step =
  | { name: 'discover' }
  | { name: 'category'; category: DiningCategory }
  | { name: 'detail'; restaurant: DiningRestaurant }
  | { name: 'request'; restaurant: DiningRestaurant }
  | { name: 'confirmed'; restaurant: DiningRestaurant }

export function DiningFlow({ token, onSessionExpired }: { token: string; onSessionExpired: () => void }) {
  const { t } = useLocale()
  const [catalog, setCatalog] = useState<{ categories: DiningCategory[]; restaurants: DiningRestaurant[] } | null>(null)
  const [catalogError, setCatalogError] = useState<string | null>(null)
  const [step, setStep] = useBackableStep<Step>({ name: 'discover' })

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
        onSelectCategory={(category) => setStep({ name: 'category', category })}
        onSelect={(restaurant) => setStep({ name: 'detail', restaurant })}
      />
    )
  }

  if (step.name === 'category') {
    return (
      <CategoryList
        category={step.category}
        restaurants={catalog.restaurants.filter((r) => r.category_id === step.category.id)}
        onBack={() => setStep({ name: 'discover' })}
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

function Discover({ categories, restaurants, onSelectCategory, onSelect }: {
  categories: DiningCategory[]
  restaurants: DiningRestaurant[]
  onSelectCategory: (category: DiningCategory) => void
  onSelect: (restaurant: DiningRestaurant) => void
}) {
  const { t } = useLocale()
  const [recommendedExpanded, setRecommendedExpanded] = useState(false)
  const categoryName = (id: string) => categories.find((c) => c.id === id)?.name ?? ''
  const recommended = restaurants.filter((r) => r.is_recommended)
  const RECOMMENDED_COLLAPSED_COUNT = 3
  const visibleRecommended = recommendedExpanded ? recommended : recommended.slice(0, RECOMMENDED_COLLAPSED_COUNT)
  // One card per category instead of a flat section listing every one of
  // its restaurants inline -- with a dozen+ places split across just two or
  // three categories, that used to mean scrolling past a long undifferentiated
  // list before reaching the one the guest actually wants. Categories arrive
  // pre-sorted by sort_order, same order Impostazioni/Categorie already uses.
  const groups = categories
    .map((category) => ({ category, restaurants: restaurants.filter((r) => r.category_id === category.id) }))
    .filter((group) => group.restaurants.length > 0)

  return (
    <div className="space-y-5">
      {recommended.length > 0 && (
        <section>
          <h3 className="mb-2 text-sm font-semibold text-foreground">{t('dining.recommended')}</h3>
          <div className="space-y-2">
            {visibleRecommended.map((restaurant) => <RestaurantRow key={restaurant.id} restaurant={restaurant} categoryName={categoryName(restaurant.category_id)} onSelect={onSelect} />)}
          </div>
          {recommended.length > RECOMMENDED_COLLAPSED_COUNT && (
            <button
              type="button"
              onClick={() => setRecommendedExpanded((v) => !v)}
              className="mx-auto mt-3 flex cursor-pointer items-center gap-1.5 rounded-full bg-accent-soft px-4 py-2 text-xs font-semibold text-accent transition-colors hover:bg-accent-soft-line"
            >
              {recommendedExpanded ? t('dining.collapse') : t('dining.expand')}
              <ChevronDown size={14} className={`transition-transform ${recommendedExpanded ? 'rotate-180' : ''}`} />
            </button>
          )}
        </section>
      )}
      {groups.length > 0 && (
        <section>
          <div className="grid grid-cols-2 gap-3">
            {groups.map(({ category, restaurants: groupRestaurants }) => (
              <CategoryCard key={category.id} category={category} restaurants={groupRestaurants} onSelect={() => onSelectCategory(category)} />
            ))}
          </div>
        </section>
      )}
      {restaurants.length === 0 && <p className="py-4 text-center text-sm text-muted">{t('dining.empty')}</p>}
    </div>
  )
}

function CategoryCard({ category, restaurants, onSelect }: { category: DiningCategory; restaurants: DiningRestaurant[]; onSelect: () => void }) {
  const { t } = useLocale()
  const nearestWalk = restaurants.reduce<number | null>((min, r) => {
    if (r.walk_minutes == null) return min
    return min === null ? r.walk_minutes : Math.min(min, r.walk_minutes)
  }, null)
  const preview = nearestWalk != null
    ? t('dining.categoryPreview', { count: restaurants.length, minutes: nearestWalk })
    : t('dining.categoryPreviewNoWalk', { count: restaurants.length })

  return (
    <button
      type="button"
      onClick={onSelect}
      className="flex cursor-pointer flex-col items-center overflow-hidden rounded-lg border border-line bg-white text-center shadow-sm transition-colors hover:border-accent-soft-line hover:bg-accent-soft"
    >
      {category.image_url ? (
        <img src={category.image_url} alt="" className="h-24 w-full object-cover" />
      ) : (
        <span className="mt-5 flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-accent-soft text-accent">
          {/* Most hotels never set a per-category icon or photo --
              falling back to the generic "..." glyph here means every
              single card shows the exact same placeholder, which reads
              as broken rather than merely plain. The category's own
              initial, same treatment RestaurantRow already uses for a
              restaurant with no cover photo, at least tells cards apart. */}
          {category.icon ? <CategoryIcon icon={category.icon} className="h-5 w-5" /> : <span className="text-sm font-bold">{category.name.trim()[0]?.toUpperCase()}</span>}
        </span>
      )}
      <span className="min-w-0 px-5 pt-2 pb-5">
        <span className="block text-sm font-semibold text-foreground">{category.name}</span>
        <span className="block text-xs text-muted">{preview}</span>
      </span>
    </button>
  )
}

function CategoryList({ category, restaurants, onBack, onSelect }: {
  category: DiningCategory
  restaurants: DiningRestaurant[]
  onBack: () => void
  onSelect: (restaurant: DiningRestaurant) => void
}) {
  const { t } = useLocale()
  const [priceFilter, setPriceFilter] = useState<number | null>(null)
  // Only offer tiers that actually occur in this category -- a chip for
  // "€€€€" nobody here charges would just be a dead end.
  const availableTiers = Array.from(new Set(restaurants.map((r) => r.price_tier).filter((tier): tier is 1 | 2 | 3 | 4 => tier != null))).sort()
  const filtered = restaurants
    .filter((r) => priceFilter === null || r.price_tier === priceFilter)
    .sort((a, b) => (a.walk_minutes ?? Infinity) - (b.walk_minutes ?? Infinity))

  return (
    <div className="space-y-4">
      <button type="button" onClick={onBack} className="flex cursor-pointer items-center gap-1.5 text-xs font-semibold text-muted hover:text-foreground">
        <ArrowLeft size={14} /> {category.name}
      </button>
      {availableTiers.length > 1 && (
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => setPriceFilter(null)}
            className={`rounded-full border px-3 py-1 text-xs font-semibold transition-colors ${priceFilter === null ? 'border-accent bg-accent text-white' : 'border-line-strong bg-white text-muted hover:text-foreground'}`}
          >
            {t('dining.priceAll')}
          </button>
          {availableTiers.map((tier) => (
            <button
              key={tier}
              type="button"
              onClick={() => setPriceFilter(tier)}
              className={`rounded-full border px-3 py-1 text-xs font-semibold transition-colors ${priceFilter === tier ? 'border-accent bg-accent text-white' : 'border-line-strong bg-white text-muted hover:text-foreground'}`}
            >
              {PRICE_TIER[tier - 1]}
            </button>
          ))}
        </div>
      )}
      <div className="space-y-2">
        {filtered.map((restaurant) => <RestaurantRow key={restaurant.id} restaurant={restaurant} categoryName="" onSelect={onSelect} />)}
        {filtered.length === 0 && <p className="py-4 text-center text-sm text-muted">{t('dining.noFilterMatches')}</p>}
      </div>
    </div>
  )
}

function RestaurantRow({ restaurant, categoryName, onSelect }: { restaurant: DiningRestaurant; categoryName: string; onSelect: (r: DiningRestaurant) => void }) {
  const { t } = useLocale()
  const meta = [categoryName, restaurant.cuisine, restaurant.price_tier ? PRICE_TIER[restaurant.price_tier - 1] : null, restaurant.walk_minutes ? t('dining.walkMinutes', { minutes: restaurant.walk_minutes }) : null]
    .filter(Boolean)
    .join(' · ')
  return (
    <button
      type="button"
      onClick={() => onSelect(restaurant)}
      className="flex w-full cursor-pointer items-center gap-3 rounded-lg border border-line bg-white p-3.5 text-left shadow-sm transition-colors hover:border-accent-soft-line hover:bg-accent-soft"
    >
      {restaurant.cover_image_url ? (
        <img src={restaurant.cover_image_url} alt="" className="h-11 w-11 shrink-0 rounded-full object-cover" />
      ) : (
        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-accent-soft text-sm font-bold text-accent">{restaurant.name[0]}</span>
      )}
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
  const { t, locale } = useLocale()
  const [hours, setHours] = useState<DiningHour[] | null>(null)
  const [photos, setPhotos] = useState<DiningPhoto[]>([])

  useEffect(() => {
    fetchDiningHours(restaurant.id).then(setHours).catch(() => setHours([]))
    fetchDiningPhotos(restaurant.id).then(setPhotos).catch(() => setPhotos([]))
  }, [restaurant.id])

  // Google's Place Photos terms require crediting each photo's author
  // wherever it's shown -- one caption below the strip, de-duplicated,
  // rather than repeating the same name under every thumbnail.
  const photoCredits = useMemo(
    () => Array.from(new Set(photos.map((p) => p.attribution).filter((value): value is string => Boolean(value)))),
    [photos],
  )

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

      {photos.length > 0 ? (
        <div>
          <div className="flex h-36 gap-2 overflow-x-auto">
            {photos.map((photo) => (
              <img key={photo.id} src={photo.image_url} alt="" className="h-36 w-48 shrink-0 rounded-lg object-cover" />
            ))}
          </div>
          {photoCredits.length > 0 && <p className="mt-1 text-[0.65rem] text-muted">{t('dining.photoCredit', { names: photoCredits.join(', ') })}</p>}
        </div>
      ) : (
        <div className="flex h-36 items-center justify-center rounded-lg bg-gradient-to-br from-accent-soft to-surface-2 text-accent">
          <CategoryIcon icon={category?.icon ?? null} className="h-10 w-10" />
        </div>
      )}

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
            {Array.from({ length: 7 }, (_, day) => {
              const dayHours = hoursByDay.get(day)
              if (!dayHours) return null
              return (
                <div key={day} className="flex justify-between text-sm">
                  <span className="font-medium text-foreground capitalize">{weekdayLabel(locale, day)}</span>
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
  const pushUndo = useUndo()
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
      const reservationId = await createDiningReservationRequest(token, restaurant.id, date, time, pax, note.trim() || null)
      onSubmitted()
      // A brand-new reservation is always in a cancellable state (see
      // cancelDiningReservation's own comment) -- undoing the creation is
      // exactly a cancel, no separate "delete" RPC needed.
      pushUndo({
        message: t('dining.confirmTitle'),
        undo: async () => {
          await cancelDiningReservation(token, reservationId)
        },
      })
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
            <Button type="button" variant="outline" size="sm" onClick={() => setPax((p) => Math.min(20, p + 1))} aria-label={t('flow.quantityIncrease')}><Plus size={14} /></Button>
          </div>
        </FieldGroup>
        <FieldGroup>
          <Label htmlFor="dining-note">{t('dining.preferences')}</Label>
          <Textarea id="dining-note" rows={2} maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} placeholder={t('dining.preferencesPlaceholder')} />
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
