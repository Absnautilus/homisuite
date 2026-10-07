import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { todayIso } from './todayIso.ts'

describe('todayIso', () => {
  it('returns the UTC calendar date when asked in UTC', () => {
    const now = new Date('2026-03-15T10:00:00Z')
    assert.equal(todayIso('UTC', now), '2026-03-15')
  })

  it('00:30 Europe/Rome is not the previous day just because UTC is still behind', () => {
    // 2026-03-15T00:30 in Rome (CET, UTC+1 in March before DST) is
    // 2026-03-14T23:30Z -- a naive UTC-based "today" would read this as
    // the 14th, hours after local midnight had already passed.
    const now = new Date('2026-03-14T23:30:00Z')
    assert.equal(todayIso('Europe/Rome', now), '2026-03-15')
  })

  it('23:45 Europe/Rome stays the same local day even though UTC has already rolled over', () => {
    const now = new Date('2026-07-01T22:45:00Z') // 2026-07-02T00:45 CEST (UTC+2 in July)
    assert.equal(todayIso('Europe/Rome', now), '2026-07-02')
  })
})
