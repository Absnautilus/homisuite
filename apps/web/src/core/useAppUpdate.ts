import { useEffect, useRef, useState } from 'react'

const CHECK_INTERVAL_MS = 5 * 60_000

// Tolerant of attribute order (type="module" before or after src="...") --
// safer than one combined regex now that the exact built markup isn't
// something this code controls directly (it's Vite's own output).
function extractEntryScriptSrc(html: string): string | null {
  const scriptTags = html.match(/<script\b[^>]*>/g) ?? []
  for (const tag of scriptTags) {
    if (!tag.includes('type="module"')) continue
    const srcMatch = tag.match(/\bsrc="([^"]+)"/)
    if (srcMatch) return srcMatch[1]
  }
  return null
}

// Detects a new deploy while this tab stays open. The installed PWA on a
// hotel's shared tablet is practically never closed, so without this a
// device can keep running a stale build indefinitely after a fix ships --
// the same "stuck on an old version" problem the Housekeeping service
// worker's skipWaiting/clients.claim solves for itself (see
// public/sw.js), just for the app bundle rather than the worker file, and
// there's no fetch-intercepting service worker here to hook into instead.
export function useAppUpdate(): { available: boolean; reload: () => void } {
  const [available, setAvailable] = useState(false)
  const currentSrcRef = useRef<string | null>(null)

  useEffect(() => {
    if (currentSrcRef.current === null) {
      currentSrcRef.current = extractEntryScriptSrc(document.documentElement.outerHTML)
    }

    async function check() {
      try {
        const res = await fetch('/', { cache: 'no-store' })
        if (!res.ok) return
        const html = await res.text()
        const latestSrc = extractEntryScriptSrc(html)
        if (latestSrc && currentSrcRef.current && latestSrc !== currentSrcRef.current) {
          setAvailable(true)
        }
      } catch {
        // Offline or a transient network blip -- just try again next tick.
      }
    }

    const interval = setInterval(() => void check(), CHECK_INTERVAL_MS)
    function onVisible() {
      if (document.visibilityState === 'visible') void check()
    }
    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener('focus', onVisible)
    return () => {
      clearInterval(interval)
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener('focus', onVisible)
    }
  }, [])

  return { available, reload: () => window.location.reload() }
}
