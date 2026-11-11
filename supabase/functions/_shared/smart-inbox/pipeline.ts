import type { SupabaseClient } from 'npm:@supabase/supabase-js@2.116.0'
import type Anthropic from 'npm:@anthropic-ai/sdk@1.3.0'
import { AiRefusalError, type AgentStyle, draftReply, type DraftRequest, type DraftResult, type DraftUsage, type HistoryEntry } from './ai.ts'
import { ignoreReason, relaySource } from './filters.ts'
import { ReauthRequiredError } from './mailbox.ts'
import { MailboxUnavailableError, openMailbox } from './provider.ts'
import type { SmartInboxConfig } from './runtime.ts'
import { appendSignature, signatureFor } from './signature.ts'

// One guest message, end to end:
//   Email:    claim -> read from the mailbox (Outlook or Gmail) -> filter ->
//             Claude -> store draft
//             (+ signed reply draft in the mailbox) -> account usage.
//   Pasted:   staff paste a message from Booking/WhatsApp/... -> Claude ->
//             store draft for them to copy back into that channel.
//   Revision: staff ask to change a draft ("più breve") -> Claude -> store.
// Every step writes through the service-role client; staff only ever see
// the result through RLS.

// Longer than any normal guest message. Above this the message goes to a
// person instead of being cut: a truncated message could get a wrong answer.
export const MAX_BODY_CHARS = 40_000
export const MAX_ATTEMPTS = 3
export const PASTED_SOURCES = ['booking', 'expedia', 'airbnb', 'whatsapp', 'phone', 'other'] as const
export type PastedSource = (typeof PASTED_SOURCES)[number]

export interface PipelineDeps {
  admin: SupabaseClient
  config: SmartInboxConfig
  anthropic: Anthropic
}

export type MessageStatus = 'pending' | 'processing' | 'draft_ready' | 'needs_attention' | 'ignored' | 'replied' | 'dismissed' | 'failed'

interface MessageRow {
  id: string
  property_id: string
  mailbox_id: string | null
  graph_message_id: string | null
  thread_id: string | null
  source: string
  from_name: string | null
  body_text: string | null
  received_at: string
  status: MessageStatus
  attempts: number
}

const MESSAGE_COLUMNS = 'id, property_id, mailbox_id, graph_message_id, thread_id, source, from_name, body_text, received_at, status, attempts'

export interface ProcessOptions {
  // Staff explicitly asked for a (new) draft: bypasses auto_draft = false.
  force?: boolean
  // Who asked for it: their personal style shapes the draft. Defaults to
  // the guest's agent.
  actorId?: string | null
}

async function claim(admin: SupabaseClient, messageId: string, force: boolean): Promise<MessageRow | null> {
  const { data: current, error } = await admin
    .from('smart_inbox_messages')
    .select(MESSAGE_COLUMNS)
    .eq('id', messageId)
    .maybeSingle()
  if (error) throw error
  if (!current) return null
  const row = current as MessageRow
  const claimable: MessageStatus[] = force
    ? ['pending', 'failed', 'draft_ready', 'needs_attention', 'ignored', 'dismissed']
    : ['pending', 'failed']
  if (!claimable.includes(row.status)) return null

  // Optimistic claim: only one worker wins if the webhook and the
  // maintenance retry race on the same message.
  const { data: claimed, error: claimError } = await admin
    .from('smart_inbox_messages')
    .update({ status: 'processing', attempts: row.attempts + 1, error: null })
    .eq('id', row.id)
    .eq('status', row.status)
    .eq('attempts', row.attempts)
    .select(MESSAGE_COLUMNS)
    .maybeSingle()
  if (claimError) throw claimError
  return (claimed as MessageRow | null) ?? null
}

async function finish(admin: SupabaseClient, messageId: string, changes: Record<string, unknown>): Promise<void> {
  const { error } = await admin.from('smart_inbox_messages').update(changes).eq('id', messageId)
  if (error) throw error
}

async function recordUsage(admin: SupabaseClient, propertyId: string, messageId: string, usage: DraftUsage): Promise<void> {
  const { error } = await admin.from('smart_inbox_ai_usage').insert({
    property_id: propertyId,
    message_id: messageId,
    model: usage.model,
    input_tokens: usage.inputTokens,
    output_tokens: usage.outputTokens,
    cache_read_input_tokens: usage.cacheReadInputTokens,
    cache_creation_input_tokens: usage.cacheCreationInputTokens,
  })
  if (error) console.error('smart-inbox: usage not recorded', error)
}

