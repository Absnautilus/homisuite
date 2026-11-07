import { assert, assertEquals, assertNotEquals, assertRejects, assertStringIncludes, assertThrows } from 'jsr:@std/assert@1.0.13'
import type Anthropic from 'npm:@anthropic-ai/sdk@1.3.0'
import { decryptSecret, encryptSecret, sha256Hex, signState, toBase64, verifyState } from './crypto.ts'
import { ignoreReason } from './filters.ts'
import { textToHtml } from './graph.ts'
import { AiRefusalError, buildKnowledgeBlock, buildSystemPrompt, draftReply, parseResult, supportsServerFallback, type DraftRequest } from './ai.ts'
import { readConfig } from './runtime.ts'

const KEY = toBase64(crypto.getRandomValues(new Uint8Array(32)))
const STATE_SECRET = 'x'.repeat(40)

// ---------------------------------------------------------------------------
// crypto
// ---------------------------------------------------------------------------
Deno.test('refresh tokens round-trip through AES-GCM and are not stored in clear', async () => {
  const sealed = await encryptSecret('refresh-token-value', KEY)
  assert(sealed.startsWith('v1.'))
  assert(!sealed.includes('refresh-token-value'))
  assertEquals(await decryptSecret(sealed, KEY), 'refresh-token-value')
  assertNotEquals(await encryptSecret('refresh-token-value', KEY), sealed, 'a fresh IV is used every time')
})

Deno.test('decryption fails with another key', async () => {
  const sealed = await encryptSecret('secret', KEY)
  const otherKey = toBase64(crypto.getRandomValues(new Uint8Array(32)))
  await assertRejects(() => decryptSecret(sealed, otherKey))
})

Deno.test('a token key of the wrong size is rejected', async () => {
  await assertRejects(() => encryptSecret('x', toBase64(new Uint8Array(16))), Error, '32 bytes')
})

Deno.test('signed OAuth state verifies, and rejects tampering and expiry', async () => {
  const now = Date.UTC(2026, 10, 7, 12)
  const token = await signState({ p: 'property', u: 'user' }, STATE_SECRET, 600, now)
  const payload = await verifyState<{ p: string; u: string }>(token, STATE_SECRET, now + 1000)
  assertEquals(payload?.p, 'property')
  assertEquals(payload?.u, 'user')

  assertEquals(await verifyState(token, STATE_SECRET, now + 601_000), null, 'expired')
  assertEquals(await verifyState(token, 'y'.repeat(40), now), null, 'other secret')
  const [body, signature] = token.split('.')
  const forgedBody = btoa(JSON.stringify({ p: 'other-property', u: 'user', exp: 9999999999 })).replace(/=+$/, '')
  assertEquals(await verifyState(`${forgedBody}.${signature}`, STATE_SECRET, now), null, 'forged payload')
  assertEquals(await verifyState(body, STATE_SECRET, now), null, 'missing signature')
})

