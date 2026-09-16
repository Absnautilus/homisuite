import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { brandColorStyle } from './brand-color.ts'

describe('brandColorStyle', () => {
  it('returns the three guest theme tokens for a valid hex color', () => {
    assert.deepEqual(brandColorStyle({ hotel_brand_color: '#7c3aed' }), {
      '--accent': '#7c3aed',
      '--accent-soft': 'color-mix(in srgb, #7c3aed 12%, white)',
      '--accent-soft-line': 'color-mix(in srgb, #7c3aed 28%, white)',
    })
  })

  it('accepts uppercase hex digits', () => {
    assert.equal(brandColorStyle({ hotel_brand_color: '#A1B2C3' })['--accent'], '#A1B2C3')
  })

  it('ignores missing, shorthand, and unsafe CSS values', () => {
    assert.deepEqual(brandColorStyle({ hotel_brand_color: null }), {})
    assert.deepEqual(brandColorStyle({ hotel_brand_color: '#fff' }), {})
    assert.deepEqual(brandColorStyle({ hotel_brand_color: 'red; color: transparent' }), {})
  })
})