// One conversation per guest per property. For email the key is the sender
// address; for pasted messages it is "<channel>:<guest name>".
export async function attachToConversation(
  admin: SupabaseClient,
  propertyId: string,
  messageId: string,
  guestAddress: string,
  guestName: string | null,
  receivedAt: string,
): Promise<string> {
  const find = () => admin
    .from('smart_inbox_conversations')
    .select('id, last_message_at')
    .eq('property_id', propertyId)
    .eq('guest_address', guestAddress)
    .maybeSingle()

  let { data: conversation, error } = await find()
  if (error) throw error
  if (!conversation) {
    const inserted = await admin
      .from('smart_inbox_conversations')
      .insert({ property_id: propertyId, guest_address: guestAddress, guest_name: guestName, last_message_at: receivedAt })
      .select('id, last_message_at')
      .single()
    if (inserted.error) {
      // Lost a race with another worker creating the same conversation.
      if (inserted.error.code !== '23505') throw inserted.error
      const again = await find()
      if (again.error || !again.data) throw again.error ?? inserted.error
      conversation = again.data
    } else {
      conversation = inserted.data
    }
  }
  const row = conversation as { id: string; last_message_at: string }
  const changes: Record<string, unknown> = {}
  if (guestName) changes.guest_name = guestName
  if (new Date(receivedAt) > new Date(row.last_message_at)) changes.last_message_at = receivedAt
  if (Object.keys(changes).length > 0) {
    const { error: updateError } = await admin.from('smart_inbox_conversations').update(changes).eq('id', row.id)
    if (updateError) throw updateError
  }
  const { error: linkError } = await admin.from('smart_inbox_messages').update({ thread_id: row.id }).eq('id', messageId)
  if (linkError) throw linkError
  return row.id
}

// "booking:lukas weber" -- stable per channel + guest name.
export function pastedGuestKey(source: string, guestName: string): string {
  return `${source}:${guestName.trim().toLowerCase().replace(/\s+/g, ' ')}`.slice(0, 200)
}

export const HISTORY_MESSAGES = 4

// The last few exchanges with this guest before `beforeIso`, oldest first:
// each earlier guest message, followed by the reply the hotel sent to it.
async function loadHistory(admin: SupabaseClient, threadId: string, messageId: string, beforeIso: string): Promise<HistoryEntry[]> {
  const { data, error } = await admin
    .from('smart_inbox_messages')
    .select('id, received_at, body_text, body_preview, status, smart_inbox_drafts(body, status, sent_at)')
    .eq('thread_id', threadId)
    .neq('id', messageId)
    .neq('status', 'ignored')
    .lt('received_at', beforeIso)
    .order('received_at', { ascending: false })
    .limit(HISTORY_MESSAGES)
  if (error) throw error
  type Row = { received_at: string; body_text: string | null; body_preview: string | null; smart_inbox_drafts: { body: string; status: string; sent_at: string | null } | Array<{ body: string; status: string; sent_at: string | null }> | null }
  const history: HistoryEntry[] = []
  for (const row of ((data ?? []) as Row[]).reverse()) {
    const text = row.body_text || row.body_preview
    if (text) history.push({ from: 'guest', at: row.received_at, text })
    const draft = Array.isArray(row.smart_inbox_drafts) ? row.smart_inbox_drafts[0] : row.smart_inbox_drafts
    if (draft?.status === 'sent') history.push({ from: 'hotel', at: draft.sent_at ?? row.received_at, text: draft.body })
  }
  return history
}

