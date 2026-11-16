import { useEffect, useRef, useState } from 'react'

/**
 * A `useState` replacement for a flow's step/screen state that also makes
 * the device's native back button or swipe-back gesture walk back through
 * the flow, instead of leaving the guest app entirely -- these multi-step
 * flows (category -> type -> compose, discover -> detail -> request) never
 * touch the History API, so there's nothing for the OS back action to undo.
 *
 * Each step forward pushes a history entry tagged with this hook's own key;
 * a matching `popstate` restores that step. A key from elsewhere (or none)
 * is left alone, so this never steps on another flow's or the page's own
 * history entries.
 */
export function useBackableStep<T>(initial: T): [T, (next: T) => void] {
  const [step, setStep] = useState<T>(initial)
  const key = useRef(`bs_${Math.random().toString(36).slice(2)}`).current
  const isFirstRender = useRef(true)
  const fromPopState = useRef(false)

  useEffect(() => {
    // Seed the step the flow mounted with onto the CURRENT entry (replace,
    // not push) so the very first back press has somewhere to land instead
    // of leaving the page immediately.
    window.history.replaceState({ ...(window.history.state ?? {}), [key]: initial }, '')
    function onPopState(event: PopStateEvent) {
      const state = event.state as Record<string, T> | null
      if (state && key in state) {
        fromPopState.current = true
        setStep(state[key] as T)
      }
    }
    window.addEventListener('popstate', onPopState)
    return () => window.removeEventListener('popstate', onPopState)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (isFirstRender.current) {
      isFirstRender.current = false
      return
    }
    if (fromPopState.current) {
      fromPopState.current = false
      return
    }
    window.history.pushState({ ...(window.history.state ?? {}), [key]: step }, '')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step])

  return [step, setStep]
}
