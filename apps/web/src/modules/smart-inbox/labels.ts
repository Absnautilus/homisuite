import type { GuestDetails, Tone, KnowledgeCategory, MessageCategory, MessageSource, MessageStatus, MessageUrgency, PastedSource, SuggestedAction, TemplateCategory, UsageRow } from './types'

// Pure presentation helpers, kept free of React/Supabase so they can be
// unit-tested with node --test (see labels.test.mjs).

export type InboxView = 'todo' | 'mine' | 'unassigned' | 'replied' | 'archived'

const OPEN_STATUSES: MessageStatus[] = ['draft_ready', 'needs_attention', 'failed', 'pending', 'processing']

const VIEW_STATUSES: Record<InboxView, MessageStatus[]> = {
  todo: OPEN_STATUSES,
  mine: OPEN_STATUSES,
  unassigned: OPEN_STATUSES,
  replied: ['replied'],
  archived: ['dismissed', 'ignored'],
}

// Views of guests still waiting for an answer (sorted urgent first, then
// longest waiting).
export function isOpenView(view: InboxView): boolean {
  return view === 'todo' || view === 'mine' || view === 'unassigned'
}

export function statusesForView(view: InboxView): MessageStatus[] {
  return VIEW_STATUSES[view]
}

// What staff need to know at a glance: does this still need an answer?
export type SimpleState = 'to_answer' | 'answered' | 'archived'

export function simpleState(status: MessageStatus): SimpleState {
  if (status === 'replied') return 'answered'
  if (status === 'dismissed' || status === 'ignored') return 'archived'
  return 'to_answer'
}

export const SIMPLE_STATE_LABELS: Record<SimpleState, string> = {
  to_answer: 'Da rispondere',
  answered: 'Risposto',
  archived: 'Archiviata',
}

// The secondary line under "Da rispondere": what is waiting, in plain words.
export function draftHint(status: MessageStatus, hasDraft: boolean): string | null {
  if (status === 'pending' || status === 'processing') return 'Bozza in preparazione'
  if (status === 'failed') return 'Bozza non riuscita'
  if (status === 'needs_attention') return hasDraft ? 'Bozza da controllare con attenzione' : 'Da scrivere a mano'
  if (status === 'draft_ready') return 'Bozza pronta'
  return null
}

const MONTH_FORMAT = new Intl.DateTimeFormat('it-IT', { month: 'long', year: 'numeric', timeZone: 'UTC' })

// '2026-12-01' -> 'Dicembre 2026'
export function monthLabel(month: string | null): string | null {
  if (!month || !/^\d{4}-\d{2}/.test(month)) return null
  const label = MONTH_FORMAT.format(new Date(`${month.slice(0, 7)}-01T00:00:00Z`))
  return label.charAt(0).toUpperCase() + label.slice(1)
}

// <input type="month"> value ('2026-12') <-> stored date ('2026-12-01')
export function monthInputValue(month: string | null): string {
  return month ? month.slice(0, 7) : ''
}

export function monthFromInput(value: string): string | null {
  return /^\d{4}-(0[1-9]|1[0-2])$/.test(value) ? `${value}-01` : null
}

// Inserts a template, with {nome} replaced by the guest's first name.
export function fillTemplate(body: string, guestName: string | null): string {
  const first = guestName?.trim().split(/\s+/)[0] ?? ''
  const looksLikeName = first && !first.includes('@')
  return body.replace(/\{nome\}/gi, looksLikeName ? first : '').replace(/[ \t]+([,.!?])/g, '$1')
}

// Where a template lands in a draft:
//  * at the cursor, if the person has been working in the text (padded
//    with blank lines so it never glues onto a word);
//  * otherwise just before the closing paragraph (greeting + signature),
//    which is how replies end -- so the template reads as the body.
export function insertTemplateText(body: string, text: string, cursor: { start: number; end: number } | null): { value: string; caret: number } {
  if (!body.trim()) return { value: text, caret: text.length }
  if (cursor) {
    const before = body.slice(0, cursor.start)
    const after = body.slice(cursor.end)
    const lead = before && !before.endsWith('\n') ? '\n\n' : ''
    const trail = after && !after.startsWith('\n') ? '\n\n' : ''
    const inserted = `${lead}${text}${trail}`
    return { value: `${before}${inserted}${after}`, caret: before.length + lead.length + text.length }
  }
  const closing = body.trimEnd().lastIndexOf('\n\n')
  if (closing <= 0) {
    const value = `${body.trimEnd()}\n\n${text}`
    return { value, caret: value.length }
  }
  const before = body.slice(0, closing)
  return { value: `${before}\n\n${text}${body.slice(closing)}`, caret: before.length + 2 + text.length }
}