async function loadPropertyContext(admin: SupabaseClient, propertyId: string) {
  const [property, settings, knowledge, templates] = await Promise.all([
    admin.from('properties').select('name').eq('id', propertyId).single(),
    admin.from('smart_inbox_settings').select('*').eq('property_id', propertyId).maybeSingle(),
    admin
      .from('smart_inbox_knowledge_entries')
      .select('title, content, assistant_note')
      .eq('property_id', propertyId)
      .eq('active', true)
      .order('sort_order')
      .order('created_at'),
    admin
      .from('smart_inbox_templates')
      .select('title, body, when_to_use, translations')
      .eq('property_id', propertyId)
      .order('sort_order')
      .order('created_at'),
  ])
  if (property.error) throw property.error
  if (templates.error) throw templates.error
  if (settings.error) throw settings.error
  if (knowledge.error) throw knowledge.error
  const row = settings.data as { tone?: DraftRequest['tone']; auto_draft?: boolean; ignored_senders?: string[]; enabled_sources?: string[] } | null
  return {
    hotelName: (property.data as { name: string }).name,
    tone: row?.tone ?? 'cordiale',
    autoDraft: row?.auto_draft ?? true,
    ignoredSenders: row?.ignored_senders ?? [],
    enabledSources: row?.enabled_sources ?? [...PASTED_SOURCES],
    knowledge: (knowledge.data ?? []) as DraftRequest['knowledge'],
    templates: (templates.data ?? []) as NonNullable<DraftRequest['templates']>,
  }
}

type PropertyContext = Awaited<ReturnType<typeof loadPropertyContext>>

interface ConversationContext {
  notes: string
  stay_month: string | null
  assigned_to: string | null
}

async function loadConversation(admin: SupabaseClient, threadId: string | null): Promise<ConversationContext | null> {
  if (!threadId) return null
  const { data, error } = await admin.from('smart_inbox_conversations').select('notes, stay_month, assigned_to').eq('id', threadId).single()
  if (error) throw error
  return data as ConversationContext
}

// Claude call + usage accounting. Returns null when the model declined
// (the message is then left for a person with error "ai_refused").
async function runAi(deps: PipelineDeps, message: { id: string; property_id: string }, request: DraftRequest): Promise<{ result: DraftResult; usage: DraftUsage } | null> {
  try {
    const drafted = await draftReply(deps.anthropic, deps.config.model, deps.config.effort, request)
    await recordUsage(deps.admin, message.property_id, message.id, drafted.usage)
    return drafted
  } catch (error) {
    const usage = (error as { usage?: DraftUsage }).usage
    if (usage) await recordUsage(deps.admin, message.property_id, message.id, usage)
    if (error instanceof AiRefusalError) return null
    throw error
  }
}

function draftFields(result: DraftResult, usage: DraftUsage, reply: string) {
  return {
    body: reply,
    ai_body: reply,
    suggested_actions: result.suggested_actions,
    model: usage.model,
    edited_by: null,
    status: 'pending',
    templates_used: result.templates_used,
    info_used: result.info_used,
    missing_fields: result.missing_fields,
    translation: result.translation_it,
  }
}

async function existingDraft(admin: SupabaseClient, messageId: string) {
  const { data, error } = await admin
    .from('smart_inbox_drafts')
    .select('id, status, graph_draft_id')
    .eq('message_id', messageId)
    .maybeSingle()
  if (error) throw error
  return data as { id: string; status: string; graph_draft_id: string | null } | null
}

async function saveDraft(admin: SupabaseClient, message: { id: string; property_id: string }, fields: Record<string, unknown>, existing: { id: string } | null): Promise<void> {
  const { error } = existing
    ? await admin.from('smart_inbox_drafts').update(fields).eq('id', existing.id)
    : await admin.from('smart_inbox_drafts').insert({ property_id: message.property_id, message_id: message.id, ...fields })
  if (error) throw error
}

// Urgent email -> urgent guest (until the hotel replies); stay month filled
// when nobody set it yet. Staff can change both.
async function applyTriage(admin: SupabaseClient, threadId: string | null, conversation: ConversationContext | null, result: DraftResult): Promise<void> {
  if (!threadId) return
  const triage: Record<string, unknown> = {}
  if (result.urgency === 'high') triage.is_urgent = true
  if (result.stay_month && !conversation?.stay_month) triage.stay_month = `${result.stay_month}-01`
  if (Object.keys(triage).length === 0) return
  const { error } = await admin.from('smart_inbox_conversations').update(triage).eq('id', threadId)
  if (error) console.error('smart-inbox: conversation triage not saved', error)
}

function messageResultFields(result: DraftResult, status: MessageStatus) {
  return {
    status,
    language: result.language,
    category: result.category,
    urgency: result.urgency,
    summary: result.needs_human && result.needs_human_reason
      ? `${result.summary} — ${result.needs_human_reason}`
      : result.summary,
    guest_details: {
      arrival_date: result.guest.arrival_date,
      arrival_time: result.guest.arrival_time,
      departure_date: result.guest.departure_date,
      guests: result.guest.guests,
      booking_reference: result.guest.booking_reference,
      requests: result.guest.requests,
    },
    missing_info: result.missing_info,
    template_gap: result.template_gap,
    ignore_reason: null,
    error: null,
  }
}

