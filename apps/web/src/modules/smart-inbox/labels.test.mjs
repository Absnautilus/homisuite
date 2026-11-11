import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { deliveryOf, formatMinutes, isOpenView, percent, appendSignature, DEFAULT_AGENT_SIGNATURE, languageName, previewTemplate, renderSignature, sourceBadge, templateLanguages, topicCounts, actionErrorLabel, draftHint, fillTemplate, groupByConversation, insertTemplateText, monthFromInput, monthInputValue, monthLabel, simpleState, ignoreReasonLabel, initials, isActionable, messageErrorLabel, parseSenderList, statusesForView, statusTone, summarizeUsage } from './labels.ts'

describe('Smart Inbox labels', () => {
  it('splits messages into the three inbox views without overlap', () => {
    const all = [...statusesForView('todo'), ...statusesForView('replied'), ...statusesForView('archived')]
    assert.equal(new Set(all).size, all.length)
    assert.equal(all.length, 8)
    assert.ok(statusesForView('todo').includes('draft_ready'))
    assert.ok(statusesForView('archived').includes('ignored'))
  })

  it('gives every status a tone', () => {
    assert.equal(statusTone('draft_ready'), 'ok')
    assert.equal(statusTone('needs_attention'), 'warn')
    assert.equal(statusTone('failed'), 'danger')
    assert.equal(statusTone('ignored'), 'neutral')
  })

  it('normalizes the ignored senders list', () => {
    assert.deepEqual(parseSenderList(' Booking.com\n@partner.example, noreply@x.example;\n\nbooking.com'), ['booking.com', 'partner.example', 'noreply@x.example'])
  })

  it('never shows raw codes to staff for known errors, and falls back politely', () => {
    assert.match(messageErrorLabel('reauth_required'), /ricollegare/)
    assert.match(messageErrorLabel('Graph GET /me/messages failed: 500'), /ritentata/)
    assert.equal(messageErrorLabel(null), null)
    assert.match(actionErrorLabel('already_sent'), /già stata inviata/)
    assert.match(actionErrorLabel(null), /Riprova/)
    assert.equal(ignoreReasonLabel('ota_notification'), 'notifica automatica di un portale (OTA)')
  })

  it('estimates usage cost, and gives up when a model price is unknown', () => {
    const row = { model: 'claude-opus-5-5', input_tokens: 1_000_000, output_tokens: 100_000, cache_read_input_tokens: 1_000_000, cache_creation_input_tokens: 0 }
    const summary = summarizeUsage([row])
    assert.equal(summary.calls, 1)
    assert.equal(summary.inputTokens, 2_000_000)
    assert.ok(Math.abs(summary.estimatedUsd - (4 + 0.2 + 2)) < 1e-9)
    assert.equal(summarizeUsage([{ ...row, model: 'other-model' }]).estimatedUsd, null)
  })

  it('"Assegnate a me" shows the same open work as "Da gestire"', () => {
    assert.deepEqual(statusesForView('mine'), statusesForView('todo'))
    assert.ok(isActionable('needs_attention'))
    assert.ok(!isActionable('replied'))
  })

  it('groups messages into one row per guest, newest conversation first', () => {
    const conversation = { guest_address: 'mario@x.it', guest_name: 'Mario Rossi', assigned_to: 'agent-1' }
    const message = (id, thread, at, status, extra = {}) => ({ id, thread_id: thread, received_at: at, status, from_name: null, from_address: null, conversation: thread ? conversation : null, ...extra })
    const groups = groupByConversation([
      message('a', 't1', '2026-11-07T08:00:00Z', 'replied'),
      message('b', 't1', '2026-11-07T10:00:00Z', 'draft_ready'),
      message('c', null, '2026-11-07T09:00:00Z', 'pending', { from_address: 'new@y.it' }),
      message('d', 't1', '2026-11-07T09:30:00Z', 'needs_attention'),
    ])
    assert.equal(groups.length, 2)
    assert.equal(groups[0].threadId, 't1')
    assert.equal(groups[0].latest.id, 'b')
    assert.equal(groups[0].messages.length, 3)
    assert.equal(groups[0].openCount, 2)
    assert.equal(groups[0].guestName, 'Mario Rossi')
    assert.equal(groups[0].assignedTo, 'agent-1')
    assert.equal(groups[1].key, 'message:c')
    assert.equal(groups[1].guestName, 'new@y.it')
  })

  it('reduces every status to Da rispondere / Risposto / Archiviata', () => {
    assert.equal(simpleState('draft_ready'), 'to_answer')
    assert.equal(simpleState('needs_attention'), 'to_answer')
    assert.equal(simpleState('pending'), 'to_answer')
    assert.equal(simpleState('replied'), 'answered')
    assert.equal(simpleState('ignored'), 'archived')
    assert.equal(draftHint('needs_attention', false), 'Da scrivere a mano')
    assert.equal(draftHint('replied', true), null)
  })

  it('labels and converts stay months', () => {
    assert.equal(monthLabel('2026-12-01'), 'Dicembre 2026')
    assert.equal(monthLabel(null), null)
    assert.equal(monthInputValue('2026-12-01'), '2026-12')
    assert.equal(monthFromInput('2026-12'), '2026-12-01')
    assert.equal(monthFromInput('2026-13'), null)
    assert.equal(monthFromInput(''), null)
  })

  it('fills {nome} in templates with the guest first name only', () => {
    assert.equal(fillTemplate('Gentile {nome}, grazie.', 'Mario Rossi'), 'Gentile Mario, grazie.')
    assert.equal(fillTemplate('Gentile {nome}, grazie.', 'mario@x.it'), 'Gentile, grazie.')
    assert.equal(fillTemplate('Hi {NOME}!', null), 'Hi!')
  })

  it('inserts a template before the closing paragraph when nobody is typing', () => {
    const draft = 'Gentile Mario,\n\ngrazie per la richiesta.\n\nCordiali saluti,\nFront Office'
    const { value } = insertTemplateText(draft, 'Il parcheggio costa 25 euro.', null)
    assert.equal(value, 'Gentile Mario,\n\ngrazie per la richiesta.\n\nIl parcheggio costa 25 euro.\n\nCordiali saluti,\nFront Office')
  })

  it('inserts a template at the cursor without gluing it to words', () => {
    const { value, caret } = insertTemplateText('Ciao Mario, grazie.', 'TESTO', { start: 11, end: 11 })
    assert.equal(value, 'Ciao Mario,\n\nTESTO\n\n grazie.')
    assert.equal(value.slice(0, caret), 'Ciao Mario,\n\nTESTO')
    assert.equal(insertTemplateText('', 'TESTO', null).value, 'TESTO')
    assert.equal(insertTemplateText('Solo una riga', 'TESTO', null).value, 'Solo una riga\n\nTESTO')
  })

  it('makes avatar initials from a name', () => {
    assert.equal(initials('Giulia Bianchi'), 'GB')
    assert.equal(initials('Marco'), 'M')
    assert.equal(initials('  '), '?')
  })

  it('renders the agent signature like the server does', () => {
    assert.equal(renderSignature(DEFAULT_AGENT_SIGNATURE, { agent: 'Luca Ferri', role: 'Receptionist', hotel: 'Hotel Laguna' }), 'Luca Ferri\nReceptionist — Hotel Laguna')
    assert.equal(renderSignature(DEFAULT_AGENT_SIGNATURE, { agent: 'Luca Ferri', role: null, hotel: 'Hotel Laguna' }), 'Luca Ferri\nHotel Laguna')
    assert.equal(appendSignature('Mit freundlichen Grüßen,\n\n', 'Luca Ferri'), 'Mit freundlichen Grüßen,\nLuca Ferri')
  })

  it('labels channels, languages and template versions', () => {
    assert.equal(sourceBadge('outlook'), 'Outlook')
    assert.equal(sourceBadge('booking'), 'Booking.com · incollato')
    assert.equal(languageName('de-AT'), 'tedesco')
    assert.deepEqual(templateLanguages({ en: 'Hi', de: 'Hallo', fr: ' ' }), ['IT', 'DE', 'EN'])
  })

  it('previews a template with an example guest and the hotel information', () => {
    assert.equal(
      previewTemplate('Gentile {nome}, arrivo il {data arrivo}. {info: Parcheggio} {sconosciuto}', [{ title: 'Parcheggio', content: '200 m, 25 €' }]),
      'Gentile Lukas, arrivo il 14 dicembre. 200 m, 25 € {sconosciuto}',
    )
  })

  it('counts recurring topics regardless of case and punctuation', () => {
    assert.deepEqual(topicCounts(['Animali ammessi?', 'animali ammessi', 'Deposito bagagli', ' ']), [
      { topic: 'Animali ammessi?', count: 2 },
      { topic: 'Deposito bagagli', count: 1 },
    ])
  })

  it('tells email-relayed portal messages from pasted ones', () => {
    assert.equal(sourceBadge('booking', 'mailbox'), 'Booking.com · via email')
    assert.equal(sourceBadge('booking', 'pasted'), 'Booking.com · incollato')
    assert.equal(sourceBadge('outlook', 'mailbox'), 'Outlook')
    assert.equal(sourceBadge('whatsapp', 'whatsapp'), 'WhatsApp')
    assert.equal(sourceBadge('whatsapp', 'pasted'), 'WhatsApp · incollato')
    assert.equal(deliveryOf({ mailbox_id: null, whatsapp_account_id: 'w1' }), 'whatsapp')
    assert.equal(deliveryOf({ mailbox_id: 'm1', whatsapp_account_id: null }), 'mailbox')
    assert.equal(deliveryOf({ mailbox_id: null }), 'pasted')
  })

  it('treats "Da assegnare" as a view of guests still waiting', () => {
    assert.ok(isOpenView('unassigned'))
    assert.ok(!isOpenView('replied'))
    assert.deepEqual(statusesForView('unassigned'), statusesForView('todo'))
  })

  it('formats response times and shares for the statistics', () => {
    assert.equal(formatMinutes(null), '—')
    assert.equal(formatMinutes(42), '42 min')
    assert.equal(formatMinutes(75), '1 h 15 min')
    assert.equal(formatMinutes(120), '2 h')
    assert.equal(formatMinutes(60 * 24 * 2 + 90), '2 g 1 h')
    assert.equal(percent(1, 3), '33%')
    assert.equal(percent(0, 0), '—')
  })
})
