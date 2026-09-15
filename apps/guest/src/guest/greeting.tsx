import { CalendarClock, MapPin, MessageCircle } from 'lucide-react'
import { useLocale } from '@/lib/i18n/locale-context'
import type { StayInfo } from '@/lib/guest-api'

// wa.me needs digits only (country code included, no leading + or 00) --
// strips whatever formatting the hotel typed into Settings' "Telefono"
// field (spaces, dashes, parentheses, a leading +). Never a Homisuite
// number: this is always the mapped property's own settings.phone,
// resolved server-side by guest_stay_info -- absent there just means no
// WhatsApp button, not a fallback to someone else's contact.
function buildWhatsappHref(phone: string | null): string | null {
  if (!phone) return null
  const digits = phone.replace(/\D/g, '')
  return digits ? `https://wa.me/${digits}` : null
}

// Matches the rest of the app's own convention (request-flow.tsx,
// status-list.tsx) of formatting every timestamp in 'it-IT' regardless of
// the guest's selected UI language -- not a new inconsistency introduced
// here.
function formatCheckout(checkOutAt: string): { date: string; time: string } {
  const d = new Date(checkOutAt)
  return {
    date: d.toLocaleDateString('it-IT', { day: '2-digit', month: '2-digit' }),
    time: d.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' }),
  }
}

export function Greeting({ stay }: { stay: StayInfo }) {
  const { t } = useLocale()
  const hour = new Date().getHours()
  const timeOfDay = hour < 18 ? t('greeting.morning') : t('greeting.evening')
  const { date, time } = formatCheckout(stay.check_out_at)
  const whatsappHref = buildWhatsappHref(stay.hotel_phone)

  return (
    <div className="mb-5 rounded-lg border border-accent-soft-line bg-accent-soft px-4 py-3">
      <span className="inline-flex items-center gap-1.5 rounded-full bg-accent px-2.5 py-1 text-xs font-semibold text-white">
        {t('greeting.room')} {stay.room_number}
      </span>
      <p className="mt-2 text-sm text-accent">
        {timeOfDay} {t('greeting.line', { name: stay.guest_last_name })}
      </p>

      <div className="mt-3 space-y-1.5 border-t border-accent-soft-line pt-2.5 text-xs text-accent">
        <div className="flex items-center gap-1.5">
          <CalendarClock size={14} className="shrink-0" />
          <span>
            {t('greeting.checkoutLabel')}: {t('greeting.checkoutAt', { date, time })}
          </span>
        </div>
        {stay.hotel_address && (
          <div className="flex items-center gap-1.5">
            <MapPin size={14} className="shrink-0" />
            <span>{stay.hotel_address}</span>
          </div>
        )}
      </div>

      {whatsappHref && (
        <a
          href={whatsappHref}
          target="_blank"
          rel="noreferrer"
          className="mt-3 inline-flex cursor-pointer items-center gap-1.5 rounded-md bg-white px-3 py-1.5 text-xs font-semibold text-accent shadow-sm transition-colors hover:bg-accent-soft-line"
        >
          <MessageCircle size={14} />
          {t('greeting.whatsapp')}
        </a>
      )}
    </div>
  )
}
