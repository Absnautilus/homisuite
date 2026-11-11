import { ReauthRequiredError } from '../_shared/smart-inbox/mailbox.ts'
import { MailboxUnavailableError, openMailbox } from '../_shared/smart-inbox/provider.ts'
import { ComposeError, composePasted, PASTED_SOURCES, type PastedSource, processMessage, reviseDraft } from '../_shared/smart-inbox/pipeline.ts'
import { adminClient, anthropicClient, callerClient, corsHeaders, json, readConfig, readUuid, requirePermission } from '../_shared/smart-inbox/runtime.ts'
import { appendSignature, type SignAs, signatureFor } from '../_shared/smart-inbox/signature.ts'

// Staff actions (JWT required, smart_inbox.view on the property):
//
//   { action: 'send', draftId, body, signAs? } -> sign `body` (the text staff
//        approved) as the caller ('agent', default) or as the property, then
//        - message that arrived by email (Outlook, or Booking/Expedia/Airbnb
//          relayed by email): reply from the connected mailbox;
//        - pasted message: just record it (staff paste the returned `text`
//          back into Booking/WhatsApp/...).
//        Marks the draft sent and the message replied.
//   { action: 'regenerate', messageId } -> new AI draft for a message.
//   { action: 'compose', propertyId, source, text, guestName? } -> record a
//        message pasted from a channel that is not connected and draft the
//        reply ("Componi risposta").
//   { action: 'refine', draftId, instruction, body } -> rewrite the draft
//        following a staff instruction ("più breve", "aggiungi il parcheggio").
//
// Reads go through the caller's own client first, so RLS decides whether
// the draft/message is visible to them at all; the service-role client is
// used only after that, for the parts staff can't do directly.

const MAX_BODY_CHARS = 20_000
const MAX_PASTE_CHARS = 40_000
const MAX_INSTRUCTION_CHARS = 1_000

function readSignAs(value: unknown): SignAs | null {
  if (value === undefined || value === null) return 'agent'
  return value === 'agent' || value === 'property' ? value : null
}

