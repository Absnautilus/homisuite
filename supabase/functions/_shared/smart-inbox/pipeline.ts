import type { SupabaseClient } from 'npm:@supabase/supabase-js@2.116.0'
import type Anthropic from 'npm:@anthropic-ai/sdk@1.3.0'
import { AiRefusalError, draftReply, type DraftRequest, type DraftUsage, type HistoryEntry } from './ai.ts'
import { headerMap, ignoreReason } from './filters.ts'
import { createReplyDraft, deleteMessage, getMessage, textToHtml } from './graph.ts'
import { getAccessToken, loadMailbox, ReauthRequiredError } from './mailbox.ts'
import type { SmartInboxConfig } from './runtime.ts'

// One inbound email, end to end:
//   claim -> read from Graph -> filter -> Claude -> store draft (+ Outlook
//   reply draft) -> account usage.
// Every step writes through the service-role client; staff only ever see
// the result through RLS.

// Longer than any normal guest email. Above this the message goes to a
// person instead of being cut: a truncated email could get a wrong answer.
export const MAX_BODY_CHARS = 40_000
export const MAX_ATTEMPTS = 3

export interface PipelineDeps {
  admin: SupabaseClient
  config: SmartInboxConfig
  anthropic: Anthropic
}

type MessageStatus = 'pending' | 'processing' | 'draft_ready' | 'needs_attention' | 'ignored' | 'replied' | 'dismissed' | 'failed'

interface MessageRow {
  id: string
  property_id: string
  mailbox_id: string
  graph_message_id: string
  status: MessageStatus
  attempts: number
}

export interface ProcessOptions {
  // Staff explicitly asked for a (new) draft: bypasses auto_draft = false.
  force?: boolean
}

async function claim(admin: SupabaseClient, messageId: string, force: boolean): Promise<MessageRow | null> {
  const { data: current, error } = await admin
    .from('smart_inbox_messages')
    .select('id, property_id, mailbox_id, graph_message_id, status, attempts')
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
    .select('id, property_id, mailbox_id, graph_message_id, status, attempts')
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

// One conversation per guest address per property. Returns its id.
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

export const HISTORY_MESSAGES = 4

// The last few exchanges with this guest before `beforeIso`, oldest first:
// each earlier guest email, followed by the reply the hotel sent to it.
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
  const [property, settings, knowledge] = await Promise.all([
    admin.from('properties').select('name').eq('id', propertyId).single(),
    admin.from('smart_inbox_settings').select('*').eq('property_id', propertyId).maybeSingle(),
    admin
      .from('smart_inbox_knowledge_entries')
      .select('title, content')
      .eq('property_id', propertyId)
      .eq('active', true)
      .order('sort_order')
      .order('created_at'),
  ])
  if (property.error) throw property.error
  if (settings.error) throw settings.error
  if (knowledge.error) throw knowledge.error
  const row = settings.data as { reply_signature?: string; tone?: DraftRequest['tone']; auto_draft?: boolean; ignored_senders?: string[] } | null
  return {
    hotelName: (property.data as { name: string }).name,
    signature: row?.reply_signature ?? '',
    tone: row?.tone ?? 'cordiale',
    autoDraft: row?.auto_draft ?? true,
    ignoredSenders: row?.ignored_senders ?? [],
    knowledge: (knowledge.data ?? []) as DraftRequest['knowledge'],
  }
}

