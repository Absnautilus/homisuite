import { useCallback, useState } from 'react'

// Leaving one page for another (sidebar nav, not just an internal tab or
// modal interaction) unmounts the page entirely -- a plain useState resets
// to its default on the way back, discarding whatever the person had open:
// which tab was active, which modal was open and on what record. This
// module-level map survives that remount (it isn't component state), so
// returning to the page restores things as they were left. It resets on a
// real page reload/new tab, which is the right scope: nothing here needs
// to survive past the browser session.
const store = new Map<string, unknown>()

/** Direct read, for a lazy useState initializer that also needs to apply an override -- see useRememberedTab. */
export function peekRemembered<T>(key: string): T | undefined {
  return store.has(key) ? (store.get(key) as T) : undefined
}

export function setRemembered<T>(key: string, value: T): void {
  store.set(key, value)
}

/**
 * Drop-in replacement for `useState` whose value survives this component
 * unmounting and remounting (e.g. navigating to a different page and back
 * via the sidebar). `key` must be unique across the app -- it's a single
 * shared map, so e.g. "team.editingMemberId", "dining.detailReservationId".
 *
 * Keep what's remembered small and durable -- an id, a boolean, which modal
 * is open -- and derive the rest (the actual record, its current fields)
 * from data reloaded fresh on remount, the same way a selected-id pattern
 * already does for a list+detail view. Don't remember a whole record object
 * or in-progress form field values directly: the object referenced across
 * a remount may be stale, and nothing here re-validates it against fresh
 * data on its own.
 */
export function useRememberedState<T>(key: string, initial: T): [T, (next: T) => void] {
  const [value, setValue] = useState<T>(() => peekRemembered<T>(key) ?? initial)
  const set = useCallback((next: T) => {
    setRemembered(key, next)
    setValue(next)
  }, [key])
  return [value, set]
}
