import { signState } from '../_shared/smart-inbox/crypto.ts'
import { authorizeUrl } from '../_shared/smart-inbox/graph.ts'
import { disconnect, loadMailbox } from '../_shared/smart-inbox/mailbox.ts'
import { adminClient, callerClient, corsHeaders, json, readConfig, readUuid, requirePermission } from '../_shared/smart-inbox/runtime.ts'

// Staff-facing (JWT required): start connecting a property's Outlook
// mailbox, or disconnect it. Both need smart_inbox.manage on the property.
//
//   POST { action: 'start', propertyId }      -> { url }   (open in browser)
//   POST { action: 'disconnect', propertyId } -> { ok: true }

const STATE_TTL_SECONDS = 10 * 60

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
  const propertyId = readUuid(body.propertyId)
  if (!propertyId) return json({ error: 'invalid_input' }, 400)

  const caller = callerClient(config, authorization)
  const auth = await requirePermission(caller, propertyId, 'smart_inbox.manage')
  if (auth instanceof Response) return auth

  try {
    if (body.action === 'start') {
      // The callback trusts only this signed, 10-minute state: which
      // property, and which staff member started the connection.
      const state = await signState({ p: propertyId, u: auth.userId }, config.stateSecret, STATE_TTL_SECONDS)
      return json({ url: authorizeUrl(config.microsoft, state) })
    }

    if (body.action === 'disconnect') {
      const admin = adminClient(config)
      const { data: mailbox, error } = await admin
        .from('smart_inbox_mailboxes')
        .select('id')
        .eq('property_id', propertyId)
        .maybeSingle()
      if (error) throw error
      if (!mailbox) return json({ ok: true })
      const loaded = await loadMailbox(admin, (mailbox as { id: string }).id)
      await disconnect(admin, config, loaded.mailbox, loaded.secret)
      return json({ ok: true })
    }

    return json({ error: 'invalid_input' }, 400)
  } catch (error) {
    console.error('smart-inbox-connect failed', error)
    return json({ error: 'internal_error' }, 500)
  }
})
