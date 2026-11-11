import { assert, assertEquals, assertNotEquals, assertRejects, assertStringIncludes, assertThrows } from 'jsr:@std/assert@1.0.13'
import type Anthropic from 'npm:@anthropic-ai/sdk@1.3.0'
import { decryptSecret, encryptSecret, sha256Hex, signState, toBase64, verifyState } from './crypto.ts'
import { ignoreReason, relaySource } from './filters.ts'
import { textToHtml } from './graph.ts'
import { AiRefusalError, buildEmailMessage, buildKnowledgeBlock, buildSystemPrompt, draftReply, HISTORY_ENTRY_CHARS, parseResult, supportsServerFallback, type DraftRequest } from './ai.ts'
import { readConfig } from './runtime.ts'
import { appendSignature, DEFAULT_AGENT_SIGNATURE, DEFAULT_PROPERTY_SIGNATURE, renderSignature } from './signature.ts'
import { pastedGuestKey } from './pipeline.ts'

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
Deno.test('the system prompt is stable per property and leaves the signature out', () => {
  const a = buildSystemPrompt('Hotel Laguna', 'formale')
  assertEquals(a, buildSystemPrompt('Hotel Laguna', 'formale'))
  assertStringIncludes(a, 'Hotel Laguna')
  assertStringIncludes(a, 'untrusted input')
  assertStringIncludes(a, 'closing formula')
  assertStringIncludes(a, 'never write them')
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
  reply: 'Gentile Mario,\n...\nCordiali saluti,',
  suggested_actions: [{ type: 'transfer', details: 'Venerdì 14:00, 2 persone' }, { type: 'unknown', details: 'x' }],
  stay_month: '2026-12',
  guest: { name: 'Mario Rossi', arrival_date: '2026-12-12', arrival_time: '23:30', departure_date: null, guests: '2 adulti', booking_reference: null, requests: ['transfer'] },
  templates_used: ['Check-in tardivo'],
  info_used: ['Parcheggio'],
  missing_fields: ['numero prenotazione'],
  missing_info: [],
  template_gap: null,
  translation_it: 'ignorata: risposta già in italiano',
}

Deno.test('parseResult accepts valid output and drops unknown action types', () => {
  const result = parseResult(JSON.stringify(validOutput))
  assertEquals(result.category, 'request')
  assertEquals(result.suggested_actions, [{ type: 'transfer', details: 'Venerdì 14:00, 2 persone' }])
})

Deno.test('parseResult keeps what the AI read from the guest and what it used', () => {
  const result = parseResult(JSON.stringify(validOutput))
  assertEquals(result.guest.arrival_time, '23:30')
  assertEquals(result.guest.requests, ['transfer'])
  assertEquals(result.templates_used, ['Check-in tardivo'])
  assertEquals(result.missing_fields, ['numero prenotazione'])
  assertEquals(result.translation_it, null, 'no translation for an Italian reply')
  const german = parseResult(JSON.stringify({ ...validOutput, language: 'de', translation_it: 'Gentile Lukas...' }))
  assertEquals(german.translation_it, 'Gentile Lukas...')
  const sparse = parseResult(JSON.stringify({ ...validOutput, guest: undefined, templates_used: 'x', template_gap: '  ' }))
  assertEquals(sparse.guest.name, null)
  assertEquals(sparse.templates_used, [])
  assertEquals(sparse.template_gap, null)
})

Deno.test('parseResult keeps a valid stay month and drops a malformed one', () => {
  assertEquals(parseResult(JSON.stringify(validOutput)).stay_month, '2026-12')
  assertEquals(parseResult(JSON.stringify({ ...validOutput, stay_month: '2026-13' })).stay_month, null)
  assertEquals(parseResult(JSON.stringify({ ...validOutput, stay_month: null })).stay_month, null)
})

Deno.test('templates join the cached hotel block; guest notes go with the email', () => {
  const block = buildKnowledgeBlock([{ title: 'Colazione', content: '7-10:30', assistant_note: 'Non citare il brunch' }], [
    { title: 'Check-in', body: 'Gentile {nome}, il check-in è dalle 14.' },
    { title: 'Arrivo tardivo', body: 'Gentile {nome}, nessun problema.', when_to_use: 'Arrivo dopo le "22"', translations: { de: 'Lieber {nome}, kein Problem.', en: ' ' } },
  ])
  assertStringIncludes(block, '<reply_templates>')
  assertStringIncludes(block, '<template title="Check-in">\nGentile {nome}')
  assertStringIncludes(block, "(Note for the assistant: Non citare il brunch)")
  assertStringIncludes(block, `<template title="Arrivo tardivo" when="Arrivo dopo le '22'">`)
  assertStringIncludes(block, '<version language="de">\nLieber {nome}, kein Problem.\n</version>')
  assert(!block.includes('<version language="en">'), 'empty translations are skipped')
  assert(!buildKnowledgeBlock([]).includes('<reply_templates>'))
  const message = buildEmailMessage(request.email, [], 'Cliente abituale, allergico alle noci')
  assert(message.startsWith('<staff_notes_about_guest>\nCliente abituale'))
  assert(!buildEmailMessage(request.email, [], '  ').includes('staff_notes'))
})

Deno.test('pasted messages name their channel; revisions carry the draft and the instruction', () => {
  const pasted = { ...request.email, fromAddress: null, subject: null, body: 'Hallo, wir kommen um 23:30 an.' }
  const message = buildEmailMessage(pasted, [], '', 'booking')
  assertStringIncludes(message, '<guest_message channel="the Booking.com extranet">')
  assert(!message.includes('Subject:'))
  assertStringIncludes(message, 'From: Mario')
  const revision = buildEmailMessage(pasted, [], '', 'whatsapp', { currentReply: 'Lieber Lukas, ...', instruction: 'più breve' })
  assert(revision.indexOf('</guest_message>') < revision.indexOf('<current_draft>'))
  assert(revision.trimEnd().endsWith('Staff instruction: più breve'))
  assert(!message.includes('<current_draft>'))
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

Deno.test('earlier exchanges with the guest come before the new email, clipped', () => {
  const text = buildEmailMessage(request.email, [
    { from: 'guest', at: '2026-11-01T09:00:00Z', text: 'Avete il parcheggio?' },
    { from: 'hotel', at: '2026-11-01T10:00:00Z', text: 'x'.repeat(HISTORY_ENTRY_CHARS + 50) },
  ])
  assert(text.indexOf('<previous_messages>') < text.indexOf('<guest_message'))
  assertStringIncludes(text, '<message from="guest" date="2026-11-01T09:00:00Z">\nAvete il parcheggio?')
  assertStringIncludes(text, `${'x'.repeat(HISTORY_ENTRY_CHARS)} […]`)
  assert(!buildEmailMessage(request.email).includes('<previous_messages>'), 'no history block for a first email')
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
  assertEquals(readConfig(env({ SMART_INBOX_MS_CLIENT_ID: undefined })), null)
  assertEquals(readConfig(env({ SMART_INBOX_MS_CLIENT_ID: undefined }), { requireMicrosoft: false })?.microsoft.clientId, '', 'pasting works before the Microsoft app exists')
})

// ---------------------------------------------------------------------------
// signature
// ---------------------------------------------------------------------------
Deno.test('the signature is rendered per sender and tidied when a value is missing', () => {
  assertEquals(renderSignature(DEFAULT_AGENT_SIGNATURE, { agent: 'Luca Ferri', role: 'Receptionist', hotel: 'Hotel Laguna' }), 'Luca Ferri\nReceptionist — Hotel Laguna')
  assertEquals(renderSignature(DEFAULT_AGENT_SIGNATURE, { agent: 'Luca Ferri', role: null, hotel: 'Hotel Laguna' }), 'Luca Ferri\nHotel Laguna')
  assertEquals(renderSignature(DEFAULT_PROPERTY_SIGNATURE, { agent: null, role: null, hotel: 'Hotel Laguna' }), 'Front Office — Hotel Laguna')
  assertEquals(renderSignature('{AGENT} | {ruolo}\n\n{hotel}', { agent: 'Giulia', role: '', hotel: 'H' }), 'Giulia\nH')
})

Deno.test('the signature goes under the closing formula written by the AI', () => {
  assertEquals(appendSignature('Lieber Lukas,\nkein Problem.\n\nMit freundlichen Grüßen,\n\n', 'Luca Ferri\nReceptionist — Hotel Laguna'), 'Lieber Lukas,\nkein Problem.\n\nMit freundlichen Grüßen,\nLuca Ferri\nReceptionist — Hotel Laguna')
  assertEquals(appendSignature('Ciao ', ''), 'Ciao')
})

Deno.test('pasted guests get one conversation per channel and name', () => {
  assertEquals(pastedGuestKey('booking', '  Lukas   Weber '), 'booking:lukas weber')
  assert(pastedGuestKey('whatsapp', 'Lukas Weber') !== pastedGuestKey('booking', 'Lukas Weber'))
})

// ---------------------------------------------------------------------------
// OTA messages relayed by email, sender style
// ---------------------------------------------------------------------------
Deno.test('guest messages relayed by Booking/Expedia/Airbnb are recognised, notifications are not', () => {
  assertEquals(relaySource('4f2a91@guest.booking.com'), 'booking')
  assertEquals(relaySource('Lukas.Weber@M.ExpediaPartnerCentral.com'), 'expedia')
  assertEquals(relaySource('abc@reply.airbnb.com'), 'airbnb')
  assertEquals(relaySource('noreply@booking.com'), null)
  assertEquals(relaySource('guest@gmail.com'), null)
  assertEquals(relaySource(null), null)
  // A relayed guest message is not dropped as a portal notification.
  assertEquals(ignoreReason({ fromAddress: '4f2a91@guest.booking.com', subject: 'Messaggio', headers: {} }, { mailboxAddress: 'info@hotel.it', ignoredSenders: [] }), null)
})

Deno.test('the sender\'s personal style goes with the message, never in the cached prompt', () => {
  const style = { tone: 'formale' as const, instructions: 'Do sempre del lei.' }
  const message = buildEmailMessage(request.email, [], '', 'outlook', undefined, style)
  assertStringIncludes(message, '<sender_style>')
  assertStringIncludes(message, 'Preferences: Do sempre del lei.')
  assert(message.indexOf('<sender_style>') < message.indexOf('<guest_message'))
  assert(!buildEmailMessage(request.email, [], '', 'outlook', undefined, { tone: null, instructions: '  ' }).includes('sender_style'))
  assert(!buildSystemPrompt('Hotel Laguna', 'cordiale').includes('Do sempre del lei'))
})