export async function processMessage(deps: PipelineDeps, messageId: string, options: ProcessOptions = {}): Promise<MessageStatus | null> {
  const { admin, config } = deps
  const message = await claim(admin, messageId, options.force ?? false)
  if (!message) return null

  try {
    const { mailbox, secret } = await loadMailbox(admin, message.mailbox_id)
    if (mailbox.status === 'disconnected' || !secret) {
      await finish(admin, message.id, { status: 'failed', error: 'mailbox_disconnected' })
      return 'failed'
    }

    const accessToken = await getAccessToken(admin, config, secret)
    const email = await getMessage(accessToken, message.graph_message_id)
    const fromAddress = email.from?.emailAddress?.address?.toLowerCase() ?? null
    const bodyText = (email.uniqueBody?.content ?? email.body?.content ?? '').trim()

    await finish(admin, message.id, {
      conversation_id: email.conversationId,
      from_address: fromAddress,
      from_name: email.from?.emailAddress?.name ?? null,
      subject: email.subject,
      body_preview: email.bodyPreview,
      body_text: bodyText.slice(0, MAX_BODY_CHARS),
      received_at: email.receivedDateTime,
    })

    const threadId = fromAddress
      ? await attachToConversation(admin, message.property_id, message.id, fromAddress, email.from?.emailAddress?.name ?? null, email.receivedDateTime)
      : null

    const context = await loadPropertyContext(admin, message.property_id)

    if (!options.force) {
      const reason = email.isDraft
        ? 'own_mailbox'
        : ignoreReason(
          { fromAddress, subject: email.subject, headers: headerMap(email.internetMessageHeaders) },
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

    const history = threadId ? await loadHistory(admin, threadId, message.id, email.receivedDateTime) : []

    let drafted
    try {
      drafted = await draftReply(deps.anthropic, config.model, config.effort, {
        hotelName: context.hotelName,
        tone: context.tone,
        signature: context.signature,
        knowledge: context.knowledge,
        email: {
          fromName: email.from?.emailAddress?.name ?? null,
          fromAddress,
          subject: email.subject,
          receivedAt: email.receivedDateTime,
          body: bodyText || email.bodyPreview || '',
        },
        history,
      })
    } catch (error) {
      const usage = (error as { usage?: DraftUsage }).usage
      if (usage) await recordUsage(admin, message.property_id, message.id, usage)
      if (error instanceof AiRefusalError) {
        await finish(admin, message.id, { status: 'needs_attention', error: 'ai_refused' })
        return 'needs_attention'
      }
      throw error
    }

    const { result, usage } = drafted
    await recordUsage(admin, message.property_id, message.id, usage)

    const reply = result.reply.trim()
    const status: MessageStatus = result.needs_human || !reply ? 'needs_attention' : 'draft_ready'

    if (reply) {
      const { data: existingRow, error: existingError } = await admin
        .from('smart_inbox_drafts')
        .select('id, status, graph_draft_id')
        .eq('message_id', message.id)
        .maybeSingle()
      if (existingError) throw existingError
      const existing = existingRow as { id: string; status: string; graph_draft_id: string | null } | null

      if (!existing || existing.status !== 'sent') {
        // Mirror the proposal into Outlook's Drafts folder, replacing the
        // previous one on a regenerate. Best effort: the draft in homisuite
        // is the source of truth and can be sent without it.
        let graphDraftId: string | null = null
        try {
          if (existing?.graph_draft_id) await deleteMessage(accessToken, existing.graph_draft_id)
          graphDraftId = (await createReplyDraft(accessToken, message.graph_message_id, textToHtml(reply))).id
        } catch (error) {
          console.warn('smart-inbox: Outlook draft not updated', error)
        }

        const draftFields = {
          body: reply,
          ai_body: reply,
          suggested_actions: result.suggested_actions,
          model: usage.model,
          graph_draft_id: graphDraftId,
          edited_by: null,
          status: 'pending',
        }
        const { error } = existing
          ? await admin.from('smart_inbox_drafts').update(draftFields).eq('id', existing.id)
          : await admin.from('smart_inbox_drafts').insert({ property_id: message.property_id, message_id: message.id, ...draftFields })
        if (error) throw error
      }
    }

    await finish(admin, message.id, {
      status,
      language: result.language,
      category: result.category,
      urgency: result.urgency,
      summary: result.needs_human && result.needs_human_reason
        ? `${result.summary} — ${result.needs_human_reason}`
        : result.summary,
      ignore_reason: null,
      error: null,
    })
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
