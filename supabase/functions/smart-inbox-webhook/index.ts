import { sha256Hex } from '../_shared/smart-inbox/crypto.ts'
import { processMessage } from '../_shared/smart-inbox/pipeline.ts'
import { adminClient, anthropicClient, readConfig, runInBackground } from '../_shared/smart-inbox/runtime.ts'

// Microsoft Graph change notifications (verify_jwt = false: Microsoft calls
// this, not a signed-in user). Two kinds of request:
//
//   1. Subscription validation: ?validationToken=... -> echo it back as
//      text/plain within 10 seconds, or Graph refuses the subscription.
//   2. Notifications: a batch of "a message was created in the Inbox".
//      Each one is authenticated by its clientState (compared by SHA-256
//      against what we stored when subscribing), recorded as a `pending`
//      message, and processed after the response is sent -- Graph expects
//      an answer within a few seconds and retries otherwise.

interface Notification {
  subscriptionId?: string
  clientState?: string
  changeType?: string
  resourceData?: { id?: string }
}

Deno.serve(async (request: Request) => {
  const url = new URL(request.url)
  const validationToken = url.searchParams.get('validationToken')
  if (validationToken) {
    return new Response(validationToken, { status: 200, headers: { 'Content-Type': 'text/plain' } })
  }
  if (request.method !== 'POST') return new Response(null, { status: 405 })

  const config = readConfig()
  if (!config) return new Response(null, { status: 500 })

  let notifications: Notification[]
  try {
    const payload = await request.json() as { value?: Notification[] }
    notifications = Array.isArray(payload.value) ? payload.value.slice(0, 100) : []
  } catch {
    return new Response(null, { status: 400 })
  }

  const admin = adminClient(config)
  const newMessageIds: string[] = []

  for (const notification of notifications) {
    const graphMessageId = notification.resourceData?.id
    if (notification.changeType !== 'created' || !notification.subscriptionId || !notification.clientState || !graphMessageId) continue

    const { data: secret, error } = await admin
      .from('smart_inbox_mailbox_secrets')
      .select('mailbox_id, client_state_hash, smart_inbox_mailboxes!inner(property_id, status)')
      .eq('graph_subscription_id', notification.subscriptionId)
      .maybeSingle()
    if (error || !secret) continue
    const row = secret as unknown as {
      mailbox_id: string
      client_state_hash: string | null
      smart_inbox_mailboxes: { property_id: string; status: string }
    }
    if (!row.client_state_hash || row.client_state_hash !== await sha256Hex(notification.clientState)) {
      console.warn('smart-inbox-webhook: clientState mismatch, notification dropped')
      continue
    }
    if (row.smart_inbox_mailboxes.status === 'disconnected') continue

    const { data: inserted, error: insertError } = await admin
      .from('smart_inbox_messages')
      .upsert({
        property_id: row.smart_inbox_mailboxes.property_id,
        mailbox_id: row.mailbox_id,
        graph_message_id: graphMessageId,
      }, { onConflict: 'mailbox_id,graph_message_id', ignoreDuplicates: true })
      .select('id')
    if (insertError) {
      console.error('smart-inbox-webhook: message not recorded', insertError)
      continue
    }
    for (const item of (inserted ?? []) as Array<{ id: string }>) newMessageIds.push(item.id)
  }

  if (newMessageIds.length > 0) {
    const deps = { admin, config, anthropic: anthropicClient(config) }
    // Sequential on purpose: a burst of emails should not fan out into a
    // burst of parallel model calls and Graph requests for one mailbox.
    runInBackground((async () => {
      for (const id of newMessageIds) await processMessage(deps, id)
    })())
  }

  return new Response(null, { status: 202 })
})
