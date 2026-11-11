import { useCallback, useState } from 'react'
import { peekRemembered, setRemembered } from './use-remembered-state'

/**
 * `useRememberedState` specialized for a page's own internal tab value.
 * `key` must be unique across the app (e.g. "dining.tab",
 * "dining.reservationsView").
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
      setRemembered(key, override)
      return override
    }
    return peekRemembered<string>(key) ?? initial
  })
  const set = useCallback((next: string) => {
    setRemembered(key, next)
    setValue(next)
  }, [key])
  return [value, set]
}
