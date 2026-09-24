import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { subscriptionKeyMatches, urlBase64ToUint8Array } from './devicePushKeys.ts'

describe('subscriptionKeyMatches', () => {
  it('treats an unreadable existing key as a match, never forcing a resubscribe', () => {
    const currentKey = urlBase64ToUint8Array('BKHEL8hDabxTpAiWphFTkveiv30ESiC7rHzJp0qylzck_d-tvJfEixOzcgiPk1UOpjKXaK5mGfRMvkaMcFgvXdY')
    assert.equal(subscriptionKeyMatches(null, currentKey), true)
  })

  it('matches when the existing subscription was created with the same key', () => {
    const currentKey = urlBase64ToUint8Array('BKHEL8hDabxTpAiWphFTkveiv30ESiC7rHzJp0qylzck_d-tvJfEixOzcgiPk1UOpjKXaK5mGfRMvkaMcFgvXdY')
    const existingKey = currentKey.buffer.slice(currentKey.byteOffset, currentKey.byteOffset + currentKey.byteLength)
    assert.equal(subscriptionKeyMatches(existingKey, currentKey), true)
  })

  it('does not match a subscription created with a different (e.g. rotated) VAPID key', () => {
    // A different, but equally valid-shaped, VAPID public key.
    const currentKey = urlBase64ToUint8Array('BKHEL8hDabxTpAiWphFTkveiv30ESiC7rHzJp0qylzck_d-tvJfEixOzcgiPk1UOpjKXaK5mGfRMvkaMcFgvXdY')
    const staleKey = urlBase64ToUint8Array('BNbxGYNMhEJn7TmC169CTLdMLI7fB7lVpMhs7yYWvxbmWSmjxvDgYIkSSAAV9wTGm-yQ9k0BURcw7DPFa9v1s2Y')
    const staleBuffer = staleKey.buffer.slice(staleKey.byteOffset, staleKey.byteOffset + staleKey.byteLength)
    assert.equal(subscriptionKeyMatches(staleBuffer, currentKey), false)
  })

  it('does not match when the existing key is a different length entirely', () => {
    const currentKey = new Uint8Array([1, 2, 3, 4])
    const shorterKey = new Uint8Array([1, 2, 3]).buffer
    assert.equal(subscriptionKeyMatches(shorterKey, currentKey), false)
  })
})
