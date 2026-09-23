import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { subscriptionKeyMatches, urlBase64ToUint8Array, vapidKeyFingerprint } from './devicePushKeys.ts'

describe('subscriptionKeyMatches', () => {
  it('returns null when the browser does not expose applicationServerKey', () => {
    assert.equal(subscriptionKeyMatches(null, new Uint8Array([1, 2, 3])), null)
  })

  it('matches equal keys byte-for-byte', () => {
    const current = urlBase64ToUint8Array('BKHEL8hDabxTpAiWphFTkveiv30ESiC7rHzJp0qylzck_d-tvJfEixOzcgiPk1UOpjKXaK5mGfRMvkaMcFgvXdY')
    const buffer = current.buffer.slice(current.byteOffset, current.byteOffset + current.byteLength)
    assert.equal(subscriptionKeyMatches(buffer, current), true)
  })

  it('rejects a rotated key', () => {
    const current = urlBase64ToUint8Array('BKHEL8hDabxTpAiWphFTkveiv30ESiC7rHzJp0qylzck_d-tvJfEixOzcgiPk1UOpjKXaK5mGfRMvkaMcFgvXdY')
    const stale = urlBase64ToUint8Array('BNbxGYNMhEJn7TmC169CTLdMLI7fB7lVpMhs7yYWvxbmWSmjxvDgYIkSSAAV9wTGm-yQ9k0BURcw7DPFa9v1s2Y')
    assert.equal(subscriptionKeyMatches(stale.buffer.slice(stale.byteOffset, stale.byteOffset + stale.byteLength), current), false)
  })
})

describe('vapidKeyFingerprint', () => {
  it('is stable for the same public key', async () => {
    const key = 'BKHEL8hDabxTpAiWphFTkveiv30ESiC7rHzJp0qylzck_d-tvJfEixOzcgiPk1UOpjKXaK5mGfRMvkaMcFgvXdY'
    assert.equal(await vapidKeyFingerprint(key), await vapidKeyFingerprint(key))
  })
})
