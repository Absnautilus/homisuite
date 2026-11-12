import { useEffect, useState } from 'react'

// Mirrors the shell's own sidebar/mobile-header breakpoint (shell-effects.css)
// -- the same width where the full chrome gives way to the stripped-down
// mobile header and bottom nav.
export function useIsMobile(breakpoint = 920): boolean {
  const query = `(max-width: ${breakpoint}px)`
  const [isMobile, setIsMobile] = useState(() => (typeof window !== 'undefined' ? window.matchMedia(query).matches : false))

  useEffect(() => {
    const mql = window.matchMedia(query)
    const onChange = () => setIsMobile(mql.matches)
    onChange()
    mql.addEventListener('change', onChange)
    return () => mql.removeEventListener('change', onChange)
  }, [query])

  return isMobile
}
