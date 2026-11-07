import type { SupabaseClient } from '@supabase/supabase-js'
import type { Agent, InboxDraft, InboxMessage, InboxSettings, KnowledgeEntry, Mailbox, MessageStatus, ReplyTemplate, UsageRow } from './types'

// Untyped SupabaseClient, same as Dining: the shared Database type
// (core-sdk) doesn't know this module's tables. Every table here is
// property-scoped and RLS decides visibility (smart_inbox.view / .manage).

export class SmartInboxActionError extends Error {
  constructor(readonly code: string | null) {
    super(code ?? 'smart_inbox_action_failed')
    this.name = 'SmartInboxActionError'
  }
}

// supabase.functions.invoke puts non-2xx responses in `error.context`
// (the raw Response); the functions always answer `{ error: code }`.
async function invoke<T>(client: SupabaseClient, name: string, body: Record<string, unknown>): Promise<T> {
  const { data, error } = await client.functions.invoke(name, { body })
  if (error) {
    let code: string | null = null
    const context = (error as { context?: unknown }).context
    if (context instanceof Response) {
      const payload = await context.json().catch(() => null) as { error?: unknown } | null
      code = typeof payload?.error === 'string' ? payload.error : null
    }
    throw new SmartInboxActionError(code)
  }
  return data as T
}

const MESSAGE_COLUMNS = 'id, thread_id, from_address, from_name, subject, body_preview, body_text, received_at, language, category, urgency, summary, status, ignore_reason, error'
const DRAFT_COLUMNS = 'id, message_id, body, ai_body, suggested_actions, model, status, sent_by, sent_at, updated_at'
const CONVERSATION_COLUMNS = 'id, guest_address, guest_name, assigned_to, assigned_at, is_urgent, stay_month, notes'
const SELECT = `${MESSAGE_COLUMNS}, conversation:smart_inbox_conversations(${CONVERSATION_COLUMNS}), smart_inbox_drafts(${DRAFT_COLUMNS})`

type MessageRow = Record<string, unknown> & { smart_inbox_drafts: InboxDraft | InboxDraft[] | null }

function toMessage(row: MessageRow): InboxMessage {
  const { smart_inbox_drafts: drafts, ...message } = row
  const draft = Array.isArray(drafts) ? drafts[0] ?? null : drafts ?? null
  return { ...(message as Omit<InboxMessage, 'draft'>), draft }
}

export async function listMessages(client: SupabaseClient, propertyId: string, statuses: MessageStatus[], limit = 100): Promise<InboxMessage[]> {
  const { data, error } = await client
    .from('smart_inbox_messages')
    .select(SELECT)
    .eq('property_id', propertyId)
    .in('status', statuses)
    .order('received_at', { ascending: false })
    .limit(limit)
  if (error) throw error
  return (data ?? []).map((row) => toMessage(row as MessageRow))
}

// Every message of one guest conversation, oldest first.
export async function listThread(client: SupabaseClient, threadId: string): Promise<InboxMessage[]> {
  const { data, error } = await client
    .from('smart_inbox_messages')
    .select(SELECT)
    .eq('thread_id', threadId)
    .order('received_at', { ascending: true })
    .limit(200)
  if (error) throw error
  return (data ?? []).map((row) => toMessage(row as MessageRow))
}

export async function listAgents(client: SupabaseClient, propertyId: string): Promise<Agent[]> {
  const { data, error } = await client.rpc('smart_inbox_agents', { p_property_id: propertyId })
  if (error) throw error
  return (data ?? []) as Agent[]
}

export async function updateConversation(client: SupabaseClient, threadId: string, changes: { is_urgent?: boolean; stay_month?: string | null; notes?: string }): Promise<void> {
  const { data, error } = await client.from('smart_inbox_conversations').update(changes).eq('id', threadId).select('id')
  if (error) throw error
  if (!data || data.length === 0) throw new SmartInboxActionError('forbidden')
}

