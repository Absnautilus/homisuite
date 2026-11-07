import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { actionErrorLabel, ignoreReasonLabel, messageErrorLabel, parseSenderList, statusesForView, statusTone, summarizeUsage } from './labels.ts'

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
})
