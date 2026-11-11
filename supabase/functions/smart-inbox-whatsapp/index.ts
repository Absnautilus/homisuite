import { attachToConversation, processMessage } from '../_shared/smart-inbox/pipeline.ts'
import { adminClient, anthropicClient, readConfig, runInBackground } from '../_shared/smart-inbox/runtime.ts'
import { parseWebhook, verifySignature, whatsappGuestKey } from '../_shared/smart-inbox/whatsapp.ts'

// WhatsApp Business Platform webhook (verify_jwt = false: Meta calls this).
//
//   GET  ?hub.mode=subscribe&hub.verify_token=...&hub.challenge=...
//        Meta's one-time check when the webhook URL is saved in the app:
//        echo the challenge if the verify token matches.
//   POST guest messages for the numbers linked in Smart Inbox. Every
//        delivery is authenticated by X-Hub-Signature-256 (HMAC of the raw
//        body with the Meta app secret); messages become `pending` Smart
//        Inbox messages on the guest's conversation and are drafted after
//        the response is sent -- Meta retries a delivery that isn't
//        acknowledged quickly.

Deno.serve(async (request: Request) => {
  const config = readConfig()
  if (!config?.whatsapp) return new Response(null, { status: 503 })
  const url = new URL(request.url)

  if (request.method === 'GET') {
    const challenge = url.searchParams.get('hub.challenge')
    if (url.searchParams.get('hub.mode') === 'subscribe' && challenge && url.searchParams.get('hub.verify_token') === config.whatsapp.verifyToken) {
      return new Response(challenge, { status: 200, headers: { 'Content-Type': 'text/plain' } })
    }
    return new Response(null, { status: 403 })
  }
  if (request.method !== 'POST') return new Response(null, { status: 405 })

  const rawBody = await request.text()
  if (!(await verifySignature(rawBody, request.headers.get('x-hub-signature-256'), config.whatsapp.appSecret))) {
    console.warn('smart-inbox-whatsapp: bad signature, delivery dropped')
    return new Response(null, { status: 401 })
  }

  let incoming
  try {
    incoming = parseWebhook(JSON.parse(rawBody)).slice(0, 100)
  } catch {
    return new Response(null, { status: 400 })
  }

  const admin = adminClient(config)
  const newMessageIds: string[] = []
  const accounts = new Map<string, { id: string; property_id: string } | null>()

  for (const message of incoming) {
    if (!accounts.has(message.phoneNumberId)) {
      const { data } = await admin
        .from('smart_inbox_whatsapp_accounts')
        .select('id, property_id')
        .eq('phone_number_id', message.phoneNumberId)
        .neq('status', 'disconnected')
        .maybeSingle()
      accounts.set(message.phoneNumberId, (data as { id: string; property_id: string } | null) ?? null)
    }
    const account = accounts.get(message.phoneNumberId)
    if (!account) continue

    const { data: inserted, error } = await admin
      .from('smart_inbox_messages')
      .upsert({
        property_id: account.property_id,
        whatsapp_account_id: account.id,
        graph_message_id: message.messageId,
        source: 'whatsapp',
        from_name: message.name,
        from_address: message.from,
        body_text: message.text,
        body_preview: message.text.slice(0, 255),
        received_at: message.receivedAt,
        status: 'pending',
      }, { onConflict: 'whatsapp_account_id,graph_message_id', ignoreDuplicates: true })
      .select('id')
    if (error) {
      console.error('smart-inbox-whatsapp: message not recorded', error)
      continue
    }
    for (const row of (inserted ?? []) as Array<{ id: string }>) {
      try {
        await attachToConversation(admin, account.property_id, row.id, whatsappGuestKey(message.from), message.name, message.receivedAt)
        newMessageIds.push(row.id)
      } catch (cause) {
        console.error('smart-inbox-whatsapp: conversation not linked', cause)
      }
    }
  }

  if (newMessageIds.length > 0) {
    const deps = { admin, config, anthropic: anthropicClient(config) }
    runInBackground((async () => {
      for (const id of newMessageIds) await processMessage(deps, id)
    })())
  }
  return new Response(null, { status: 200 })
})
