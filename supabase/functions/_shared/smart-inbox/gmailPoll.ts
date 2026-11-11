import type { SupabaseClient } from 'npm:@supabase/supabase-js@2.116.0'
import { getProfile, GmailError, listNewInboxMessages } from './gmail.ts'
import { getAccessToken, loadMailbox, ReauthRequiredError } from './mailbox.ts'
import type { SmartInboxConfig } from './runtime.ts'

// Gmail has no webhook without Google Cloud Pub/Sub, so connected Gmail
// mailboxes are read by a short poll: everything added to the inbox since
// the last history id becomes a `pending` message, exactly like an Outlook
// webhook notification would. Returns the new message rows' ids.
export async function pollGmailMailboxes(admin: SupabaseClient, config: SmartInboxConfig): Promise<{ newMessageIds: string[]; failed: number }> {
  const result = { newMessageIds: [] as string[], failed: 0 }
  if (!config.google) return result
  const { data, error } = await admin
    .from('smart_inbox_mailboxes')
    .select('id')
    .eq('provider', 'google')
    .eq('status', 'connected')
  if (error) throw error

  for (const { id } of (data ?? []) as Array<{ id: string }>) {
    try {
      result.newMessageIds.push(...await pollOne(admin, config, id))
    } catch (cause) {
      // A revoked grant marks the mailbox (getAccessToken) and stops the
      // polling until it is reconnected; anything else is retried next run.
      result.failed++
      if (!(cause instanceof ReauthRequiredError)) console.error('smart-inbox: Gmail poll failed', id, cause)
    }
  }
  return result
}

async function pollOne(admin: SupabaseClient, config: SmartInboxConfig, mailboxId: string): Promise<string[]> {
  const { mailbox, secret } = await loadMailbox(admin, mailboxId)
  if (!secret) return []
  const token = await getAccessToken(admin, config, secret, 'google')

  let ids: string[] = []
  let historyId = secret.history_id ?? null
  if (!historyId) {
    historyId = (await getProfile(token)).historyId
  } else {
    try {
      const changes = await listNewInboxMessages(token, historyId)
      ids = changes.ids
      historyId = changes.historyId
    } catch (cause) {
      // History too old (mailbox not polled for about a week): start again
      // from now rather than fail forever.
      if (!(cause instanceof GmailError && cause.status === 404)) throw cause
      historyId = (await getProfile(token)).historyId
    }
  }

  const newIds: string[] = []
  if (ids.length > 0) {
    const { data: inserted, error } = await admin
      .from('smart_inbox_messages')
      .upsert(
        ids.map((graphMessageId) => ({ property_id: mailbox.property_id, mailbox_id: mailbox.id, graph_message_id: graphMessageId, source: 'gmail' })),
        { onConflict: 'mailbox_id,graph_message_id', ignoreDuplicates: true },
      )
      .select('id')
    if (error) throw error
    for (const row of (inserted ?? []) as Array<{ id: string }>) newIds.push(row.id)
  }

  // Saved after the rows exist, so a crash in between re-reads (and
  // de-duplicates) rather than losing mail.
  const { error: historyError } = await admin
    .from('smart_inbox_mailbox_secrets')
    .update({ history_id: historyId })
    .eq('mailbox_id', mailbox.id)
  if (historyError) throw historyError
  return newIds
}