// Numbers for the summary bar: guests waiting, of which urgent, and
// replies sent today.
export async function loadSummary(client: SupabaseClient, propertyId: string): Promise<{ toAnswer: number; urgent: number; answeredToday: number }> {
  const todayStart = new Date()
  todayStart.setHours(0, 0, 0, 0)
  const [open, sent] = await Promise.all([
    client
      .from('smart_inbox_messages')
      .select('id, thread_id, conversation:smart_inbox_conversations(is_urgent)')
      .eq('property_id', propertyId)
      .in('status', ['pending', 'processing', 'draft_ready', 'needs_attention', 'failed'])
      .limit(1000),
    client
      .from('smart_inbox_drafts')
      .select('id', { count: 'exact', head: true })
      .eq('property_id', propertyId)
      .eq('status', 'sent')
      .gte('sent_at', todayStart.toISOString()),
  ])
  if (open.error) throw open.error
  if (sent.error) throw sent.error
  const guests = new Map<string, boolean>()
  for (const row of (open.data ?? []) as Array<{ id: string; thread_id: string | null; conversation: { is_urgent: boolean } | Array<{ is_urgent: boolean }> | null }>) {
    const conversation = Array.isArray(row.conversation) ? row.conversation[0] : row.conversation
    guests.set(row.thread_id ?? row.id, conversation?.is_urgent ?? false)
  }
  return {
    toAnswer: guests.size,
    urgent: [...guests.values()].filter(Boolean).length,
    answeredToday: sent.count ?? 0,
  }
}

export async function listTemplates(client: SupabaseClient, propertyId: string): Promise<ReplyTemplate[]> {
  const { data, error } = await client
    .from('smart_inbox_templates')
    .select('id, title, body, sort_order')
    .eq('property_id', propertyId)
    .order('sort_order')
    .order('created_at')
  if (error) throw error
  return (data ?? []) as ReplyTemplate[]
}

export async function createTemplate(client: SupabaseClient, propertyId: string, template: { title: string; body: string; sort_order: number }): Promise<void> {
  const { error } = await client.from('smart_inbox_templates').insert({ property_id: propertyId, ...template })
  if (error) throw error
}

export async function updateTemplate(client: SupabaseClient, id: string, changes: { title?: string; body?: string }): Promise<void> {
  const { data, error } = await client.from('smart_inbox_templates').update(changes).eq('id', id).select('id')
  if (error) throw error
  if (!data || data.length === 0) throw new SmartInboxActionError('forbidden')
}

export async function deleteTemplate(client: SupabaseClient, id: string): Promise<void> {
  const { data, error } = await client.from('smart_inbox_templates').delete().eq('id', id).select('id')
  if (error) throw error
  if (!data || data.length === 0) throw new SmartInboxActionError('forbidden')
}

export async function assignConversation(client: SupabaseClient, threadId: string, profileId: string | null): Promise<void> {
  const { data, error } = await client.from('smart_inbox_conversations').update({ assigned_to: profileId }).eq('id', threadId).select('id')
  if (error) throw error
  if (!data || data.length === 0) throw new SmartInboxActionError('forbidden')
}

export async function setMessageStatus(client: SupabaseClient, messageId: string, status: 'dismissed' | 'needs_attention'): Promise<void> {
  const { data, error } = await client.from('smart_inbox_messages').update({ status }).eq('id', messageId).select('id')
  if (error) throw error
  if (!data || data.length === 0) throw new SmartInboxActionError('not_allowed')
}

export async function saveDraftBody(client: SupabaseClient, draftId: string, body: string): Promise<void> {
  const { data, error } = await client.from('smart_inbox_drafts').update({ body }).eq('id', draftId).select('id')
  if (error) throw error
  if (!data || data.length === 0) throw new SmartInboxActionError('already_sent')
}