Deno.serve(async (request: Request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (request.method !== 'POST') return json({ error: 'method_not_allowed' }, 405)

  const authorization = request.headers.get('Authorization')
  if (!authorization) return json({ error: 'missing_authorization' }, 401)

  const config = readConfig()
  if (!config) return json({ error: 'server_not_configured' }, 500)

  let body: Record<string, unknown>
  try {
    body = await request.json()
  } catch {
    return json({ error: 'invalid_input' }, 400)
  }

  const caller = callerClient(config, authorization)
  const admin = adminClient(config)
  const deps = () => ({ admin, config, anthropic: anthropicClient(config) })

  try {
    if (body.action === 'send') {
      const draftId = readUuid(body.draftId)
      const text = typeof body.body === 'string' ? body.body.trim() : ''
      const signAs = readSignAs(body.signAs)
      if (!draftId || !text || text.length > MAX_BODY_CHARS || !signAs) return json({ error: 'invalid_input' }, 400)

      const { data: visible, error: visibleError } = await caller
        .from('smart_inbox_drafts')
        .select('id, property_id, message_id, status')
        .eq('id', draftId)
        .maybeSingle()
      if (visibleError) throw visibleError
      if (!visible) return json({ error: 'not_found' }, 404)
      const draft = visible as { id: string; property_id: string; message_id: string; status: string }

      const auth = await requirePermission(caller, draft.property_id, 'smart_inbox.view')
      if (auth instanceof Response) return auth
      if (draft.status !== 'pending') return json({ error: 'already_sent' }, 409)

      // The name block is never typed by staff nor written by the AI: it is
      // the sender's own signature, rendered here.
      const signature = await signatureFor(admin, draft.property_id, auth.userId, signAs)
      const signed = appendSignature(text, signature.text)

      // Claim the draft before talking to Microsoft so a double click (or
      // two people at once) can never send the same reply twice.
      const { data: claimed, error: claimError } = await admin
        .from('smart_inbox_drafts')
        .update({ status: 'sent', body: signed, signed_as: signature.signedAs, sent_by: auth.userId, sent_at: new Date().toISOString() })
        .eq('id', draft.id)
        .eq('status', 'pending')
        .select('id, body, graph_draft_id')
        .maybeSingle()
      if (claimError) throw claimError
      if (!claimed) return json({ error: 'already_sent' }, 409)
      const sent = claimed as { id: string; graph_draft_id: string | null }

      const { data: message, error: messageError } = await admin
        .from('smart_inbox_messages')
        .select('id, source, mailbox_id, graph_message_id, thread_id')
        .eq('id', draft.message_id)
        .single()
      if (messageError) throw messageError
      const target = message as { id: string; source: string; mailbox_id: string | null; graph_message_id: string | null; thread_id: string | null }

      // Arrived by email (Outlook, or Booking/Expedia/Airbnb relayed by
      // email): reply from the mailbox. Pasted: nothing to send.
      if (target.mailbox_id && target.graph_message_id) {
        try {
          const client = await openMailbox(admin, config, target.mailbox_id as string)
          // Always reply with the approved, signed text: the mailbox draft
          // was signed for whoever owned the guest at the time and may not
          // be the person sending now. The stale draft is then removed.
          await client.reply(target.graph_message_id as string, signed)
          if (sent.graph_draft_id) await client.deleteDraft(sent.graph_draft_id).catch(() => {})
        } catch (error) {
          await admin.from('smart_inbox_drafts').update({ status: 'pending', body: text, signed_as: null, sent_by: null, sent_at: null }).eq('id', sent.id)
          console.error('smart-inbox-actions: send failed', error)
          const code = error instanceof ReauthRequiredError ? 'reauth_required' : error instanceof MailboxUnavailableError ? 'mailbox_disconnected' : 'send_failed'
          return json({ error: code }, 502)
        }
      }

      const { error: repliedError } = await admin
        .from('smart_inbox_messages')
        .update({ status: 'replied' })
        .eq('id', target.id)
      if (repliedError) console.error('smart-inbox-actions: message not marked replied', repliedError)

      // Whoever answers an unassigned guest becomes their agent, so the
      // next message from the same guest lands with the same person.
      if (target.thread_id) {
        const { error: assignError } = await admin
          .from('smart_inbox_conversations')
          .update({ assigned_to: auth.userId, assigned_by: auth.userId })
          .eq('id', target.thread_id)
          .is('assigned_to', null)
        if (assignError) console.error('smart-inbox-actions: conversation not auto-assigned', assignError)

        // Answered: the guest stops being urgent unless another message of
        // theirs is still waiting.
        const { count, error: openError } = await admin
          .from('smart_inbox_messages')
          .select('id', { count: 'exact', head: true })
          .eq('thread_id', target.thread_id)
          .in('status', ['pending', 'processing', 'draft_ready', 'needs_attention', 'failed'])
        if (!openError && count === 0) {
          await admin.from('smart_inbox_conversations').update({ is_urgent: false }).eq('id', target.thread_id)
        }
      }
      return json({ ok: true, text: signed, signedAs: signature.signedAs, channel: target.source })
    }

    if (body.action === 'regenerate') {
      const messageId = readUuid(body.messageId)
      if (!messageId) return json({ error: 'invalid_input' }, 400)
      const { data: visible, error: visibleError } = await caller
        .from('smart_inbox_messages')
        .select('id, property_id, status')
        .eq('id', messageId)
        .maybeSingle()
      if (visibleError) throw visibleError
      if (!visible) return json({ error: 'not_found' }, 404)
      const message = visible as { id: string; property_id: string; status: string }

      const auth = await requirePermission(caller, message.property_id, 'smart_inbox.view')
      if (auth instanceof Response) return auth
      if (message.status === 'replied' || message.status === 'processing') return json({ error: 'not_allowed' }, 409)

      const status = await processMessage(deps(), message.id, { force: true, actorId: auth.userId })
      if (!status) return json({ error: 'busy' }, 409)
      return json({ status })
    }

    if (body.action === 'compose') {
      const propertyId = readUuid(body.propertyId)
      const source = typeof body.source === 'string' && (PASTED_SOURCES as readonly string[]).includes(body.source) ? body.source as PastedSource : null
      const text = typeof body.text === 'string' ? body.text.trim() : ''
      const guestName = typeof body.guestName === 'string' ? body.guestName.trim().slice(0, 200) : ''
      if (!propertyId || !source || !text) return json({ error: 'invalid_input' }, 400)
      if (text.length > MAX_PASTE_CHARS) return json({ error: 'too_long' }, 400)

      const auth = await requirePermission(caller, propertyId, 'smart_inbox.view')
      if (auth instanceof Response) return auth
      try {
        const result = await composePasted(deps(), { propertyId, userId: auth.userId, source, text, guestName: guestName || null })
        return json(result)
      } catch (error) {
        if (error instanceof ComposeError) return json({ error: error.code }, 400)
        throw error
      }
    }

    if (body.action === 'refine') {
      const draftId = readUuid(body.draftId)
      const instruction = typeof body.instruction === 'string' ? body.instruction.trim() : ''
      const current = typeof body.body === 'string' ? body.body.trim() : ''
      if (!draftId || !instruction || instruction.length > MAX_INSTRUCTION_CHARS || !current || current.length > MAX_BODY_CHARS) {
        return json({ error: 'invalid_input' }, 400)
      }
      const { data: visible, error: visibleError } = await caller
        .from('smart_inbox_drafts')
        .select('id, property_id')
        .eq('id', draftId)
        .maybeSingle()
      if (visibleError) throw visibleError
      if (!visible) return json({ error: 'not_found' }, 404)
      const draft = visible as { id: string; property_id: string }
      const auth = await requirePermission(caller, draft.property_id, 'smart_inbox.view')
      if (auth instanceof Response) return auth

      const outcome = await reviseDraft(deps(), draft.id, instruction, current, auth.userId)
      if (outcome === 'not_pending') return json({ error: 'already_sent' }, 409)
      if (outcome === 'refused') return json({ error: 'ai_refused' }, 422)
      return json({ ok: true })
    }

    return json({ error: 'invalid_input' }, 400)
  } catch (error) {
    console.error('smart-inbox-actions failed', error)
    return json({ error: 'internal_error' }, 500)
  }
})