export const STATUS_LABELS: Record<MessageStatus, string> = {
  pending: 'In arrivo',
  processing: 'In elaborazione',
  draft_ready: 'Bozza pronta',
  needs_attention: 'Da gestire',
  ignored: 'Filtrata',
  replied: 'Risposta inviata',
  dismissed: 'Archiviata',
  failed: 'Errore',
}

export type StatusTone = 'ok' | 'warn' | 'danger' | 'neutral'

// Messages that still ask something of a person.
export function isActionable(status: MessageStatus): boolean {
  return VIEW_STATUSES.todo.includes(status)
}

export interface ConversationGroup<M> {
  key: string
  threadId: string | null
  guestName: string
  guestAddress: string | null
  assignedTo: string | null
  isUrgent: boolean
  stayMonth: string | null
  notes: string
  latest: M
  messages: M[]
  openCount: number
}

// One list row per guest: messages of the same conversation are grouped,
// newest conversation first. A message not yet linked to a conversation
// (its sender isn't known until it has been read from Outlook) is its own
// row.
export function groupByConversation<M extends {
  id: string
  thread_id: string | null
  received_at: string
  status: MessageStatus
  from_name: string | null
  from_address: string | null
  conversation: { guest_address: string; guest_name: string | null; assigned_to: string | null; is_urgent?: boolean; stay_month?: string | null; notes?: string } | null
}>(messages: M[]): ConversationGroup<M>[] {
  const groups = new Map<string, ConversationGroup<M>>()
  for (const message of messages) {
    const key = message.thread_id ?? `message:${message.id}`
    let group = groups.get(key)
    if (!group) {
      group = {
        key,
        threadId: message.thread_id,
        guestName: message.conversation?.guest_name?.trim() || message.from_name?.trim() || message.conversation?.guest_address || message.from_address || 'Mittente sconosciuto',
        guestAddress: message.conversation?.guest_address ?? message.from_address,
        assignedTo: message.conversation?.assigned_to ?? null,
        isUrgent: message.conversation?.is_urgent ?? false,
        stayMonth: message.conversation?.stay_month ?? null,
        notes: message.conversation?.notes ?? '',
        latest: message,
        messages: [],
        openCount: 0,
      }
      groups.set(key, group)
    }
    group.messages.push(message)
    if (isActionable(message.status)) group.openCount++
    if (message.received_at > group.latest.received_at) group.latest = message
  }
  return [...groups.values()].sort((a, b) => (a.latest.received_at < b.latest.received_at ? 1 : -1))
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  return ((parts[0]?.[0] ?? '') + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase() || '?'
}

export function statusTone(status: MessageStatus): StatusTone {
  if (status === 'draft_ready' || status === 'replied') return 'ok'
  if (status === 'needs_attention') return 'warn'
  if (status === 'failed') return 'danger'
  return 'neutral'
}

export const CATEGORY_LABELS: Record<MessageCategory, string> = {
  information: 'Informazioni',
  request: 'Richiesta',
  booking: 'Prenotazione',
  complaint: 'Reclamo',
  other: 'Altro',
}

export const URGENCY_LABELS: Record<MessageUrgency, string> = {
  low: 'Bassa',
  normal: 'Normale',
  high: 'Alta',
}

export const ACTION_LABELS: Record<SuggestedAction['type'], string> = {
  transfer: 'Transfer',
  restaurant_booking: 'Prenotazione ristorante',
  guest_request: 'Richiesta ospite',
  room_booking: 'Prenotazione camera',
  other: 'Da organizzare',
}

const IGNORE_REASON_LABELS: Record<string, string> = {
  missing_sender: 'mittente mancante',
  own_mailbox: 'inviata dalla casella dell\'hotel',
  ignored_sender: 'mittente escluso nelle impostazioni',
  no_reply_sender: 'indirizzo no-reply',
  ota_notification: 'notifica automatica di un portale (OTA)',
  auto_reply: 'risposta automatica',
  bulk: 'invio massivo',
  newsletter: 'newsletter',
}

export function ignoreReasonLabel(reason: string | null): string | null {
  if (!reason) return null
  return IGNORE_REASON_LABELS[reason] ?? reason
}

const ERROR_LABELS: Record<string, string> = {
  reauth_required: 'Microsoft ha chiesto di ricollegare la casella Outlook (Impostazioni).',
  mailbox_disconnected: 'La casella Outlook non è collegata.',
  ai_refused: 'L\'assistente non ha generato una bozza per questo messaggio: va gestito a mano.',
  email_too_long: 'Email troppo lunga per una bozza automatica: va gestita a mano.',
  missing_sender: 'Mittente mancante.',
  processing_timeout: 'Elaborazione interrotta: verrà ritentata automaticamente.',
  ai_truncated: 'La bozza generata era incompleta: prova a rigenerarla.',
  ai_invalid_output: 'La bozza generata non era valida: prova a rigenerarla.',
}

export function messageErrorLabel(code: string | null): string | null {
  if (!code) return null
  return ERROR_LABELS[code] ?? 'Elaborazione non riuscita: verrà ritentata automaticamente.'
}

const ACTION_ERROR_LABELS: Record<string, string> = {
  forbidden: 'Non hai i permessi per questa operazione.',
  invalid_session: 'La sessione è scaduta: accedi di nuovo.',
  already_sent: 'Questa risposta è già stata inviata.',
  reauth_required: 'Microsoft ha chiesto di ricollegare la casella Outlook: vai in Impostazioni.',
  mailbox_disconnected: 'Collega prima una casella Outlook in Impostazioni.',
  send_failed: 'Invio non riuscito: riprova tra qualche istante.',
  not_allowed: 'Operazione non disponibile per questo messaggio.',
  busy: 'Il messaggio è già in elaborazione: riprova tra poco.',
  server_not_configured: 'Smart Inbox non è ancora configurato sul server.',
  not_found: 'Messaggio non trovato.',
  source_disabled: 'Questo canale è disattivato nelle impostazioni.',
  too_long: 'Il messaggio è troppo lungo: incolla solo il testo dell\'ospite.',
  empty: 'Incolla prima il messaggio dell\'ospite.',
  ai_refused: 'L\'assistente non ha potuto riscrivere la risposta: modificala a mano.',
  internal_error: 'Qualcosa non ha funzionato. Riprova tra qualche istante.',
}

export function actionErrorLabel(code: string | null): string {
  return (code && ACTION_ERROR_LABELS[code]) || 'Operazione non riuscita. Riprova tra qualche istante.'
}

// "ignored_senders" textarea <-> array: one address/domain per line,
// lower-cased, trimmed, de-duplicated.
export function parseSenderList(text: string): string[] {
  const seen = new Set<string>()
  for (const line of text.split(/[\n,;]+/)) {
    const value = line.trim().toLowerCase().replace(/^@/, '')
    if (value) seen.add(value)
  }
  return [...seen].slice(0, 200)
}

// USD per million tokens. Used only for an indicative monthly estimate in
// Impostazioni; the Anthropic Console is the source of truth for billing.
const PRICES: Record<string, { input: number; output: number; cacheRead: number; cacheWrite: number }> = {
  'claude-opus-5-5': { input: 4, output: 20, cacheRead: 0.2, cacheWrite: 5 },
  'claude-sonnet-5-5': { input: 2, output: 10, cacheRead: 0.2, cacheWrite: 2.5 },
  'claude-haiku-5-5': { input: 0.1, output: 0.5, cacheRead: 0.01, cacheWrite: 0.125 },
}

export interface UsageSummary {
  calls: number
  inputTokens: number
  outputTokens: number
  estimatedUsd: number | null
}

export function summarizeUsage(rows: UsageRow[]): UsageSummary {
  let estimated = 0
  let priced = true
  const summary = { calls: rows.length, inputTokens: 0, outputTokens: 0 }
  for (const row of rows) {
    const input = row.input_tokens + row.cache_read_input_tokens + row.cache_creation_input_tokens
    summary.inputTokens += input
    summary.outputTokens += row.output_tokens
    const price = PRICES[row.model]
    if (!price) {
      priced = false
      continue
    }
    estimated += (row.input_tokens * price.input
      + row.cache_read_input_tokens * price.cacheRead
      + row.cache_creation_input_tokens * price.cacheWrite
      + row.output_tokens * price.output) / 1_000_000
  }
  return { ...summary, estimatedUsd: priced ? estimated : null }
}

export function formatSender(message: { from_name: string | null; from_address: string | null }): string {
  return message.from_name?.trim() || message.from_address || 'Mittente sconosciuto'
}

// ---------------------------------------------------------------------------
// Channels
// ---------------------------------------------------------------------------
export const SOURCE_LABELS: Record<MessageSource, string> = {
  outlook: 'Outlook',
  booking: 'Booking.com',
  expedia: 'Expedia',
  airbnb: 'Airbnb',
  whatsapp: 'WhatsApp',
  phone: 'Telefono',
  other: 'Altro',
}

export const PASTED_SOURCES: PastedSource[] = ['booking', 'expedia', 'airbnb', 'whatsapp', 'phone', 'other']

// "Booking.com · incollato" in the list, so it's clear the reply has to be
// pasted back there; "Booking.com · via email" when it arrived (and the
// reply goes back) through the connected mailbox.
export function sourceBadge(source: MessageSource, viaEmail = source === 'outlook'): string {
  if (source === 'outlook') return SOURCE_LABELS.outlook
  return `${SOURCE_LABELS[source]} · ${viaEmail ? 'via email' : 'incollato'}`
}

// ---------------------------------------------------------------------------
// Signature (mirrors supabase/functions/_shared/smart-inbox/signature.ts,
// which signs the reply that is actually sent)
// ---------------------------------------------------------------------------
export const DEFAULT_AGENT_SIGNATURE = '{agent}\n{ruolo} — {hotel}'
export const DEFAULT_PROPERTY_SIGNATURE = 'Front Office — {hotel}'

export function renderSignature(template: string, values: { agent: string | null; role: string | null; hotel: string }): string {
  const filled = template
    .replace(/\{agent\}/gi, values.agent?.trim() ?? '')
    .replace(/\{ruolo\}/gi, values.role?.trim() ?? '')
    .replace(/\{hotel\}/gi, values.hotel.trim())
  return filled
    .split(/\r?\n/)
    .map((line) => line
      .replace(/\s+/g, ' ')
      .replace(/^\s*[—–\-,·|]\s*/, '')
      .replace(/\s*[—–\-,·|]\s*$/, '')
      .trim())
    .filter((line) => line.length > 0)
    .join('\n')
}

export function appendSignature(body: string, signature: string): string {
  const text = body.trimEnd()
  return signature ? `${text}\n${signature}` : text
}

// ---------------------------------------------------------------------------
// Templates and information
// ---------------------------------------------------------------------------
export const TEMPLATE_CATEGORY_LABELS: Record<TemplateCategory, string> = {
  prima_arrivo: 'Prima dell\'arrivo',
  prenotazioni: 'Prenotazioni',
  soggiorno: 'Durante il soggiorno',
  dopo: 'Dopo il soggiorno',
  altro: 'Altro',
}

export const KNOWLEDGE_CATEGORY_LABELS: Record<KnowledgeCategory, string> = {
  arrivo_partenza: 'Arrivo e partenza',
  servizi: 'Servizi',
  regole_prezzi: 'Regole e prezzi',
  altro: 'Altro',
}

export const LANGUAGE_LABELS: Record<string, string> = {
  it: 'Italiano',
  en: 'English',
  de: 'Deutsch',
  fr: 'Français',
  es: 'Español',
  nl: 'Nederlands',
  pt: 'Português',
}

const LANGUAGE_NAMES_IT: Record<string, string> = {
  it: 'italiano', en: 'inglese', de: 'tedesco', fr: 'francese', es: 'spagnolo', nl: 'olandese', pt: 'portoghese', ru: 'russo', zh: 'cinese', ja: 'giapponese', pl: 'polacco',
}

// 'de' / 'de-AT' -> 'tedesco'
export function languageName(code: string | null): string | null {
  if (!code) return null
  return LANGUAGE_NAMES_IT[code.toLowerCase().slice(0, 2)] ?? code
}

// "IT · EN · DE": the base text is Italian, then each written version.
export function templateLanguages(translations: Record<string, string>): string[] {
  const extra = Object.entries(translations ?? {})
    .filter(([code, text]) => code !== 'it' && typeof text === 'string' && text.trim())
    .map(([code]) => code.toUpperCase())
  return ['IT', ...extra.sort()]
}

// Fields a template can contain; the assistant fills them from the
// guest's message ({nome} also when inserting a template by hand).
export const TEMPLATE_FIELDS = ['{nome}', '{data arrivo}', '{ora arrivo}', '{data partenza}', '{notti}', '{ospiti}', '{n° prenotazione}']

const SAMPLE_GUEST: Record<string, string> = {
  nome: 'Lukas',
  'data arrivo': '14 dicembre',
  'ora arrivo': '23:00',
  'data partenza': '17 dicembre',
  notti: '3',
  ospiti: '2 adulti e 1 bambina',
  'n° prenotazione': '4021 887 512',
}

// Preview with an example guest; {info: Parcheggio} shows the entry text.
export function previewTemplate(body: string, information: Array<{ title: string; content: string }> = []): string {
  return body.replace(/\{([^{}]+)\}/g, (match, rawName: string) => {
    const name = rawName.trim().toLowerCase()
    if (name.startsWith('info:')) {
      const title = name.slice(5).trim()
      const entry = information.find((item) => item.title.trim().toLowerCase() === title)
      return entry ? entry.content.trim() : match
    }
    return SAMPLE_GUEST[name] ?? match
  })
}

// Most frequent topics first; the same topic written differently
// ("Animali", "animali ammessi?") counts once when it differs only in case
// and punctuation.
export function topicCounts(topics: string[], limit = 5): Array<{ topic: string; count: number }> {
  const counts = new Map<string, { topic: string; count: number }>()
  for (const raw of topics) {
    const topic = raw.trim()
    if (!topic) continue
    const key = topic.toLowerCase().replace(/[^\p{L}\p{N} ]/gu, '').replace(/\s+/g, ' ').trim()
    if (!key) continue
    const entry = counts.get(key)
    if (entry) entry.count++
    else counts.set(key, { topic: topic.charAt(0).toUpperCase() + topic.slice(1), count: 1 })
  }
  return [...counts.values()].sort((a, b) => b.count - a.count || a.topic.localeCompare(b.topic)).slice(0, limit)
}

// ---------------------------------------------------------------------------
// Componi risposta
// ---------------------------------------------------------------------------
export const GUEST_DETAIL_LABELS: Array<[Exclude<keyof GuestDetails, 'requests'>, string]> = [
  ['arrival_date', 'Arrivo'],
  ['arrival_time', 'Orario arrivo'],
  ['departure_date', 'Partenza'],
  ['guests', 'Ospiti'],
  ['booking_reference', 'N° prenotazione'],
]

export const QUICK_REFINEMENTS: Array<{ label: string; instruction: string }> = [
  { label: 'Più breve', instruction: 'Rendi la risposta più breve, mantenendo tutte le informazioni importanti.' },
  { label: 'Più formale', instruction: 'Rendi il tono più formale.' },
  { label: 'Più calorosa', instruction: 'Rendi il tono più caloroso e accogliente.' },
]

// ---------------------------------------------------------------------------
// Per-agent preferences
// ---------------------------------------------------------------------------
export const TONE_LABELS: Record<Tone, string> = {
  cordiale: 'Cordiale',
  formale: 'Formale',
  essenziale: 'Essenziale',
}

// Must stay within the list allowed by smart_inbox_agent_preferences.
export const AGENT_LANGUAGES: Array<{ code: string; label: string }> = [
  { code: 'it', label: 'Italiano' },
  { code: 'en', label: 'Inglese' },
  { code: 'de', label: 'Tedesco' },
  { code: 'fr', label: 'Francese' },
  { code: 'es', label: 'Spagnolo' },
  { code: 'pt', label: 'Portoghese' },
  { code: 'nl', label: 'Olandese' },
  { code: 'ru', label: 'Russo' },
  { code: 'zh', label: 'Cinese' },
  { code: 'ja', label: 'Giapponese' },
]

// ---------------------------------------------------------------------------
// Statistics
// ---------------------------------------------------------------------------
// 75 -> "1 h 15 min", 2900 -> "2 g 0 h"
export function formatMinutes(minutes: number | null | undefined): string {
  if (minutes === null || minutes === undefined || !Number.isFinite(minutes)) return '—'
  const value = Math.max(0, Math.round(minutes))
  if (value < 60) return `${value} min`
  if (value < 60 * 24) {
    const hours = Math.floor(value / 60)
    const rest = value % 60
    return rest ? `${hours} h ${rest} min` : `${hours} h`
  }
  const days = Math.floor(value / (60 * 24))
  return `${days} g ${Math.floor((value % (60 * 24)) / 60)} h`
}

export function percent(part: number, total: number): string {
  if (!total) return '—'
  return `${Math.round((part / total) * 100)}%`
}
