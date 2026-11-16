import { describe, expect, it } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from './types/database'
import { getEnabledModules } from './modules'
import { mockQueryBuilder } from './testSupport'

describe('getEnabledModules', () => {
  it('maps enabled property_modules rows, joined with their module, to the domain shape', async () => {
    const client = {
      from: () =>
        mockQueryBuilder({
          data: [
            { enabled: true, testing_access: false, modules: { id: 'mod-1', slug: 'guest_requests', display_name: 'Guest Requests', status: 'active' } },
            { enabled: true, testing_access: false, modules: { id: 'mod-2', slug: 'shifts', display_name: 'Shift Planner', status: 'beta' } },
          ],
          error: null,
        }),
    } as unknown as SupabaseClient<Database>

    await expect(getEnabledModules(client, 'property-1')).resolves.toEqual([
      { moduleId: 'mod-1', slug: 'guest_requests', displayName: 'Guest Requests', enabled: true },
      { moduleId: 'mod-2', slug: 'shifts', displayName: 'Shift Planner', enabled: true },
    ])
  })

  it('returns an empty array when nothing is enabled', async () => {
    const client = {
      from: () => mockQueryBuilder({ data: [], error: null }),
    } as unknown as SupabaseClient<Database>

    await expect(getEnabledModules(client, 'property-1')).resolves.toEqual([])
  })

  it('drops a row whose joined module is unexpectedly missing rather than crashing', async () => {
    const client = {
      from: () =>
        mockQueryBuilder({
          data: [{ enabled: true, testing_access: false, modules: null }],
          error: null,
        }),
    } as unknown as SupabaseClient<Database>

    await expect(getEnabledModules(client, 'property-1')).resolves.toEqual([])
  })

  it('never surfaces an in_development module, even if enabled = true', async () => {
    const client = {
      from: () =>
        mockQueryBuilder({
          data: [{ enabled: true, testing_access: true, modules: { id: 'mod-3', slug: 'transfers', display_name: 'Transfer', status: 'in_development' } }],
          error: null,
        }),
    } as unknown as SupabaseClient<Database>

    await expect(getEnabledModules(client, 'property-1')).resolves.toEqual([])
  })

  it('hides a testing module from a property that has no testing_access', async () => {
    const client = {
      from: () =>
        mockQueryBuilder({
          data: [{ enabled: true, testing_access: false, modules: { id: 'mod-4', slug: 'shifts', display_name: 'Shift Planner', status: 'testing' } }],
          error: null,
        }),
    } as unknown as SupabaseClient<Database>

    await expect(getEnabledModules(client, 'property-1')).resolves.toEqual([])
  })

  it('shows a testing module to a property that has testing_access', async () => {
    const client = {
      from: () =>
        mockQueryBuilder({
          data: [{ enabled: true, testing_access: true, modules: { id: 'mod-5', slug: 'shifts', display_name: 'Shift Planner', status: 'testing' } }],
          error: null,
        }),
    } as unknown as SupabaseClient<Database>

    await expect(getEnabledModules(client, 'property-1')).resolves.toEqual([
      { moduleId: 'mod-5', slug: 'shifts', displayName: 'Shift Planner', enabled: true },
    ])
  })

  it('still shows a deprecated module to a property already using it', async () => {
    const client = {
      from: () =>
        mockQueryBuilder({
          data: [{ enabled: true, testing_access: false, modules: { id: 'mod-6', slug: 'dining', display_name: 'Ristorazione', status: 'deprecated' } }],
          error: null,
        }),
    } as unknown as SupabaseClient<Database>

    await expect(getEnabledModules(client, 'property-1')).resolves.toEqual([
      { moduleId: 'mod-6', slug: 'dining', displayName: 'Ristorazione', enabled: true },
    ])
  })
})