function statusFor(result: DraftResult): MessageStatus {
  return result.needs_human || !result.reply.trim() ? 'needs_attention' : 'draft_ready'
}

// The personal style of whoever will send the reply: the person asking
// (compose, revise, regenerate) or the guest's agent (automatic drafts).
async function loadAgentStyle(admin: SupabaseClient, propertyId: string, profileId: string | null): Promise<AgentStyle | null> {
  if (!profileId) return null
  const { data, error } = await admin
    .from('smart_inbox_agent_preferences')
    .select('tone, instructions')
    .eq('property_id', propertyId)
    .eq('profile_id', profileId)
    .maybeSingle()
  if (error) {
    console.error('smart-inbox: agent style not loaded', error)
    return null
  }
  return (data as AgentStyle | null) ?? null
}

function baseRequest(context: PropertyContext, conversation: ConversationContext | null, agentStyle: AgentStyle | null = null): Pick<DraftRequest, 'hotelName' | 'tone' | 'knowledge' | 'templates' | 'guestNotes' | 'agentStyle'> {
  return {
    agentStyle,
    hotelName: context.hotelName,
    tone: context.tone,
    knowledge: context.knowledge,
    templates: context.templates,
    guestNotes: conversation?.notes ?? '',
  }
}

// ---------------------------------------------------------------------------
// Email messages, Outlook or Gmail (and regenerating any message)
// ---------------------------------------------------------------------------
export async function processMessage(deps: PipelineDeps, messageId: string, options: ProcessOptions = {}): Promise<MessageStatus | null> {
  const { admin, config } = deps
  const message = await claim(admin, messageId, options.force ?? false)
  if (!message) return null

  try {
    // No mailbox: pasted in Componi risposta. With a mailbox it arrived by
    // email -- including Booking/Expedia/Airbnb messages relayed by email.
    if (!message.mailbox_id) return await draftPasted(deps, message, options.actorId ?? null)

    let client
    try {
      client = await openMailbox(admin, config, message.mailbox_id as string)
    } catch (error) {
      if (!(error instanceof MailboxUnavailableError)) throw error
      await finish(admin, message.id, { status: 'failed', error: 'mailbox_disconnected' })
      return 'failed'
    }
    const { mailbox } = client
    const email = await client.read(message.graph_message_id as string)
    const fromAddress = email.fromAddress
    const bodyText = email.bodyText
    const channel = relaySource(fromAddress) ?? (client.provider === 'google' ? 'gmail' : 'outlook')

    await finish(admin, message.id, {
      source: channel,
      conversation_id: email.conversationId,
      from_address: fromAddress,
      from_name: email.fromName,
      subject: email.subject,
      body_preview: email.bodyPreview,
      body_text: bodyText.slice(0, MAX_BODY_CHARS),
      received_at: email.receivedAt,
    })

    const threadId = fromAddress
      ? await attachToConversation(admin, message.property_id, message.id, fromAddress, email.fromName, email.receivedAt)
      : null

    const context = await loadPropertyContext(admin, message.property_id)

    if (!options.force) {
      const reason = email.isOwn
        ? 'own_mailbox'
        : ignoreReason(
          { fromAddress, subject: email.subject, headers: email.headers },
          { mailboxAddress: mailbox.email_address, ignoredSenders: context.ignoredSenders },
        )
      if (reason) {
        await finish(admin, message.id, { status: 'ignored', ignore_reason: reason })
        return 'ignored'
      }
      if (!context.autoDraft) {
        await finish(admin, message.id, { status: 'needs_attention' })
        return 'needs_attention'
      }
    }

    if (!fromAddress) {
      await finish(admin, message.id, { status: 'needs_attention', error: 'missing_sender' })
      return 'needs_attention'
    }
    if (bodyText.length > MAX_BODY_CHARS) {
      await finish(admin, message.id, { status: 'needs_attention', error: 'email_too_long' })
      return 'needs_attention'
    }

    const history = threadId ? await loadHistory(admin, threadId, message.id, email.receivedAt) : []
    const conversation = await loadConversation(admin, threadId)

    const agentStyle = await loadAgentStyle(admin, message.property_id, options.actorId ?? conversation?.assigned_to ?? null)
    const drafted = await runAi(deps, message, {
      ...baseRequest(context, conversation, agentStyle),
      channel,
      email: {
        fromName: email.fromName,
        fromAddress,
        subject: email.subject,
        receivedAt: email.receivedAt,
        body: bodyText || email.bodyPreview || '',
      },
      history,
    })
    if (!drafted) {
      await finish(admin, message.id, { status: 'needs_attention', error: 'ai_refused' })
      return 'needs_attention'
    }
    const { result, usage } = drafted
    const reply = result.reply.trim()

    if (reply) {
      const existing = await existingDraft(admin, message.id)
      if (!existing || existing.status !== 'sent') {
        // Mirror the proposal into the mailbox Drafts folder, signed by the
        // guest's agent (or the property while nobody owns the guest).
        // Best effort: the draft in homisuite is the source of truth.
        let graphDraftId: string | null = null
        try {
          if (existing?.graph_draft_id) await client.deleteDraft(existing.graph_draft_id)
          const signature = await signatureFor(admin, message.property_id, conversation?.assigned_to ?? null, conversation?.assigned_to ? 'agent' : 'property')
          graphDraftId = await client.createReplyDraft(message.graph_message_id as string, appendSignature(reply, signature.text))
        } catch (error) {
          console.warn('smart-inbox: mailbox draft not updated', error)
        }
        await saveDraft(admin, message, { ...draftFields(result, usage, reply), graph_draft_id: graphDraftId }, existing)
      }
    }

    await applyTriage(admin, threadId, conversation, result)
    const status = statusFor(result)
    await finish(admin, message.id, messageResultFields(result, status))
    return status
  } catch (error) {
    const code = error instanceof ReauthRequiredError
      ? 'reauth_required'
      : error instanceof Error ? error.message.slice(0, 300) : 'unknown_error'
    console.error('smart-inbox: processing failed', message.id, error)
    await finish(admin, message.id, { status: 'failed', error: code }).catch(() => {})
    return 'failed'
  }
}

