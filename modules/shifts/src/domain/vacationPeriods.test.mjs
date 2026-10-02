import assert from 'node:assert/strict'
import test from 'node:test'
import {
  countVacationDays, findVacationOverlap, validateVacationRequest, displayVacationStatus,
} from './vacationPeriods.ts'

test('countVacationDays is inclusive of both endpoints', () => {
  assert.equal(countVacationDays('2026-07-06', '2026-07-06'), 1)
  assert.equal(countVacationDays('2026-07-06', '2026-07-17'), 12)
})

test('findVacationOverlap ignores the requester\'s own periods', () => {
  const periods = [
    { staffProfileId: 'a', periodIndex: 0, start: '2026-07-01', end: '2026-07-10', status: 'confirmed' },
  ]
  assert.equal(findVacationOverlap(periods, 'a', '2026-07-05', '2026-07-08'), null)
})

test('findVacationOverlap finds an overlapping period from someone else', () => {
  const other = { staffProfileId: 'b', periodIndex: 1, start: '2026-07-05', end: '2026-07-16', status: 'confirmed' }
  const periods = [other]
  assert.equal(findVacationOverlap(periods, 'a', '2026-07-06', '2026-07-17'), other)
})

test('findVacationOverlap ignores non-overlapping periods', () => {
  const periods = [
    { staffProfileId: 'b', periodIndex: 0, start: '2026-08-01', end: '2026-08-10', status: 'confirmed' },
  ]
  assert.equal(findVacationOverlap(periods, 'a', '2026-07-06', '2026-07-17'), null)
})

test('findVacationOverlap treats touching date ranges (shared boundary day) as overlapping', () => {
  const other = { staffProfileId: 'b', periodIndex: 0, start: '2026-07-17', end: '2026-07-25', status: 'pending' }
  const periods = [other]
  assert.equal(findVacationOverlap(periods, 'a', '2026-07-06', '2026-07-17'), other)
})

test('validateVacationRequest rejects an inverted date range', () => {
  const settings = { periodsPerYear: 3, minDays: 1, maxDays: 30 }
  assert.equal(validateVacationRequest({ start: '2026-07-17', end: '2026-07-06', periodIndex: 0 }, settings), 'invalid_date_range')
})

test('validateVacationRequest rejects a period index outside the configured count', () => {
  const settings = { periodsPerYear: 2, minDays: 1, maxDays: 30 }
  assert.equal(validateVacationRequest({ start: '2026-07-06', end: '2026-07-10', periodIndex: 2 }, settings), 'invalid_period_index')
  assert.equal(validateVacationRequest({ start: '2026-07-06', end: '2026-07-10', periodIndex: -1 }, settings), 'invalid_period_index')
})

test('validateVacationRequest rejects a duration outside min/max days', () => {
  const settings = { periodsPerYear: 3, minDays: 5, maxDays: 21 }
  assert.equal(validateVacationRequest({ start: '2026-07-06', end: '2026-07-08', periodIndex: 0 }, settings), 'duration_out_of_range')
  assert.equal(validateVacationRequest({ start: '2026-07-01', end: '2026-08-01', periodIndex: 0 }, settings), 'duration_out_of_range')
})

test('validateVacationRequest accepts a valid request', () => {
  const settings = { periodsPerYear: 3, minDays: 5, maxDays: 21 }
  assert.equal(validateVacationRequest({ start: '2026-07-06', end: '2026-07-17', periodIndex: 2 }, settings), null)
})

test('displayVacationStatus shows a past confirmed period as "taken"', () => {
  const period = { staffProfileId: 'a', periodIndex: 0, start: '2026-01-06', end: '2026-01-10', status: 'confirmed' }
  assert.equal(displayVacationStatus(period, '2026-10-02'), 'taken')
})

test('displayVacationStatus shows a future confirmed period as "confirmed"', () => {
  const period = { staffProfileId: 'a', periodIndex: 0, start: '2026-12-01', end: '2026-12-10', status: 'confirmed' }
  assert.equal(displayVacationStatus(period, '2026-10-02'), 'confirmed')
})

test('displayVacationStatus never shows a pending period as "taken", even if the dates are past', () => {
  const period = { staffProfileId: 'a', periodIndex: 0, start: '2026-01-06', end: '2026-01-10', status: 'pending' }
  assert.equal(displayVacationStatus(period, '2026-10-02'), 'pending')
})
