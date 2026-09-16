import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { removeCategoryWithItems, removeMenuItem } from './menu-removal.ts'

const fkViolation = () => Object.assign(new Error('foreign key violation'), { code: '23503' })
const item = (id, categoryId = 'category-1') => ({ id, category_id: categoryId })

function actions(overrides = {}) {
  return {
    deleteCategory: async () => {},
    deleteItem: async () => {},
    deactivateCategory: async () => {},
    deactivateItem: async () => {},
    ...overrides,
  }
}

describe('removeCategoryWithItems', () => {
  it('deletes an empty category directly', async () => {
    const result = await removeCategoryWithItems('category-1', [], actions())
    assert.deepEqual(result, { outcome: 'deleted', deletedItemIds: [], deactivatedItemIds: [] })
  })

  it('deletes unreferenced items before retrying a category blocked by them', async () => {
    let categoryAttempts = 0
    const deleted = []
    const result = await removeCategoryWithItems(
      'category-1',
      [item('item-1'), item('item-2'), item('other-item', 'category-2')],
      actions({
        deleteCategory: async () => {
          categoryAttempts += 1
          if (categoryAttempts === 1) throw fkViolation()
        },
        deleteItem: async (id) => deleted.push(id),
      }),
    )

    assert.equal(categoryAttempts, 2)
    assert.deepEqual(deleted, ['item-1', 'item-2'])
    assert.deepEqual(result, { outcome: 'deleted', deletedItemIds: ['item-1', 'item-2'], deactivatedItemIds: [] })
  })

  it('deactivates historical items and then the category', async () => {
    const deactivatedItems = []
    const deactivatedCategories = []
    const result = await removeCategoryWithItems(
      'category-1',
      [item('item-1')],
      actions({
        deleteCategory: async () => { throw fkViolation() },
        deleteItem: async () => { throw fkViolation() },
        deactivateItem: async (id) => deactivatedItems.push(id),
        deactivateCategory: async (id) => deactivatedCategories.push(id),
      }),
    )

    assert.deepEqual(deactivatedItems, ['item-1'])
    assert.deepEqual(deactivatedCategories, ['category-1'])
    assert.deepEqual(result, { outcome: 'deactivated', deletedItemIds: [], deactivatedItemIds: ['item-1'] })
  })

  it('surfaces an unexpected initial category deletion error', async () => {
    const failure = new Error('network down')
    await assert.rejects(
      removeCategoryWithItems('category-1', [], actions({ deleteCategory: async () => { throw failure } })),
      failure,
    )
  })

  it('surfaces a failed category deactivation', async () => {
    const failure = new Error('deactivation denied')
    await assert.rejects(
      removeCategoryWithItems('category-1', [item('item-1')], actions({
        deleteCategory: async () => { throw fkViolation() },
        deleteItem: async () => { throw fkViolation() },
        deactivateCategory: async () => { throw failure },
      })),
      failure,
    )
  })

  it('deactivates the category when a concurrent item blocks the delete retry', async () => {
    const deactivatedCategories = []
    const result = await removeCategoryWithItems('category-1', [item('item-1')], actions({
      deleteCategory: async () => { throw fkViolation() },
      deactivateCategory: async (id) => deactivatedCategories.push(id),
    }))

    assert.deepEqual(deactivatedCategories, ['category-1'])
    assert.deepEqual(result, { outcome: 'deactivated', deletedItemIds: ['item-1'], deactivatedItemIds: [] })
  })
})

describe('removeMenuItem', () => {
  it('deletes an item without history', async () => {
    assert.equal(await removeMenuItem('item-1', actions()), 'deleted')
  })

  it('deactivates an item with request history', async () => {
    let deactivatedId = null
    const result = await removeMenuItem('item-1', actions({
      deleteItem: async () => { throw fkViolation() },
      deactivateItem: async (id) => { deactivatedId = id },
    }))
    assert.equal(result, 'deactivated')
    assert.equal(deactivatedId, 'item-1')
  })

  it('does not mask unexpected deletion errors', async () => {
    const failure = new Error('network down')
    await assert.rejects(removeMenuItem('item-1', actions({ deleteItem: async () => { throw failure } })), failure)
  })

  it('surfaces a failed fallback deactivation', async () => {
    const failure = new Error('deactivation denied')
    await assert.rejects(removeMenuItem('item-1', actions({
      deleteItem: async () => { throw fkViolation() },
      deactivateItem: async () => { throw failure },
    })), failure)
  })
})
