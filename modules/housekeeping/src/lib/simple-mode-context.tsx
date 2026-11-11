import { createContext, useContext, useMemo, useState, type ReactNode } from 'react'

// A per-device display preference (same storage model as ui-scale-context),
// not per-account: this is meant for a shared tablet at a fixed station,
// switched on for whoever is using it right now rather than following one
// person's login across devices.
const STORAGE_KEY = 'roomcall_simple_mode'

function readStored(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === '1'
  } catch {
    return false
  }
}

interface SimpleModeContextValue {
  enabled: boolean
  setEnabled: (value: boolean) => void
}

const SimpleModeContext = createContext<SimpleModeContextValue | null>(null)

export function SimpleModeProvider({ children }: { children: ReactNode }) {
  const [enabled, setEnabledState] = useState<boolean>(() => readStored())

  function setEnabled(next: boolean) {
    setEnabledState(next)
    try {
      localStorage.setItem(STORAGE_KEY, next ? '1' : '0')
    } catch {
      // per-device convenience only -- fine if it doesn't persist
    }
  }

  const value = useMemo<SimpleModeContextValue>(() => ({ enabled, setEnabled }), [enabled])

  return <SimpleModeContext.Provider value={value}>{children}</SimpleModeContext.Provider>
}

export function useSimpleMode(): SimpleModeContextValue {
  const ctx = useContext(SimpleModeContext)
  if (!ctx) throw new Error('useSimpleMode must be used within a SimpleModeProvider')
  return ctx
}
