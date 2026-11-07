import { loadMailbox, renewOrResubscribe } from '../_shared/smart-inbox/mailbox.ts'
import { MAX_ATTEMPTS, processMessage } from '../_shared/smart-inbox/pipeline.ts'
import { adminClient, anthropicClient, json, readConfig } from '../_shared/smart-inbox/runtime.ts'

// Periodic upkeep, called by a scheduler (verify_jwt = false) with the
// header `x-smart-inbox-cron: <SMART_INBOX_CRON_SECRET>`. Suggested cadence:
// every 30 minutes. It:
//   1. renews Graph subscriptions that expire within 24 hours (Microsoft
//      drops mail subscriptions after ~3 days unless renewed);
//   2. turns messages stuck in `processing` for 15+ minutes into `failed`;
//   3. retries `pending`/`failed` messages from the last 3 days, up to
//      MAX_ATTEMPTS each -- this also catches any notification whose
//      background processing was cut short.

const RETRY_BATCH = 20

async function timingSafeEqual(a: string, b: string): Promise<boolean> {
  const encoder = new TextEncoder()
  const [hashA, hashB] = await Promise.all([
    crypto.subtle.digest('SHA-256', encoder.encode(a)),
    crypto.subtle.digest('SHA-256', encoder.encode(b)),
  ])
  const viewA = new Uint8Array(hashA)
  const viewB = new Uint8Array(hashB)
  let diff = 0
  for (let i = 0; i < viewA.length; i++) diff |= viewA[i] ^ viewB[i]
  return diff === 0
}

Deno.serve(async (request: Request) => {
  if (request.method !== 'POST') return json({ error: 'method_not_allowed' }, 405)
  const config = readConfig()
  if (!config || !config.cronSecret) return json({ error: 'server_not_configured' }, 500)
  const provided = request.headers.get('x-smart-inbox-cron') ?? ''
  if (!(await timingSafeEqual(provided, config.cronSecret))) return json({ error: 'forbidden' }, 403)

  const admin = adminClient(config)
  const report = { renewed: 0, renewFailed: 0, unstuck: 0, retried: 0 }

  // 1. Subscriptions
  const renewBefore = new Date(Date.now() + 24 * 60 * 60_000).toISOString()
  const { data: mailboxes, error: mailboxError } = await admin
    .from('smart_inbox_mailboxes')
    .select('id')
    .eq('status', 'connected')
    .or(`subscription_expires_at.is.null,subscription_expires_at.lt.${renewBefore}`)
  if (mailboxError) return json({ error: 'internal_error' }, 500)
  for (const { id } of (mailboxes ?? []) as Array<{ id: string }>) {
    try {
      const { mailbox, secret } = await loadMailbox(admin, id)
      if (!secret) continue
      await renewOrResubscribe(admin, config, mailbox, secret)
      report.renewed++
    } catch (error) {
      report.renewFailed++
      console.error('smart-inbox-maintenance: subscription renewal failed', id, error)
    }
  }

  // 2. Stuck messages
  const stuckBefore = new Date(Date.now() - 15 * 60_000).toISOString()
  const { data: unstuck } = await admin
    .from('smart_inbox_messages')
    .update({ status: 'failed', error: 'processing_timeout' })
    .eq('status', 'processing')
    .lt('updated_at', stuckBefore)
    .select('id')
  report.unstuck = unstuck?.length ?? 0

  // 3. Retries
  const since = new Date(Date.now() - 3 * 24 * 60 * 60_000).toISOString()
  const { data: retry } = await admin
    .from('smart_inbox_messages')
    .select('id')
    .in('status', ['pending', 'failed'])
    .lt('attempts', MAX_ATTEMPTS)
    .gte('received_at', since)
    .order('received_at')
    .limit(RETRY_BATCH)
  const deps = { admin, config, anthropic: anthropicClient(config) }
  for (const { id } of (retry ?? []) as Array<{ id: string }>) {
    if (await processMessage(deps, id)) report.retried++
  }

  return json(report)
})
