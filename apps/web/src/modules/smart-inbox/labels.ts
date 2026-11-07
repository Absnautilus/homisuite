import type { MessageCategory, MessageStatus, MessageUrgency, SuggestedAction, UsageRow } from './types'

// Pure presentation helpers, kept free of React/Supabase so they can be
// unit-tested with node --test (see labels.test.mjs).

export type InboxView = 'todo' | 'mine' | 'replied' | 'archived'

const VIEW_STATUSES: Record<InboxView, MessageStatus[]> = {
  todo: ['draft_ready', 'needs_attention', 'failed', 'pending', 'processing'],
  mine: ['draft_ready', 'needs_attention', 'failed', 'pending', 'processing'],
  replied: ['replied'],
  archived: ['dismissed', 'ignored'],
}

export function statusesForView(view: InboxView): MessageStatus[] {
  return VIEW_STATUSES[view]
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
  conversation: { guest_address: string; guest_name: string | null; assigned_to: string | null } | null
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
