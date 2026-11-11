import { useCallback, useState } from 'react'

// Leaving one page for another (sidebar nav, not just an internal tab
// click) unmounts the page entirely -- a plain useState for "which tab is
// active" resets to its default on the way back, discarding whatever the
// person had open. This module-level map survives that remount (it isn't
// component state), so returning to the page restores the tab it was left
// on. It resets on a real page reload/new tab, which is the right scope:
// nothing here needs to survive past the browser session.
const rememberedTabs = new Map<string, string>()

/**
 * Drop-in replacement for `useState` on a page's own internal tab value --
 * same `[value, setValue]` shape, except the value survives this page
 * unmounting and remounting (e.g. navigating away and back via the
 * sidebar). `key` must be unique across the app (e.g. "dining.tab",
 * "dining.reservationsView") since it's a single shared map.
 *
 * `override`, when truthy, wins over whatever's remembered -- for a page
 * that also honours a one-off deep link (e.g. `?tab=impostazioni`), which
 * must always land where the link says regardless of where the person
 * left off last time. The override is itself remembered, so switching
 * tabs afterwards behaves normally.
 */
export function useRememberedTab(key: string, initial: string, override?: string | null): [string, (next: string) => void] {
  const [value, setValue] = useState(() => {
    if (override) {
      rememberedTabs.set(key, override)
      return override
    }
    return rememberedTabs.get(key) ?? initial
  })
  const set = useCallback((next: string) => {
    rememberedTabs.set(key, next)
    setValue(next)
  }, [key])
  return [value, set]
}
