import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'

// A per-device display preference (same storage model as ui-scale-context),
// not per-account: this is meant for a shared tablet at a fixed station,
// switched on for whoever is using it right now rather than following one
// person's login across devices.
const STORAGE_KEY = 'roomcall_simple_mode'

// Fired on `window` whenever the flag changes, same tab included (the
// native `storage` event only reaches *other* tabs) -- lets a shell-level
// component outside this module's own React tree (ShellLayout, which
// mounts above it, not below) react live, e.g. to relocate its own
// floating help button while this bar is showing. Read with
// `isSimpleModeEnabled()` below rather than the React context, which only
// resolves inside a `SimpleModeProvider`.
export const SIMPLE_MODE_CHANGE_EVENT = 'homisuite:simple-mode-change'

function readStored(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === '1'
  } catch {
    return false
  }
}

export function isSimpleModeEnabled(): boolean {
  return readStored()
}

// The plain write side of the same cross-boundary API -- lets a component
// outside this module's own tree (apps/web's simplified settings panel,
// portaled into the minimal bar the same way its help button is) flip the
// flag without needing a SimpleModeProvider of its own.
export function setSimpleModeEnabled(next: boolean): void {
  try {
    localStorage.setItem(STORAGE_KEY, next ? '1' : '0')
  } catch {
    // per-device convenience only -- fine if it doesn't persist
  }
  window.dispatchEvent(new Event(SIMPLE_MODE_CHANGE_EVENT))
}

interface SimpleModeContextValue {
  enabled: boolean
  setEnabled: (value: boolean) => void
}

const SimpleModeContext = createContext<SimpleModeContextValue | null>(null)

export function SimpleModeProvider({ children }: { children: ReactNode }) {
  const [enabled, setEnabledState] = useState<boolean>(() => readStored())

  // Keeps this provider's own state in sync with a write from outside this
  // module's tree (see setSimpleModeEnabled above) -- without this, toggling
  // it from the simplified settings panel wouldn't update this bar's own
  // SimpleModeToggle until something else re-mounted it.
  useEffect(() => {
    function onChange() {
      setEnabledState(readStored())
    }
    window.addEventListener(SIMPLE_MODE_CHANGE_EVENT, onChange)
    return () => window.removeEventListener(SIMPLE_MODE_CHANGE_EVENT, onChange)
  }, [])

  function setEnabled(next: boolean) {
    setEnabledState(next)
    setSimpleModeEnabled(next)
  }

  const value = useMemo<SimpleModeContextValue>(() => ({ enabled, setEnabled }), [enabled])

  return <SimpleModeContext.Provider value={value}>{children}</SimpleModeContext.Provider>
}

export function useSimpleMode(): SimpleModeContextValue {
  const ctx = useContext(SimpleModeContext)
  if (!ctx) throw new Error('useSimpleMode must be used within a SimpleModeProvider')
  return ctx
}