export function sendReply(client: SupabaseClient, draftId: string, body: string): Promise<{ ok: true }> {
  return invoke(client, 'smart-inbox-actions', { action: 'send', draftId, body })
}

export function regenerateDraft(client: SupabaseClient, messageId: string): Promise<{ status: MessageStatus }> {
  return invoke(client, 'smart-inbox-actions', { action: 'regenerate', messageId })
}

export async function listKnowledge(client: SupabaseClient, propertyId: string): Promise<KnowledgeEntry[]> {
  const { data, error } = await client
    .from('smart_inbox_knowledge_entries')
    .select('id, title, content, active, sort_order')
    .eq('property_id', propertyId)
    .order('sort_order')
    .order('created_at')
  if (error) throw error
  return (data ?? []) as KnowledgeEntry[]
}

export async function createKnowledge(client: SupabaseClient, propertyId: string, entry: Pick<KnowledgeEntry, 'title' | 'content'> & { sort_order: number }): Promise<void> {
  const { error } = await client.from('smart_inbox_knowledge_entries').insert({ property_id: propertyId, ...entry })
  if (error) throw error
}

export async function updateKnowledge(client: SupabaseClient, id: string, changes: Partial<Pick<KnowledgeEntry, 'title' | 'content' | 'active' | 'sort_order'>>): Promise<void> {
  const { data, error } = await client.from('smart_inbox_knowledge_entries').update(changes).eq('id', id).select('id')
  if (error) throw error
  if (!data || data.length === 0) throw new SmartInboxActionError('forbidden')
}

export async function deleteKnowledge(client: SupabaseClient, id: string): Promise<void> {
  const { data, error } = await client.from('smart_inbox_knowledge_entries').delete().eq('id', id).select('id')
  if (error) throw error
  if (!data || data.length === 0) throw new SmartInboxActionError('forbidden')
}

export const DEFAULT_SETTINGS: InboxSettings = { reply_signature: '', tone: 'cordiale', auto_draft: true, ignored_senders: [] }

export async function loadSettings(client: SupabaseClient, propertyId: string): Promise<InboxSettings> {
  const { data, error } = await client
    .from('smart_inbox_settings')
    .select('reply_signature, tone, auto_draft, ignored_senders')
    .eq('property_id', propertyId)
    .maybeSingle()
  if (error) throw error
  return (data as InboxSettings | null) ?? DEFAULT_SETTINGS
}

export async function saveSettings(client: SupabaseClient, propertyId: string, settings: InboxSettings): Promise<void> {
  const { error } = await client
    .from('smart_inbox_settings')
    .upsert({ property_id: propertyId, ...settings }, { onConflict: 'property_id' })
  if (error) throw error
}

export async function loadMailbox(client: SupabaseClient, propertyId: string): Promise<Mailbox | null> {
  const { data, error } = await client
    .from('smart_inbox_mailboxes')
    .select('id, email_address, display_name, status, last_error, subscription_expires_at')
    .eq('property_id', propertyId)
    .maybeSingle()
  if (error) throw error
  return data as Mailbox | null
}

export function startOutlookConnection(client: SupabaseClient, propertyId: string): Promise<{ url: string }> {
  return invoke(client, 'smart-inbox-connect', { action: 'start', propertyId })
}

export function disconnectOutlook(client: SupabaseClient, propertyId: string): Promise<{ ok: true }> {
  return invoke(client, 'smart-inbox-connect', { action: 'disconnect', propertyId })
}

export async function loadMonthUsage(client: SupabaseClient, propertyId: string, now = new Date()): Promise<UsageRow[]> {
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString()
  const { data, error } = await client
    .from('smart_inbox_ai_usage')
    .select('model, input_tokens, output_tokens, cache_read_input_tokens, cache_creation_input_tokens')
    .eq('property_id', propertyId)
    .gte('created_at', monthStart)
    .limit(10000)
  if (error) throw error
  return (data ?? []) as UsageRow[]
}
