// Decides, before any AI call, whether an inbound email is something a
// human guest wrote and could want an answer to. Everything filtered here
// costs nothing and never leaves Microsoft/Supabase.

export interface InboundEmail {
  fromAddress: string | null
  subject: string | null
  // Lower-cased header names.
  headers: Record<string, string>
}

export interface FilterOptions {
  mailboxAddress: string
  // Addresses ("noreply@x.com") or domains ("x.com") configured by the hotel.
  ignoredSenders: string[]
}

// OTA *notification* senders: confirmations, cancellations, invoices. Matched
// on the exact domain only -- guest messages relayed by the same OTAs come
// from subdomains (e.g. ...@guest.booking.com, ...@m.expediapartnercentral.com)
// and are real conversations a guest expects an answer to, so they pass.
// Booking.com, Expedia and Airbnb forward a guest's message to the hotel
// from a per-reservation relay address; a reply to that address reaches
// the guest in the portal. Those messages are guest messages (not portal
// notifications): they are drafted like any email and shown with the
// portal as their channel. Matched on the whole domain or a subdomain.
// Booking.com's domain is the documented one; Expedia's and Airbnb's are
// the ones their relay emails use today -- check them against real
// messages when a property starts using this.
export const OTA_RELAY_DOMAINS: Record<string, 'booking' | 'expedia' | 'airbnb'> = {
  'guest.booking.com': 'booking',
  'm.expediapartnercentral.com': 'expedia',
  'reply.airbnb.com': 'airbnb',
}

export function relaySource(address: string | null): 'booking' | 'expedia' | 'airbnb' | null {
  if (!address) return null
  const domain = senderDomain(address.toLowerCase())
  for (const [relay, source] of Object.entries(OTA_RELAY_DOMAINS)) {
    if (domain === relay || domain.endsWith(`.${relay}`)) return source
  }
  return null
}

export const OTA_NOTIFICATION_DOMAINS = [
  'booking.com',
  'expedia.com',
  'expediapartnercentral.com',
  'hotels.com',
  'airbnb.com',
  'agoda.com',
  'trip.com',
  'hrs.com',
  'hotelbeds.com',
  'siteminder.com',
]

const NO_REPLY_LOCAL_PART = /^(no-?reply|do-?not-?reply|donotreply|mailer-daemon|postmaster|bounces?|notifications?|newsletter|news|marketing|alerts?)([+._-].*)?$/i

const AUTOMATIC_SUBJECT = /^(automatic reply|auto(matic)?[- ]?reply|risposta automatica|out of office|fuori sede|abwesenheitsnotiz|réponse automatique|respuesta automática|undeliverable|non recapitabile|delivery status notification|mail delivery failed)\b/i

export type IgnoreReason =
  | 'missing_sender'
  | 'own_mailbox'
  | 'ignored_sender'
  | 'no_reply_sender'
  | 'ota_notification'
  | 'auto_reply'
  | 'bulk'
  | 'newsletter'

function senderDomain(address: string): string {
  return address.slice(address.lastIndexOf('@') + 1)
}

function matchesSenderRule(address: string, rule: string): boolean {
  const normalized = rule.trim().toLowerCase().replace(/^@/, '')
  if (!normalized) return false
  if (normalized.includes('@')) return address === normalized
  const domain = senderDomain(address)
  return domain === normalized || domain.endsWith(`.${normalized}`)
}

export function ignoreReason(email: InboundEmail, options: FilterOptions): IgnoreReason | null {
  const address = email.fromAddress?.trim().toLowerCase() ?? ''
  if (!address || !address.includes('@')) return 'missing_sender'
  if (address === options.mailboxAddress.trim().toLowerCase()) return 'own_mailbox'
  if (options.ignoredSenders.some((rule) => matchesSenderRule(address, rule))) return 'ignored_sender'

  const localPart = address.slice(0, address.lastIndexOf('@'))
  if (NO_REPLY_LOCAL_PART.test(localPart)) return 'no_reply_sender'
  if (OTA_NOTIFICATION_DOMAINS.includes(senderDomain(address))) return 'ota_notification'

  const headers = email.headers
  const autoSubmitted = headers['auto-submitted']?.trim().toLowerCase()
  if (autoSubmitted && autoSubmitted !== 'no') return 'auto_reply'
  if (headers['x-autoreply'] || headers['x-autorespond']) return 'auto_reply'
  if (AUTOMATIC_SUBJECT.test(email.subject?.trim() ?? '')) return 'auto_reply'

  const precedence = headers['precedence']?.trim().toLowerCase()
  if (precedence === 'bulk' || precedence === 'junk' || precedence === 'list') return 'bulk'
  if (headers['list-unsubscribe'] || headers['list-id']) return 'newsletter'

  return null
}

export function headerMap(headers: Array<{ name?: string; value?: string }> | undefined | null): Record<string, string> {
  const map: Record<string, string> = {}
  for (const header of headers ?? []) {
    if (header.name) map[header.name.toLowerCase()] = header.value ?? ''
  }
  return map
}