// ---------------------------------------------------------------------------
// Pasted messages ("Componi risposta")
// ---------------------------------------------------------------------------
async function draftPasted(deps: PipelineDeps, message: MessageRow, actorId: string | null): Promise<MessageStatus> {
  const { admin } = deps
  const body = (message.body_text ?? '').trim()
  let threadId = message.thread_id
  const context = await loadPropertyContext(admin, message.property_id)
  const history = threadId ? await loadHistory(admin, threadId, message.id, message.received_at) : []
  let conversation = await loadConversation(admin, threadId)
  const agentStyle = await loadAgentStyle(admin, message.property_id, actorId ?? conversation?.assigned_to ?? null)

  const drafted = await runAi(deps, message, {
    ...baseRequest(context, conversation, agentStyle),
    channel: message.source,
    email: { fromName: message.from_name, fromAddress: null, subject: null, receivedAt: message.received_at, body },
    history,
  })
  if (!drafted) {
    await finish(admin, message.id, { status: 'needs_attention', error: 'ai_refused' })
    return 'needs_attention'
  }
  const { result, usage } = drafted

  // Staff may paste without typing the name: the AI reads it from the
  // message, and the guest's conversation is found or started with it.
  if (!threadId) {
    const name = message.from_name?.trim() || result.guest.name || 'Ospite'
    threadId = await attachToConversation(admin, message.property_id, message.id, pastedGuestKey(message.source, name), name, message.received_at)
    conversation = await loadConversation(admin, threadId)
    if (!message.from_name && result.guest.name) await finish(admin, message.id, { from_name: result.guest.name })
  }

  const reply = result.reply.trim()
  if (reply) {
    const existing = await existingDraft(admin, message.id)
    if (!existing || existing.status !== 'sent') await saveDraft(admin, message, draftFields(result, usage, reply), existing)
  }
  await applyTriage(admin, threadId, conversation, result)
  const status = statusFor(result)
  await finish(admin, message.id, messageResultFields(result, status))
  return status
}

export interface ComposeInput {
  propertyId: string
  userId: string
  source: PastedSource
  text: string
  guestName: string | null
}

export class ComposeError extends Error {
  constructor(readonly code: 'source_disabled' | 'too_long' | 'empty') {
    super(code)
    this.name = 'ComposeError'
  }
}

