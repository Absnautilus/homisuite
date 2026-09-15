import type { ReactNode } from 'react'
import { CalendarClock, Coffee, Mail, MapPin, MessageCircle, Phone, Wifi, Wine } from 'lucide-react'
import { SectionCard } from '@/components/section-card'
import { useLocale } from '@/lib/i18n/locale-context'
import type { StayInfo } from '@/lib/guest-api'

// wa.me needs digits only (country code included, no leading + or 00) --
// strips whatever formatting the hotel typed into Settings' "Telefono"
// field (spaces, dashes, parentheses, a leading +). Never a Homisuite
// number: this is always the mapped property's own settings.phone,
// resolved server-side by guest_stay_info -- absent there just means no
// WhatsApp action, not a fallback to someone else's contact.
function buildWhatsappHref(phone: string | null): string | null {
  if (!phone) return null
  const digits = phone.replace(/\D/g, '')
  return digits ? `https://wa.me/${digits}` : null
}

// The date always comes from the stay's own check_out_at -- that's the
// guest's real departure day. The time-of-day is the hotel's own default
// ("Orario check-out predefinito" in Settings, a plain HH:MM string) when
// set, since check_out_at's stored time is often just whatever a
// front-desk default landed on at check-in, not a deliberate per-guest
// choice; falls back to check_out_at's own time only when the hotel never
// set one. Matches the rest of the app's own convention (request-flow.tsx,
// status-list.tsx) of formatting every timestamp in 'it-IT' regardless of
// the guest's selected UI language -- not a new inconsistency introduced
// here.
function formatCheckout(checkOutAt: string, hotelCheckOutTime: string | null): { date: string; time: string } {
  const d = new Date(checkOutAt)
  return {
    date: d.toLocaleDateString('it-IT', { day: '2-digit', month: '2-digit' }),
    time: hotelCheckOutTime ?? d.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' }),
  }
}

export function GreetingHeader({ stay }: { stay: StayInfo }) {
  const { t } = useLocale()
  const hour = new Date().getHours()
  const timeOfDay = hour < 18 ? t('greeting.morning') : t('greeting.evening')

  return (
    <div className="rounded-lg border border-accent-soft-line bg-accent-soft px-4 py-3">
      <span className="inline-flex items-center gap-1.5 rounded-full bg-accent px-2.5 py-1 text-xs font-semibold text-white">
        {t('greeting.room')} {stay.room_number}
      </span>
      <p className="mt-2 text-sm text-accent">
        {timeOfDay} {t('greeting.line', { name: stay.guest_last_name })}
      </p>
    </div>
  )
}

function InfoRow({ icon, children }: { icon: ReactNode; children: ReactNode }) {
  return (
    <div className="flex items-start gap-2 text-xs text-muted">
      <span className="mt-0.5 shrink-0">{icon}</span>
      <div>{children}</div>
    </div>
  )
}

export function GeneralInfoCard({ stay }: { stay: StayInfo }) {
  const { t } = useLocale()
  const { date, time } = formatCheckout(stay.check_out_at, stay.hotel_check_out_time)
  const hasWifi = Boolean(stay.hotel_wifi_network || stay.hotel_wifi_password)

  return (
    <SectionCard title={t('greeting.generalInfo')}>
      <div className="space-y-2.5">
        <InfoRow icon={<CalendarClock size={14} />}>
          {t('greeting.checkoutLabel')}: {t('greeting.checkoutAt', { date, time })}
        </InfoRow>
        {hasWifi && (
          <InfoRow icon={<Wifi size={14} />}>
            {stay.hotel_wifi_network && <p className="font-medium text-foreground">{stay.hotel_wifi_network}</p>}
            {stay.hotel_wifi_password && (
              <p>
                {t('greeting.wifiPassword')}: {stay.hotel_wifi_password}
              </p>
            )}
          </InfoRow>
        )}
        {stay.hotel_breakfast_hours && (
          <InfoRow icon={<Coffee size={14} />}>
            {t('greeting.breakfast')}: {stay.hotel_breakfast_hours}
          </InfoRow>
        )}
        {stay.hotel_bar_hours && (
          <InfoRow icon={<Wine size={14} />}>
            {t('greeting.bar')}: {stay.hotel_bar_hours}
          </InfoRow>
        )}
      </div>
    </SectionCard>
  )
}

export function ContactsCard({ stay }: { stay: StayInfo }) {
  const { t } = useLocale()
  const whatsappHref = buildWhatsappHref(stay.hotel_phone)
  const hasHotelInfo = Boolean(stay.hotel_address || stay.hotel_phone || stay.hotel_email || whatsappHref)
  if (!hasHotelInfo) return null

  return (
    <SectionCard title={t('greeting.contacts')}>
      <div className="space-y-3">
        {stay.hotel_address && (
          <p className="flex items-center gap-1.5 text-xs text-muted">
            <MapPin size={14} className="shrink-0" />
            {stay.hotel_address}
          </p>
        )}
        <div className="grid grid-cols-3 gap-2">
          {stay.hotel_phone && (
            <a
              href={`tel:${stay.hotel_phone}`}
              className="flex flex-col items-center gap-1.5 rounded-lg bg-surface-2 py-2.5 text-center transition-colors hover:bg-accent-soft"
            >
              <span className="flex h-8 w-8 items-center justify-center rounded-full bg-accent-soft text-accent">
                <Phone size={14} />
              </span>
              <span className="text-[11px] font-semibold text-foreground">{t('greeting.call')}</span>
            </a>
          )}
          {stay.hotel_email && (
            <a
              href={`mailto:${stay.hotel_email}`}
              className="flex flex-col items-center gap-1.5 rounded-lg bg-surface-2 py-2.5 text-center transition-colors hover:bg-accent-soft"
            >
              <span className="flex h-8 w-8 items-center justify-center rounded-full bg-accent-soft text-accent">
                <Mail size={14} />
              </span>
              <span className="text-[11px] font-semibold text-foreground">{t('greeting.email')}</span>
            </a>
          )}
          {whatsappHref && (
            <a
              href={whatsappHref}
              target="_blank"
              rel="noreferrer"
              className="flex flex-col items-center gap-1.5 rounded-lg bg-surface-2 py-2.5 text-center transition-colors hover:bg-accent-soft"
            >
              <span className="flex h-8 w-8 items-center justify-center rounded-full bg-accent text-white">
                <MessageCircle size={14} />
              </span>
              <span className="text-[11px] font-semibold text-foreground">WhatsApp</span>
            </a>
          )}
        </div>
      </div>
    </SectionCard>
  )
}
