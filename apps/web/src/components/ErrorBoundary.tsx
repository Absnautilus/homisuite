import { Component, type ReactNode } from 'react'
import { PageState } from './PageState'

const CHUNK_RELOAD_KEY = 'homisuite_chunk_reload_at'
const CHUNK_RELOAD_COOLDOWN_MS = 60_000

// Dynamic imports (every lazy route in app/App.tsx) fetch a JS file by the
// exact hash baked into whatever index.html this tab last loaded. A tab
// left open across a deploy still holds an older hash, and the very next
// navigation to a route it hasn't loaded yet in this session asks for a
// chunk that no longer exists -- the fetch rejects, and with no error
// boundary anywhere in this app, React unmounted the entire tree right up
// to the root, leaving a blank page with no nav, no message, nothing to
// click. A hard reload fixes it immediately (it picks up the current
// index.html, with current hashes) but nothing was telling the person to
// do that.
function isChunkLoadError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error)
  return /dynamically imported module|loading chunk|chunkloaderror/i.test(message)
}

export class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state: { error: Error | null } = { error: null }

  static getDerivedStateFromError(error: Error) {
    return { error }
  }

  componentDidCatch(error: Error) {
    if (!isChunkLoadError(error)) {
      console.error(error)
      return
    }
    // Reload once, not on every render of this fallback -- a genuinely
    // broken deploy (not just a stale tab) would otherwise reload forever.
    // sessionStorage, not a module-level flag: a flag in memory resets on
    // the very reload it's meant to survive past.
    let lastReload = 0
    try {
      lastReload = Number(sessionStorage.getItem(CHUNK_RELOAD_KEY) ?? 0)
    } catch {
      // Private window or blocked storage -- fall through to the manual
      // fallback UI below instead of reloading blind.
      return
    }
    if (Date.now() - lastReload < CHUNK_RELOAD_COOLDOWN_MS) return
    try {
      sessionStorage.setItem(CHUNK_RELOAD_KEY, String(Date.now()))
    } catch {
      return
    }
    window.location.reload()
  }

  render() {
    if (this.state.error) {
      if (isChunkLoadError(this.state.error)) {
        // Mid-reload (or storage was blocked and the reload above never
        // fired) -- same loading shape the rest of the app uses while it
        // waits for something, rather than the error icon for a problem
        // that's already resolving itself.
        return <PageState kind="loading" title="Aggiornamento in corso…" variant="fullscreen" />
      }
      return (
        <PageState
          kind="error"
          title="Qualcosa non ha funzionato."
          description="Prova a ricaricare la pagina. Se il problema continua, contatta l'assistenza."
          action={{ label: 'Ricarica pagina', onClick: () => window.location.reload() }}
          variant="fullscreen"
        />
      )
    }
    return this.props.children
  }
}
