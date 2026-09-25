import assert from 'node:assert/strict'
import test from 'node:test'
import { contrastTextColor } from './contrastColor.ts'

test('dark backgrounds get white text', () => {
  assert.equal(contrastTextColor('#111111'), '#ffffff')
  assert.equal(contrastTextColor('#1a1a2e'), '#ffffff')
  assert.equal(contrastTextColor('#000000'), '#ffffff')
})

test('light backgrounds get dark text', () => {
  assert.equal(contrastTextColor('#EAD23C'), '#111111')
  assert.equal(contrastTextColor('#ffffff'), '#111111')
  // A saturated red reads as "dark" to the eye, but WCAG's channel-weighted
  // luminance formula (red weighted only 0.2126) puts this one just over
  // the threshold -- confirmed against the reference formula, not assumed.
  assert.equal(contrastTextColor('#E63946'), '#111111')
})

test('accepts a 3-digit hex shorthand', () => {
  assert.equal(contrastTextColor('#fff'), '#111111')
  assert.equal(contrastTextColor('#000'), '#ffffff')
})

test('falls back to dark text for an unparseable value', () => {
  assert.equal(contrastTextColor('not-a-color'), '#111111')
})