// Records a message pasted by staff and drafts the reply. The person who
// pasted it becomes the guest's agent if nobody is yet.
export async function composePasted(deps: PipelineDeps, input: ComposeInput): Promise<{ messageId: string; threadId: string | null; status: MessageStatus }> {
  const { admin } = deps
  const text = input.text.trim()
  if (!text) throw new ComposeError('empty')
  if (text.length > MAX_BODY_CHARS) throw new ComposeError('too_long')
  const context = await loadPropertyContext(admin, input.propertyId)
  if (!context.enabledSources.includes(input.source)) throw new ComposeError('source_disabled')

  const guestName = input.guestName?.trim() || null
  const now = new Date().toISOString()
  const { data: inserted, error } = await admin
    .from('smart_inbox_messages')
    .insert({
      property_id: input.propertyId,
      source: input.source,
      created_by: input.userId,
      from_name: guestName,
      body_text: text,
      body_preview: text.slice(0, 255),
      received_at: now,
      status: 'processing',
      attempts: 1,
    })
    .select(MESSAGE_COLUMNS)
    .single()
  if (error) throw error
  const message = inserted as MessageRow

  if (guestName) {
    message.thread_id = await attachToConversation(admin, input.propertyId, message.id, pastedGuestKey(input.source, guestName), guestName, now)
  }

  let status: MessageStatus
  try {
    status = await draftPasted(deps, message, input.userId)
  } catch (cause) {
    console.error('smart-inbox: compose failed', message.id, cause)
    await finish(admin, message.id, { status: 'failed', error: cause instanceof Error ? cause.message.slice(0, 300) : 'unknown_error' }).catch(() => {})
    status = 'failed'
  }

  const { data: row } = await admin.from('smart_inbox_messages').select('thread_id').eq('id', message.id).single()
  const threadId = (row as { thread_id: string | null } | null)?.thread_id ?? null
  if (threadId) {
    await admin
      .from('smart_inbox_conversations')
      .update({ assigned_to: input.userId, assigned_by: input.userId })
      .eq('id', threadId)
      .is('assigned_to', null)
  }
  return { messageId: message.id, threadId, status }
}

// ---------------------------------------------------------------------------
// Revising a draft on request ("più breve", "aggiungi che...")
// ---------------------------------------------------------------------------
export async function reviseDraft(deps: PipelineDeps, draftId: string, instruction: string, currentBody: string, actorId: string | null = null): Promise<'revised' | 'refused' | 'not_pending'> {
  const { admin } = deps
  const { data: draftRow, error } = await admin
    .from('smart_inbox_drafts')
    .select('id, status, message_id')
    .eq('id', draftId)
    .single()
  if (error) throw error
  const draft = draftRow as { id: string; status: string; message_id: string }
  if (draft.status !== 'pending') return 'not_pending'

  const { data: messageRow, error: messageError } = await admin
    .from('smart_inbox_messages')
    .select(`${MESSAGE_COLUMNS}, from_address, subject`)
    .eq('id', draft.message_id)
    .single()
  if (messageError) throw messageError
  const message = messageRow as MessageRow & { from_address: string | null; subject: string | null }

  const context = await loadPropertyContext(admin, message.property_id)
  const conversation = await loadConversation(admin, message.thread_id)
  const history = message.thread_id ? await loadHistory(admin, message.thread_id, message.id, message.received_at) : []

  const drafted = await runAi(deps, message, {
    ...baseRequest(context, conversation, await loadAgentStyle(admin, message.property_id, actorId ?? conversation?.assigned_to ?? null)),
    channel: message.source,
    email: {
      fromName: message.from_name,
      fromAddress: message.from_address,
      subject: message.subject,
      receivedAt: message.received_at,
      body: message.body_text ?? '',
    },
    history,
    revision: { currentReply: currentBody, instruction },
  })
  if (!drafted) return 'refused'
  const { result, usage } = drafted
  const reply = result.reply.trim()
  if (!reply) return 'refused'

  // A revision replaces the proposal: the mailbox draft (if any) is stale
  // and is rebuilt from the approved text when sending.
  const { error: updateError } = await admin
    .from('smart_inbox_drafts')
    .update({ ...draftFields(result, usage, reply) })
    .eq('id', draft.id)
    .eq('status', 'pending')
  if (updateError) throw updateError
  return 'revised'
}
