export interface MenuItemRef {
  id: string
  category_id: string
}

export interface ItemRemovalActions {
  deleteItem: (id: string) => Promise<void>
  deactivateItem: (id: string) => Promise<void>
}

export interface CategoryRemovalActions extends ItemRemovalActions {
  deleteCategory: (id: string) => Promise<void>
  deactivateCategory: (id: string) => Promise<void>
}

export interface CategoryRemovalResult {
  outcome: 'deleted' | 'deactivated'
  deletedItemIds: string[]
  deactivatedItemIds: string[]
}

export type ItemRemovalResult = 'deleted' | 'deactivated'

function isForeignKeyViolation(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === '23503'
}

export async function removeCategoryWithItems(
  categoryId: string,
  items: readonly MenuItemRef[],
  actions: CategoryRemovalActions,
): Promise<CategoryRemovalResult> {
  try {
    await actions.deleteCategory(categoryId)
    return { outcome: 'deleted', deletedItemIds: [], deactivatedItemIds: [] }
  } catch (error) {
    if (!isForeignKeyViolation(error)) throw error
  }

  const deletedItemIds: string[] = []
  const deactivatedItemIds: string[] = []
  let allItemsDeleted = true

  for (const item of items.filter((candidate) => candidate.category_id === categoryId)) {
    try {
      await actions.deleteItem(item.id)
      deletedItemIds.push(item.id)
    } catch (error) {
      allItemsDeleted = false
      if (!isForeignKeyViolation(error)) continue
      try {
        await actions.deactivateItem(item.id)
        deactivatedItemIds.push(item.id)
      } catch {
        // The category fallback below is still the final guardrail.
      }
    }
  }

  if (allItemsDeleted) {
    try {
      await actions.deleteCategory(categoryId)
      return { outcome: 'deleted', deletedItemIds, deactivatedItemIds }
    } catch {
      // A concurrent insert can make the retry fail; deactivate instead.
    }
  }

  await actions.deactivateCategory(categoryId)
  return { outcome: 'deactivated', deletedItemIds, deactivatedItemIds }
}

export async function removeMenuItem(itemId: string, actions: ItemRemovalActions): Promise<ItemRemovalResult> {
  try {
    await actions.deleteItem(itemId)
    return 'deleted'
  } catch (error) {
    if (!isForeignKeyViolation(error)) throw error
  }

  await actions.deactivateItem(itemId)
  return 'deactivated'
}
