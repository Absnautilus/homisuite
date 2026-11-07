import { deleteMessage, replyWithComment, sendDraft, textToHtml } from '../_shared/smart-inbox/graph.ts'
import { getAccessToken, loadMailbox, ReauthRequiredError } from '../_shared/smart-inbox/mailbox.ts'
import { processMessage } from '../_shared/smart-inbox/pipeline.ts'
import { adminClient, anthropicClient, callerClient, corsHeaders, json, readConfig, readUuid, requirePermission } from '../_shared/smart-inbox/runtime.ts'

// Staff actions on a message (JWT required, smart_inbox.view on its
// property):
//
//   POST { action: 'send', draftId, body }  -> reply to the guest from the
//        connected mailbox with `body` (the text staff approved), then mark
//        the draft sent and the message replied.
//   POST { action: 'regenerate', messageId } -> ask the AI for a new draft
//        (also used for messages that were filtered or had auto_draft off).
//
// Reads go through the caller's own client first, so RLS decides whether
// the draft/message is visible to them at all; the service-role client is
// used only after that, for the parts staff can't do directly.

const MAX_BODY_CHARS = 20_000

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

  try {
    if (body.action === 'send') {
      const draftId = readUuid(body.draftId)
      const text = typeof body.body === 'string' ? body.body.trim() : ''
      if (!draftId || !text || text.length > MAX_BODY_CHARS) return json({ error: 'invalid_input' }, 400)

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

      // Claim the draft before talking to Microsoft so a double click (or
      // two people at once) can never send the same reply twice.
      const { data: claimed, error: claimError } = await admin
        .from('smart_inbox_drafts')
        .update({ status: 'sent', body: text, sent_by: auth.userId, sent_at: new Date().toISOString() })
        .eq('id', draft.id)
        .eq('status', 'pending')
        .select('id, ai_body, graph_draft_id')
        .maybeSingle()
      if (claimError) throw claimError
      if (!claimed) return json({ error: 'already_sent' }, 409)
      const sent = claimed as { id: string; ai_body: string; graph_draft_id: string | null }

      const { data: message, error: messageError } = await admin
        .from('smart_inbox_messages')
        .select('id, mailbox_id, graph_message_id')
        .eq('id', draft.message_id)
        .single()
      if (messageError) throw messageError
      const target = message as { id: string; mailbox_id: string; graph_message_id: string }

      try {
        const { secret } = await loadMailbox(admin, target.mailbox_id)
        if (!secret) throw new Error('mailbox_disconnected')
        const accessToken = await getAccessToken(admin, config, secret)
        if (sent.graph_draft_id && text === sent.ai_body.trim()) {
          // Unchanged proposal: send the Outlook draft that already holds it.
          await sendDraft(accessToken, sent.graph_draft_id)
        } else {
          // Edited in homisuite: reply with the approved text and remove the
          // now-stale Outlook draft.
          await replyWithComment(accessToken, target.graph_message_id, textToHtml(text))
          if (sent.graph_draft_id) await deleteMessage(accessToken, sent.graph_draft_id).catch(() => {})
        }
      } catch (error) {
        await admin.from('smart_inbox_drafts').update({ status: 'pending', sent_by: null, sent_at: null }).eq('id', sent.id)
        console.error('smart-inbox-actions: send failed', error)
        const code = error instanceof ReauthRequiredError ? 'reauth_required' : error instanceof Error && error.message === 'mailbox_disconnected' ? 'mailbox_disconnected' : 'send_failed'
        return json({ error: code }, 502)
      }

      const { error: repliedError } = await admin
        .from('smart_inbox_messages')
        .update({ status: 'replied' })
        .eq('id', target.id)
      if (repliedError) console.error('smart-inbox-actions: message not marked replied', repliedError)
      return json({ ok: true })
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

      const status = await processMessage({ admin, config, anthropic: anthropicClient(config) }, message.id, { force: true })
      if (!status) return json({ error: 'busy' }, 409)
      return json({ status })
    }

    return json({ error: 'invalid_input' }, 400)
  } catch (error) {
    console.error('smart-inbox-actions failed', error)
    return json({ error: 'internal_error' }, 500)
  }
})
