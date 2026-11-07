import { encryptSecret, verifyState } from '../_shared/smart-inbox/crypto.ts'
import { deleteSubscription, exchangeCode, getMe } from '../_shared/smart-inbox/graph.ts'
import { subscribe } from '../_shared/smart-inbox/mailbox.ts'
import { adminClient, readConfig, readUuid } from '../_shared/smart-inbox/runtime.ts'

// Microsoft redirects the browser here after sign-in (verify_jwt = false:
// there is no Supabase session on this request). The signed `state` from
// smart-inbox-connect is the only thing trusted to say which property this
// mailbox belongs to and who connected it. Always ends with a redirect back
// to the app, never with a page of its own.

Deno.serve(async (request: Request) => {
  const config = readConfig()
  if (!config) return new Response('Smart Inbox is not configured', { status: 500 })

  const back = (result: string) =>
    Response.redirect(`${config.appUrl}/smart-inbox?outlook=${encodeURIComponent(result)}`, 302)

  if (request.method !== 'GET') return new Response('Method not allowed', { status: 405 })

  const url = new URL(request.url)
  const state = await verifyState<{ p?: unknown; u?: unknown }>(url.searchParams.get('state') ?? '', config.stateSecret)
  const propertyId = readUuid(state?.p)
  const userId = readUuid(state?.u)
  if (!state || !propertyId || !userId) return back('invalid_state')
  if (url.searchParams.get('error')) return back('denied')

  const code = url.searchParams.get('code')
  if (!code) return back('invalid_request')

  const admin = adminClient(config)
  try {
    const tokens = await exchangeCode(config.microsoft, code)
    if (!tokens.refreshToken) return back('no_offline_access')
    const me = await getMe(tokens.accessToken)
    const emailAddress = (me.mail ?? me.userPrincipalName).toLowerCase()

    // Reconnecting replaces the previous connection: drop its Graph
    // subscription first so notifications don't arrive twice.
    const { data: previous } = await admin
      .from('smart_inbox_mailboxes')
      .select('id, smart_inbox_mailbox_secrets(graph_subscription_id)')
      .eq('property_id', propertyId)
      .maybeSingle()
    const previousSubscription = (previous as { smart_inbox_mailbox_secrets?: { graph_subscription_id: string | null } | null } | null)
      ?.smart_inbox_mailbox_secrets?.graph_subscription_id
    if (previousSubscription) {
      await deleteSubscription(tokens.accessToken, previousSubscription).catch(() => {})
    }

    const { data: mailbox, error: mailboxError } = await admin
      .from('smart_inbox_mailboxes')
      .upsert({
        property_id: propertyId,
        provider: 'microsoft',
        email_address: emailAddress,
        display_name: me.displayName,
        status: 'connected',
        last_error: null,
        connected_by: userId,
      }, { onConflict: 'property_id' })
      .select('id')
      .single()
    if (mailboxError) throw mailboxError
    const mailboxId = (mailbox as { id: string }).id

    const { error: secretError } = await admin
      .from('smart_inbox_mailbox_secrets')
      .upsert({
        mailbox_id: mailboxId,
        refresh_token_ciphertext: await encryptSecret(tokens.refreshToken, config.tokenKey),
        graph_subscription_id: null,
        client_state_hash: null,
      }, { onConflict: 'mailbox_id' })
    if (secretError) throw secretError

    await subscribe(admin, config, mailboxId, tokens.accessToken)
    return back('connected')
  } catch (error) {
    console.error('smart-inbox-oauth-callback failed', error)
    return back('error')
  }
})
