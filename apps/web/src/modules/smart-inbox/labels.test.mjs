import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { actionErrorLabel, groupByConversation, ignoreReasonLabel, initials, isActionable, messageErrorLabel, parseSenderList, statusesForView, statusTone, summarizeUsage } from './labels.ts'

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

  it('makes avatar initials from a name', () => {
    assert.equal(initials('Giulia Bianchi'), 'GB')
    assert.equal(initials('Marco'), 'M')
    assert.equal(initials('  '), '?')
  })
})
