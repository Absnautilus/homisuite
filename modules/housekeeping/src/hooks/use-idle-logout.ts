import { useEffect, useRef } from 'react'

const ACTIVITY_EVENTS = ['pointerdown', 'keydown', 'wheel', 'touchstart'] as const

// Tracks real user interaction (not just the tab regaining focus, which
// fires no DOM events of its own) and calls onIdle once none of it has
// happened for timeoutMs -- used to close out a shared/kiosk-style staff
// session automatically instead of leaving someone signed in (and "on
// duty") long after they've actually walked away. onIdle is read through a
// ref so a caller passing a fresh inline function each render doesn't
// reset the timer on every re-render.
export function useIdleLogout(enabled: boolean, timeoutMs: number, onIdle: () => void) {
  const onIdleRef = useRef(onIdle)
  onIdleRef.current = onIdle

  useEffect(() => {
    if (!enabled) return
    let timer: number

    function reset() {
      window.clearTimeout(timer)
      timer = window.setTimeout(() => onIdleRef.current(), timeoutMs)
    }

    for (const event of ACTIVITY_EVENTS) window.addEventListener(event, reset, { passive: true })
    reset()

    return () => {
      window.clearTimeout(timer)
      for (const event of ACTIVITY_EVENTS) window.removeEventListener(event, reset)
    }
  }, [enabled, timeoutMs])
}
