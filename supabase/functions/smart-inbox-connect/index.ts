import { signState } from '../_shared/smart-inbox/crypto.ts'
import { googleAuthorizeUrl } from '../_shared/smart-inbox/gmail.ts'
import { authorizeUrl } from '../_shared/smart-inbox/graph.ts'
import { disconnect, loadMailbox } from '../_shared/smart-inbox/mailbox.ts'
import { linkWhatsApp, unlinkWhatsApp, WhatsAppLinkError } from '../_shared/smart-inbox/whatsappAccount.ts'
import { adminClient, callerClient, corsHeaders, json, readConfig, readUuid, requirePermission } from '../_shared/smart-inbox/runtime.ts'

// Staff-facing (JWT required): start connecting a property's mailbox
// (Outlook or Gmail), or disconnect it. Both need smart_inbox.manage.
//
//   POST { action: 'start', propertyId, provider? }  -> { url }   (open in browser)
//        provider: 'microsoft' (default) | 'google'
//   POST { action: 'providers', propertyId }         -> { microsoft, google, whatsapp }
//   POST { action: 'whatsapp_link', propertyId, phoneNumberId, wabaId, accessToken }
//        -> { display_phone_number, verified_name }
//   POST { action: 'whatsapp_unlink', propertyId }   -> { ok: true }
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
    if (body.action === 'providers') {
      return json({ microsoft: Boolean(config.microsoft), google: Boolean(config.google), whatsapp: Boolean(config.whatsapp) })
    }

    if (body.action === 'whatsapp_link') {
      if (!config.whatsapp) return json({ error: 'provider_not_configured' }, 400)
      const digits = (value: unknown) => typeof value === 'string' && /^[0-9]{5,32}$/.test(value.trim()) ? value.trim() : null
      const phoneNumberId = digits(body.phoneNumberId)
      const wabaId = digits(body.wabaId)
      const accessToken = typeof body.accessToken === 'string' ? body.accessToken.trim() : ''
      if (!phoneNumberId || !wabaId || accessToken.length < 20 || accessToken.length > 4096) return json({ error: 'invalid_input' }, 400)
      try {
        return json(await linkWhatsApp(adminClient(config), config, { propertyId, userId: auth.userId, phoneNumberId, wabaId, accessToken }))
      } catch (error) {
        if (error instanceof WhatsAppLinkError) return json({ error: error.code }, 400)
        throw error
      }
    }

    if (body.action === 'whatsapp_unlink') {
      await unlinkWhatsApp(adminClient(config), propertyId)
      return json({ ok: true })
    }

    if (body.action === 'start') {
      const provider = body.provider === 'google' ? 'google' : 'microsoft'
      // The callback trusts only this signed, 10-minute state: which
      // property, which provider, and which staff member started it.
      const state = await signState({ p: propertyId, u: auth.userId, v: provider }, config.stateSecret, STATE_TTL_SECONDS)
      if (provider === 'google') {
        if (!config.google) return json({ error: 'provider_not_configured' }, 400)
        return json({ url: googleAuthorizeUrl(config.google, state) })
      }
      if (!config.microsoft) return json({ error: 'provider_not_configured' }, 400)
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
