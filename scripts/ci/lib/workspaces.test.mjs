import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { extractImportSpecifiers } from './workspaces.mjs'

describe('extractImportSpecifiers', () => {
  it('extracts every supported module-loading form', () => {
    const source = `
      import value from '@homisuite/ui'
      import type { Profile } from '@homisuite/core-sdk'
      export { HousekeepingModule } from '@homisuite/housekeeping-module'
      import '@homisuite/housekeeping-module/style.css'
      const lazy = import('@homisuite/ui/lazy')
      const legacy = require('@homisuite/core-sdk/legacy')
    `

    assert.deepEqual(extractImportSpecifiers(source), [
      '@homisuite/ui',
      '@homisuite/core-sdk',
      '@homisuite/housekeeping-module',
      '@homisuite/housekeeping-module/style.css',
      '@homisuite/ui/lazy',
      '@homisuite/core-sdk/legacy',
    ])
  })

  it('does not treat ordinary strings as imports', () => {
    assert.deepEqual(extractImportSpecifiers(`const label = 'from @homisuite/ui'`), [])
  })
})
