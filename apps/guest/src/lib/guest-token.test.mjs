import assert from 'node:assert/strict'
import { afterEach, describe, it } from 'node:test'
import { clearGuestToken, getGuestToken, setGuestToken } from './guest-token.ts'

const originalLocalStorage = globalThis.localStorage

afterEach(() => {
  if (originalLocalStorage === undefined) delete globalThis.localStorage
  else globalThis.localStorage = originalLocalStorage
})

function memoryStorage() {
  const values = new Map()
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: (key) => values.delete(key),
  }
}

describe('guest token storage', () => {
  it('stores, reads, and clears the session token', () => {
    globalThis.localStorage = memoryStorage()

    assert.equal(getGuestToken(), null)
    setGuestToken('session-token')
    assert.equal(getGuestToken(), 'session-token')
    clearGuestToken()
    assert.equal(getGuestToken(), null)
  })

  it('fails closed when localStorage is unavailable', () => {
    globalThis.localStorage = {
      getItem: () => { throw new Error('blocked') },
      setItem: () => { throw new Error('blocked') },
      removeItem: () => { throw new Error('blocked') },
    }

    assert.equal(getGuestToken(), null)
    assert.doesNotThrow(() => setGuestToken('session-token'))
    assert.doesNotThrow(() => clearGuestToken())
  })
})
