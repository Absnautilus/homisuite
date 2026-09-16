import { useEffect, useState } from 'react'
import './dropdown-transition.css'

export type DropdownTransitionState = 'closed' | 'open' | 'closing'

// Drives a dropdown/popover's mount lifecycle so closing gets a real exit
// animation instead of vanishing instantly: `open` flips to 'open'
// immediately, but flipping back holds 'closing' for `closeDurationMs`
// before actually unmounting. Pair with dropdownTransitionClassName on the
// popover element, and only render it while `mounted` is true.
export function useDropdownTransition(open: boolean, closeDurationMs = 150): { state: DropdownTransitionState; mounted: boolean } {
  const [state, setState] = useState<DropdownTransitionState>(open ? 'open' : 'closed')

  useEffect(() => {
    if (open) {
      setState('open')
      return
    }
    setState((current) => (current === 'closed' ? 'closed' : 'closing'))
  }, [open])

  useEffect(() => {
    if (state !== 'closing') return
    const id = window.setTimeout(() => setState('closed'), closeDurationMs)
    return () => window.clearTimeout(id)
  }, [state, closeDurationMs])

  return { state, mounted: state !== 'closed' }
}

export function dropdownTransitionClassName(state: DropdownTransitionState, className?: string): string {
  return ['ui-dropdown', state === 'open' && 'is-open', state === 'closing' && 'is-closing', className].filter(Boolean).join(' ')
}