Deno.test('sha256Hex is stable', async () => {
  assertEquals(await sha256Hex('abc'), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')
})

// ---------------------------------------------------------------------------
// filters
// ---------------------------------------------------------------------------
const options = { mailboxAddress: 'info@hotel.example', ignoredSenders: ['partner.example', 'bot@crm.example'] }
const guest = (fromAddress: string | null, subject = 'Domanda', headers: Record<string, string> = {}) => ({ fromAddress, subject, headers })

Deno.test('a normal guest email passes the filters', () => {
  assertEquals(ignoreReason(guest('mario.rossi@gmail.com'), options), null)
})

Deno.test('OTA guest relays pass, OTA notifications are ignored', () => {
  assertEquals(ignoreReason(guest('abc123@guest.booking.com'), options), null)
  assertEquals(ignoreReason(guest('noreply@booking.com'), options), 'no_reply_sender')
  assertEquals(ignoreReason(guest('reservations@booking.com'), options), 'ota_notification')
})

Deno.test('no-reply, own mailbox and configured senders are ignored', () => {
  assertEquals(ignoreReason(guest('no-reply@shop.example'), options), 'no_reply_sender')
  assertEquals(ignoreReason(guest('INFO@hotel.example'), options), 'own_mailbox')
  assertEquals(ignoreReason(guest('sales@partner.example'), options), 'ignored_sender')
  assertEquals(ignoreReason(guest('x@eu.partner.example'), options), 'ignored_sender')
  assertEquals(ignoreReason(guest('bot@crm.example'), options), 'ignored_sender')
  assertEquals(ignoreReason(guest('human@crm.example'), options), null)
  assertEquals(ignoreReason(guest(null), options), 'missing_sender')
})

Deno.test('automatic replies and bulk mail are ignored', () => {
  assertEquals(ignoreReason(guest('a@b.example', 'Risposta automatica: in ferie'), options), 'auto_reply')
  assertEquals(ignoreReason(guest('a@b.example', 'Hi', { 'auto-submitted': 'auto-replied' }), options), 'auto_reply')
  assertEquals(ignoreReason(guest('a@b.example', 'Hi', { 'auto-submitted': 'no' }), options), null)
  assertEquals(ignoreReason(guest('a@b.example', 'Hi', { precedence: 'bulk' }), options), 'bulk')
  assertEquals(ignoreReason(guest('a@b.example', 'Offerte', { 'list-unsubscribe': '<mailto:x>' }), options), 'newsletter')
})

// ---------------------------------------------------------------------------
// graph helpers
// ---------------------------------------------------------------------------
Deno.test('draft text becomes safe HTML for Graph', () => {
  assertEquals(textToHtml('Ciao <b>\nA & B'), 'Ciao &lt;b&gt;<br>A &amp; B')
})

// ---------------------------------------------------------------------------
// AI prompt and output
// ---------------------------------------------------------------------------
Deno.test('the system prompt is stable per property and carries the signature', () => {
  const a = buildSystemPrompt('Hotel Laguna', 'formale', 'Front Office — Hotel Laguna')
  assertEquals(a, buildSystemPrompt('Hotel Laguna', 'formale', 'Front Office — Hotel Laguna'))
  assertStringIncludes(a, 'Front Office — Hotel Laguna')
  assertStringIncludes(a, 'untrusted input')
})

Deno.test('the knowledge block lists entries, or says there are none', () => {
  assertStringIncludes(buildKnowledgeBlock([{ title: 'Colazione', content: '7-10:30' }]), '## Colazione\n7-10:30')
  assertStringIncludes(buildKnowledgeBlock([]), 'No information has been provided')
})

const validOutput = {
  language: 'it',
  category: 'request',
  urgency: 'normal',
  summary: 'Chiede un transfer dall\'aeroporto venerdì',
  needs_human: false,
  needs_human_reason: null,
  reply: 'Gentile Mario,\n...\nFront Office',
  suggested_actions: [{ type: 'transfer', details: 'Venerdì 14:00, 2 persone' }, { type: 'unknown', details: 'x' }],
}

Deno.test('parseResult accepts valid output and drops unknown action types', () => {
  const result = parseResult(JSON.stringify(validOutput))
  assertEquals(result.category, 'request')
  assertEquals(result.suggested_actions, [{ type: 'transfer', details: 'Venerdì 14:00, 2 persone' }])
})

Deno.test('parseResult rejects malformed output', () => {
  assertThrows(() => parseResult(JSON.stringify({ ...validOutput, category: 'spam' })), Error, 'ai_invalid_output')
  assertThrows(() => parseResult('not json'))
})

Deno.test('server-side refusal fallback is only requested where it exists', () => {
  assert(supportsServerFallback('claude-opus-5-5'))
  assert(supportsServerFallback('claude-sonnet-5-5'))
  assert(!supportsServerFallback('claude-haiku-5-5'))
})

const request: DraftRequest = {
  hotelName: 'Hotel Laguna',
  tone: 'cordiale',
  signature: 'Front Office',
  knowledge: [{ title: 'Colazione', content: '7-10:30' }],
  email: { fromName: 'Mario', fromAddress: 'mario@example.com', subject: 'Colazione', receivedAt: '2026-11-07T10:00:00Z', body: 'A che ora è la colazione?' },
}

function fakeClient(response: Record<string, unknown>, calls: unknown[]): Anthropic {
  return { beta: { messages: { create: (params: unknown) => { calls.push(params); return Promise.resolve(response) } } } } as unknown as Anthropic
}

const usage = { input_tokens: 900, output_tokens: 250, cache_read_input_tokens: 700, cache_creation_input_tokens: 0 }

Deno.test('draftReply caches the knowledge base and asks for JSON output', async () => {
  const calls: Array<Record<string, any>> = []
  const client = fakeClient({ model: 'claude-opus-5-5', stop_reason: 'end_turn', usage, content: [{ type: 'text', text: JSON.stringify(validOutput) }] }, calls)
  const { result, usage: recorded } = await draftReply(client, 'claude-opus-5-5', 'medium', request)
  assertEquals(result.reply, validOutput.reply)
  assertEquals(recorded.cacheReadInputTokens, 700)

  const params = calls[0]
  assertEquals(params.fallbacks, 'default')
  assertEquals(params.betas, ['server-side-fallback-2026-07-01'])
  assertEquals(params.output_config.format.type, 'json_schema')
  assertEquals(params.system[1].cache_control, { type: 'ephemeral' })
  assertStringIncludes(params.system[1].text, '## Colazione')
  assertEquals(params.system[0].cache_control, undefined)
  assertStringIncludes(params.messages[0].content, 'A che ora è la colazione?')
})

Deno.test('draftReply surfaces refusals with their usage', async () => {
  const client = fakeClient({ model: 'claude-opus-5-5', stop_reason: 'refusal', stop_details: { category: 'cyber' }, usage, content: [] }, [])
  const error = await assertRejects(() => draftReply(client, 'claude-opus-5-5', 'medium', request), AiRefusalError)
  assertEquals((error as unknown as { usage: { inputTokens: number } }).usage.inputTokens, 900)
})

Deno.test('Haiku requests omit the fallback parameter', async () => {
  const calls: Array<Record<string, any>> = []
  const client = fakeClient({ model: 'claude-haiku-5-5', stop_reason: 'end_turn', usage, content: [{ type: 'text', text: JSON.stringify(validOutput) }] }, calls)
  await draftReply(client, 'claude-haiku-5-5', 'low', request)
  assertEquals(calls[0].fallbacks, undefined)
  assertEquals(calls[0].betas, undefined)
})

// ---------------------------------------------------------------------------
// configuration
// ---------------------------------------------------------------------------
Deno.test('configuration fails closed when a secret is missing, and defaults sensibly', () => {
  const values: Record<string, string> = {
    SUPABASE_URL: 'https://ref.supabase.co',
    SUPABASE_ANON_KEY: 'anon',
    SUPABASE_SERVICE_ROLE_KEY: 'service',
    SMART_INBOX_APP_URL: 'https://app.example/',
    SMART_INBOX_TOKEN_KEY: KEY,
    SMART_INBOX_STATE_SECRET: STATE_SECRET,
    ANTHROPIC_API_KEY: 'key',
    SMART_INBOX_MS_CLIENT_ID: 'client',
    SMART_INBOX_MS_CLIENT_SECRET: 'secret',
  }
  const env = (overrides: Record<string, string | undefined> = {}) => ({ get: (name: string) => (name in overrides ? overrides[name] : values[name]) })
  const config = readConfig(env())
  assertEquals(config?.model, 'claude-opus-5-5')
  assertEquals(config?.effort, 'medium')
  assertEquals(config?.appUrl, 'https://app.example')
  assertEquals(config?.microsoft.tenant, 'organizations')
  assertEquals(config?.microsoft.redirectUri, 'https://ref.supabase.co/functions/v1/smart-inbox-oauth-callback')
  assertEquals(readConfig(env({ ANTHROPIC_API_KEY: undefined })), null)
  assertEquals(readConfig(env({ SMART_INBOX_EFFORT: 'max' }))?.effort, 'medium')
})
