import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { classifyStayCreationError, tenantIntegrityErrorRef } from './errors.ts'

describe('stay activation error classification', () => {
  it('recognizes PostgreSQL exclusion violation as a real overlap', () => {
    assert.equal(classifyStayCreationError({ code: '23P01', message: 'conflicting key value violates exclusion constraint "stays_no_overlapping_active"' }), 'overlap')
  })
  it('does not falsely report overlaps for network or unknown database failures', () => {
    assert.equal(classifyStayCreationError({ message: 'Failed to fetch' }), 'other')
    assert.equal(classifyStayCreationError({ code: '23505', message: 'unique violation' }), 'other')
    assert.equal(classifyStayCreationError(null), 'other')
  })
  it('distinguishes invalid dates and permission errors', () => {
    assert.equal(classifyStayCreationError({ code: '23514', message: 'violates check constraint "stays_checkout_after_checkin"' }), 'invalidDates')
    assert.equal(classifyStayCreationError({ code: '42501', message: 'permission denied' }), 'permission')
  })
  it('preserves the existing tenant-integrity error reference', () => {
    assert.equal(tenantIntegrityErrorRef({ code: '23514', message: 'stays_room_hotel_mismatch' }), 'stays_room_hotel_mismatch')
    assert.equal(classifyStayCreationError({ code: '23514', message: 'stays_room_hotel_mismatch' }), 'other')
  })
})
