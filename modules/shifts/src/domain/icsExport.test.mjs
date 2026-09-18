import assert from 'node:assert/strict'
import test from 'node:test'
import { generateShiftCalendarIcs } from './icsExport.ts'

const codes = [
  { code: 'A1', label: 'Apertura 1', time: '07:00–15:00', color: '#3FA935' },
  { code: 'N', label: 'Notte', time: '23:00–07:00', color: '#E63946' },
  { code: 'R', label: 'Riposo', time: '', color: '#9AA0A6' },
  { code: 'F', label: 'Ferie', time: '', color: '#C9A227' },
]

test('exports timed, overnight and all-day shifts while skipping rest days', () => {
  const content = generateShiftCalendarIcs('ana', codes, [
    { year: 2026, month: 9, day: 18, code: 'A1' },
    { year: 2026, month: 9, day: 19, code: 'N' },
    { year: 2026, month: 9, day: 20, code: 'R' },
    { year: 2026, month: 9, day: 21, code: 'F' },
  ], new Date('2026-09-18T12:00:00.000Z'))

  assert.match(content, /DTSTART:20260918T070000\r\nDTEND:20260918T150000/)
  assert.match(content, /DTSTART:20260919T230000\r\nDTEND:20260920T070000/)
  assert.match(content, /DTSTART;VALUE=DATE:20260921\r\nDTEND;VALUE=DATE:20260922/)
  assert.doesNotMatch(content, /Riposo/)
  assert.equal((content.match(/BEGIN:VEVENT/g) ?? []).length, 3)
})

test('escapes text according to the calendar format', () => {
  const content = generateShiftCalendarIcs('ana', [{ code: 'X', label: 'Uno, due; tre', time: '09:00-17:00', color: '#000' }], [
    { year: 2026, month: 9, day: 18, code: 'X' },
  ], new Date('2026-09-18T12:00:00.000Z'))
  assert.match(content, /SUMMARY:X · Uno\\, due\\; tre/)
})
