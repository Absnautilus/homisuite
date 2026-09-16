import type { ReactNode } from 'react'
import { CalendarClock, Coffee, Globe, Mail, MapPin, Phone, Wifi, Wine } from 'lucide-react'
import { SectionCard } from '@/components/section-card'
import { useLocale } from '@/lib/i18n/locale-context'
import type { StayInfo } from '@/lib/guest-api'

// lucide-react ships no brand/logo icons (dropped to keep the set neutral),
// so WhatsApp's own glyph is drawn here instead of substituting a generic
// chat-bubble icon. currentColor keeps it styled the same as the Chiama/
// Email tiles (a single accent color), not the brand's own green/white.
function WhatsAppIcon({ size = 14 }: { size?: number }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="currentColor" aria-hidden="true">
      <path d="M12.04 2C6.58 2 2.13 6.45 2.13 11.91c0 1.75.46 3.39 1.26 4.82L2 22l5.42-1.42a9.87 9.87 0 0 0 4.62 1.18h.01c5.46 0 9.9-4.45 9.9-9.9 0-2.65-1.03-5.14-2.9-7.01A9.82 9.82 0 0 0 12.04 2Zm5.8 14.14c-.24.68-1.4 1.32-1.93 1.4-.5.08-1.11.11-1.79-.11a16.3 16.3 0 0 1-1.63-.6c-2.87-1.24-4.74-4.13-4.88-4.32-.14-.19-1.17-1.56-1.17-2.98 0-1.42.74-2.11 1-2.4.26-.29.57-.36.76-.36.19 0 .38 0 .55.01.18.01.41-.07.64.49.24.58.81 2 .88 2.14.07.14.12.31.02.5-.09.19-.14.31-.28.48-.14.17-.29.37-.42.5-.14.14-.28.29-.12.57.16.28.71 1.17 1.52 1.9 1.05.94 1.93 1.23 2.21 1.37.28.14.44.12.6-.07.16-.19.68-.79.87-1.06.19-.28.37-.23.62-.14.26.09 1.63.77 1.91.91.28.14.47.21.53.33.07.12.07.68-.17 1.36Z" />
    </svg>
  )
}

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

function BandRow({ icon, children }: { icon: ReactNode; children: ReactNode }) {
  return (
    <div className="flex items-start gap-2 py-1 text-sm text-muted">
      <span className="mt-0.5 shrink-0 text-accent">{icon}</span>
      <div>{children}</div>
    </div>
  )
}

// Replaces the old separate room-badge greeting strip + plain "Informazioni
// generali" list with a single branded band: the hotel's accent color fills
// the top (a visual anchor tying the guest app to the specific property,
// not just Homisuite purple everywhere), with the stay's practical details
// overlapping it in a white card below -- same data as before, just no
// longer reading as a generic, hotel-agnostic list.
export function BrandedInfoBand({ stay }: { stay: StayInfo }) {
  const { t } = useLocale()
  const hour = new Date().getHours()
  const timeOfDay = hour < 18 ? t('greeting.morning') : t('greeting.evening')
  const { date, time } = formatCheckout(stay.check_out_at, stay.hotel_check_out_time)
  const hasWifi = Boolean(stay.hotel_wifi_network || stay.hotel_wifi_password)

  return (
    <div className="overflow-hidden rounded-lg border border-line">
      <div className="bg-[linear-gradient(135deg,var(--accent),color-mix(in_srgb,var(--accent)_60%,#1b0c24))] px-4 pt-4 pb-9">
        <p className="text-base font-extrabold text-white">{timeOfDay} {t('greeting.line', { name: stay.guest_last_name })}</p>
        <p className="mt-1 text-sm text-white/80">
          {stay.hotel_name ?? 'Homisuite'} · {t('greeting.room')} {stay.room_number}
        </p>
      </div>
      <div className="relative -mt-5 mx-2 mb-2 space-y-0.5 rounded-lg bg-white p-3 shadow-md">
        <BandRow icon={<CalendarClock size={14} />}>
          {t('greeting.checkoutLabel')}{' '}
          <span className="font-semibold text-foreground">{t('greeting.checkoutAt', { date, time })}</span>
        </BandRow>
        {hasWifi && (
          <BandRow icon={<Wifi size={14} />}>
            {stay.hotel_wifi_network && <p className="font-semibold text-foreground">{stay.hotel_wifi_network}</p>}
            {stay.hotel_wifi_password && (
              <p>
                {t('greeting.wifiPassword')}: <span className="font-semibold text-foreground">{stay.hotel_wifi_password}</span>
              </p>
            )}
          </BandRow>
        )}
        {stay.hotel_breakfast_hours && (
          <BandRow icon={<Coffee size={14} />}>
            {t('greeting.breakfast')} <span className="font-semibold text-foreground">{stay.hotel_breakfast_hours}</span>
          </BandRow>
        )}
        {stay.hotel_bar_hours && (
          <BandRow icon={<Wine size={14} />}>
            {t('greeting.bar')} <span className="font-semibold text-foreground">{stay.hotel_bar_hours}</span>
          </BandRow>
        )}
      </div>
    </div>
  )
}

export function ContactsCard({ stay }: { stay: StayInfo }) {
  const { t } = useLocale()
  const whatsappHref = buildWhatsappHref(stay.hotel_phone)
  const hasHotelInfo = Boolean(stay.hotel_address || stay.hotel_phone || stay.hotel_email || whatsappHref || stay.hotel_website)
  if (!hasHotelInfo) return null

  return (
    <SectionCard title={t('greeting.contacts')}>
      <div className="space-y-3">
        {stay.hotel_address && (
          <p className="flex items-center gap-1.5 text-sm text-muted">
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
              <span className="text-sm font-semibold text-foreground">{t('greeting.call')}</span>
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
              <span className="text-sm font-semibold text-foreground">{t('greeting.email')}</span>
            </a>
          )}
          {whatsappHref && (
            <a
              href={whatsappHref}
              target="_blank"
              rel="noreferrer"
              className="flex flex-col items-center gap-1.5 rounded-lg bg-surface-2 py-2.5 text-center transition-colors hover:bg-accent-soft"
            >
              <span className="flex h-8 w-8 items-center justify-center rounded-full bg-accent-soft text-accent">
                <WhatsAppIcon size={14} />
              </span>
              <span className="text-sm font-semibold text-foreground">WhatsApp</span>
            </a>
          )}
          {stay.hotel_website && (
            <a
              href={stay.hotel_website}
              target="_blank"
              rel="noreferrer"
              className="flex flex-col items-center gap-1.5 rounded-lg bg-surface-2 py-2.5 text-center transition-colors hover:bg-accent-soft"
            >
              <span className="flex h-8 w-8 items-center justify-center rounded-full bg-accent-soft text-accent">
                <Globe size={14} />
              </span>
              <span className="text-sm font-semibold text-foreground">{t('greeting.website')}</span>
            </a>
          )}
        </div>
      </div>
    </SectionCard>
  )
}
