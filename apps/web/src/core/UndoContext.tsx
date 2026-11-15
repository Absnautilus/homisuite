import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import { Toast } from '@homisuite/ui'

export interface UndoAction {
  // Shown in the toast while the undo window is open, e.g. '"Oniga" eliminato.'
  message: string
  undo: () => Promise<void>
}

interface UndoContextValue {
  pushUndo: (action: UndoAction) => void
}

const UndoContext = createContext<UndoContextValue | null>(null)

// Same auto-dismiss length Housekeeping's own toast stack already uses --
// long enough to react to, short enough that "undo" never reaches back
// further than the person would expect from their last action.
const UNDO_WINDOW_MS = 8000

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  if (target.isContentEditable) return true
  return target.tagName === 'INPUT' || target.tagName === 'TEXTAREA'
}

// One pending action at a time, not a history stack -- matches the actual
// ask (undo the thing I just did), and keeps "what does Ctrl+Z do right
// now" unambiguous. A new delete simply replaces whatever was pending.
export function UndoProvider({ children }: { children: ReactNode }) {
  const [pending, setPending] = useState<UndoAction | null>(null)
  const [undoing, setUndoing] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const dismissTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const clearPending = useCallback(() => {
    if (dismissTimer.current) clearTimeout(dismissTimer.current)
    dismissTimer.current = null
    setPending(null)
    setUndoing(false)
  }, [])

  const pushUndo = useCallback((action: UndoAction) => {
    if (dismissTimer.current) clearTimeout(dismissTimer.current)
    setErrorMessage(null)
    setPending(action)
    setUndoing(false)
    dismissTimer.current = setTimeout(clearPending, UNDO_WINDOW_MS)
  }, [clearPending])

  const runUndo = useCallback(async (action: UndoAction) => {
    setUndoing(true)
    try {
      await action.undo()
      clearPending()
    } catch (cause) {
      console.error('undo failed', cause)
      clearPending()
      setErrorMessage('Annullamento non riuscito. Riprova dalla scheda.')
      setTimeout(() => setErrorMessage(null), 5000)
    }
  }, [clearPending])

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (!pending) return
      // Exact match for Ctrl+Z / Cmd+Z only -- Shift held too is commonly
      // "redo" elsewhere, and this has no redo to offer.
      if (event.key.toLowerCase() !== 'z' || !(event.ctrlKey || event.metaKey) || event.shiftKey) return
      // Never steal the shortcut from a text field's own native undo.
      if (isEditableTarget(event.target)) return
      event.preventDefault()
      void runUndo(pending)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [pending, runUndo])

  return (
    <UndoContext.Provider value={{ pushUndo }}>
      {children}
      <Toast open={Boolean(pending) || Boolean(errorMessage)}>
        {pending ? (
          <>
            <span>{pending.message}</span>
            <button type="button" onClick={() => void runUndo(pending)} disabled={undoing}>
              {undoing ? 'Annullo…' : 'Annulla'}
            </button>
          </>
        ) : errorMessage ? (
          <span>{errorMessage}</span>
        ) : null}
      </Toast>
    </UndoContext.Provider>
  )
}

export function useUndo(): (action: UndoAction) => void {
  const ctx = useContext(UndoContext)
  if (!ctx) throw new Error('useUndo must be used within UndoProvider')
  return ctx.pushUndo
}
