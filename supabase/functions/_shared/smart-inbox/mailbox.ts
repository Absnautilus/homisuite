import type { SupabaseClient } from 'npm:@supabase/supabase-js@2.116.0'
import { decryptSecret, encryptSecret, randomToken, sha256Hex } from './crypto.ts'
import { GmailError, googleRefresh } from './gmail.ts'
import { createSubscription, deleteSubscription, GraphError, refreshTokens, renewSubscription } from './graph.ts'
import { requireGoogle, requireMicrosoft, type SmartInboxConfig } from './runtime.ts'

export interface MailboxRow {
  id: string
  property_id: string
  provider: 'microsoft' | 'google'
  email_address: string
  display_name: string | null
  status: 'connected' | 'error' | 'disconnected'
  subscription_expires_at: string | null
}

export interface MailboxSecretRow {
  mailbox_id: string
  refresh_token_ciphertext: string
  graph_subscription_id: string | null
  client_state_hash: string | null
  // Gmail only: last mailbox history id read by the poll.
  history_id?: string | null
}

export class ReauthRequiredError extends Error {
  constructor() {
    super('reauth_required')
    this.name = 'ReauthRequiredError'
  }
}

export async function loadMailbox(admin: SupabaseClient, mailboxId: string): Promise<{ mailbox: MailboxRow; secret: MailboxSecretRow | null }> {
  const [{ data: mailbox, error }, { data: secret, error: secretError }] = await Promise.all([
    admin.from('smart_inbox_mailboxes').select('*').eq('id', mailboxId).single(),
    admin.from('smart_inbox_mailbox_secrets').select('*').eq('mailbox_id', mailboxId).maybeSingle(),
  ])
  if (error) throw error
  if (secretError) throw secretError
  return { mailbox: mailbox as MailboxRow, secret: secret as MailboxSecretRow | null }
}

export async function markMailboxError(admin: SupabaseClient, mailboxId: string, code: string): Promise<void> {
  await admin.from('smart_inbox_mailboxes').update({ status: 'error', last_error: code }).eq('id', mailboxId)
}

// Short-lived access token for a mailbox (Microsoft Graph or Gmail). A
// provider may rotate the refresh token on use; the new one is re-encrypted
// and stored.
export async function getAccessToken(
  admin: SupabaseClient,
  config: SmartInboxConfig,
  secret: MailboxSecretRow,
  provider: MailboxRow['provider'] = 'microsoft',
): Promise<string> {
  const refreshToken = await decryptSecret(secret.refresh_token_ciphertext, config.tokenKey)
  let tokens
  try {
    tokens = provider === 'google'
      ? await googleRefresh(requireGoogle(config), refreshToken)
      : await refreshTokens(requireMicrosoft(config), refreshToken)
  } catch (error) {
    const expired = (error instanceof GraphError && (error.code === 'invalid_grant' || error.code === 'interaction_required'))
      || (error instanceof GmailError && error.code === 'invalid_grant')
    if (expired) {
      await markMailboxError(admin, secret.mailbox_id, 'reauth_required')
      throw new ReauthRequiredError()
    }
    throw error
  }
  if (tokens.refreshToken && tokens.refreshToken !== refreshToken) {
    const ciphertext = await encryptSecret(tokens.refreshToken, config.tokenKey)
    const { error } = await admin
      .from('smart_inbox_mailbox_secrets')
      .update({ refresh_token_ciphertext: ciphertext })
      .eq('mailbox_id', secret.mailbox_id)
    if (error) throw error
  }
  return tokens.accessToken
}

export function webhookUrl(config: SmartInboxConfig): string {
  return `${config.functionsUrl}/smart-inbox-webhook`
}

// Creates a fresh Graph subscription (new clientState) and stores it.
export async function subscribe(admin: SupabaseClient, config: SmartInboxConfig, mailboxId: string, accessToken: string): Promise<string> {
  const clientState = randomToken(24)
  const subscription = await createSubscription(accessToken, webhookUrl(config), clientState)
  const [{ error: secretError }, { error: mailboxError }] = await Promise.all([
    admin
      .from('smart_inbox_mailbox_secrets')
      .update({ graph_subscription_id: subscription.id, client_state_hash: await sha256Hex(clientState) })
      .eq('mailbox_id', mailboxId),
    admin
      .from('smart_inbox_mailboxes')
      .update({ subscription_expires_at: subscription.expirationDateTime, status: 'connected', last_error: null })
      .eq('id', mailboxId),
  ])
  if (secretError) throw secretError
  if (mailboxError) throw mailboxError
  return subscription.id
}

// Extends the subscription, or recreates it if Microsoft already dropped it.
export async function renewOrResubscribe(admin: SupabaseClient, config: SmartInboxConfig, mailbox: MailboxRow, secret: MailboxSecretRow): Promise<void> {
  // Gmail has no subscription: its poll keeps it current.
  if (mailbox.provider === 'google') return
  const accessToken = await getAccessToken(admin, config, secret)
  if (secret.graph_subscription_id) {
    try {
      const renewed = await renewSubscription(accessToken, secret.graph_subscription_id)
      const { error } = await admin
        .from('smart_inbox_mailboxes')
        .update({ subscription_expires_at: renewed.expirationDateTime, status: 'connected', last_error: null })
        .eq('id', mailbox.id)
      if (error) throw error
      return
    } catch (error) {
      if (!(error instanceof GraphError && error.status === 404)) throw error
    }
  }
  await subscribe(admin, config, mailbox.id, accessToken)
}

export async function disconnect(admin: SupabaseClient, config: SmartInboxConfig, mailbox: MailboxRow, secret: MailboxSecretRow | null): Promise<void> {
  if (mailbox.provider === 'microsoft' && secret?.graph_subscription_id) {
    try {
      const accessToken = await getAccessToken(admin, config, secret)
      await deleteSubscription(accessToken, secret.graph_subscription_id)
    } catch (error) {
      // The connection is being removed anyway; an expired grant or an
      // already-deleted subscription must not block that.
      console.warn('smart-inbox: could not delete Graph subscription', error)
    }
  }
  const { error: deleteError } = await admin.from('smart_inbox_mailbox_secrets').delete().eq('mailbox_id', mailbox.id)
  if (deleteError) throw deleteError
  const { error } = await admin
    .from('smart_inbox_mailboxes')
    .update({ status: 'disconnected', subscription_expires_at: null, last_error: null })
    .eq('id', mailbox.id)
  if (error) throw error
}
