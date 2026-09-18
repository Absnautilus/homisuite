import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { resolveDiningAccess } from './resolveDiningAccess.ts'

describe('resolveDiningAccess', () => {
  it('is not-entitled when the property has no dining entitlement', () => {
    const result = resolveDiningAccess({ entitled: false, legacyHotelId: null, staffProfileId: null })
    assert.deepEqual(result, { status: 'not-entitled' })
  })

  it('is not-entitled even if a stale hotelId/profile slipped through', () => {
    // Regression guard: entitlement must win over stale mapping/profile data,
    // e.g. a property whose module was just disabled.
    const result = resolveDiningAccess({ entitled: false, legacyHotelId: 'hotel-1', staffProfileId: 'profile-1' })
    assert.deepEqual(result, { status: 'not-entitled' })
  })

  it('is no-mapping when entitled but the property has no bridged legacy hotel', () => {
    const result = resolveDiningAccess({ entitled: true, legacyHotelId: null, staffProfileId: null })
    assert.deepEqual(result, { status: 'no-mapping' })
  })

  it('is no-profile when entitled and mapped but the current user has no operational profile there', () => {
    const result = resolveDiningAccess({ entitled: true, legacyHotelId: 'hotel-1', staffProfileId: null })
    assert.deepEqual(result, { status: 'no-profile' })
  })

  it('is compatible only when all three conditions hold, and carries the resolved hotelId and staffProfileId', () => {
    const result = resolveDiningAccess({ entitled: true, legacyHotelId: 'hotel-1', staffProfileId: 'profile-1' })
    assert.deepEqual(result, { status: 'compatible', hotelId: 'hotel-1', staffProfileId: 'profile-1' })
  })
})
