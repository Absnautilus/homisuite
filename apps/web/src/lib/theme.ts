export type ThemePreference = 'light' | 'dark' | 'system'
export type ResolvedTheme = 'light' | 'dark'

const STORAGE_KEY = 'homisuite.theme'
const CHANGE_EVENT = 'homisuite:theme-change'

function systemPrefersDark(): boolean {
  return window.matchMedia('(prefers-color-scheme: dark)').matches
}

export function readStoredThemePreference(): ThemePreference {
  const stored = localStorage.getItem(STORAGE_KEY)
  return stored === 'light' || stored === 'dark' || stored === 'system' ? stored : 'system'
}

export function resolveTheme(preference: ThemePreference): ResolvedTheme {
  if (preference === 'system') return systemPrefersDark() ? 'dark' : 'light'
  return preference
}

// `data-theme` always carries the *resolved* light/dark value, never
// 'system' -- styles.css only ever matches `[data-theme='light']` /
// `[data-theme='dark']`, so 'system' has to be resolved before it's applied.
function applyResolvedTheme(resolved: ResolvedTheme) {
  document.documentElement.setAttribute('data-theme', resolved)
}

export function setThemePreference(preference: ThemePreference) {
  localStorage.setItem(STORAGE_KEY, preference)
  applyResolvedTheme(resolveTheme(preference))
  window.dispatchEvent(new CustomEvent<ThemePreference>(CHANGE_EVENT, { detail: preference }))
}

/**
 * Wires the system-preference media query so an already-open tab updates
 * live when the OS theme changes while the user's own choice is 'system'.
 * The initial `data-theme` attribute itself is already set synchronously by
 * the inline script in index.html, before this (or any React code) runs --
 * this only keeps it in sync afterwards.
 */
export function initTheme(): () => void {
  const media = window.matchMedia('(prefers-color-scheme: dark)')
  function onSystemChange() {
    if (readStoredThemePreference() === 'system') {
      applyResolvedTheme(resolveTheme('system'))
    }
  }
  media.addEventListener('change', onSystemChange)
  return () => media.removeEventListener('change', onSystemChange)
}

export function subscribeThemeChange(listener: (preference: ThemePreference) => void): () => void {
  function handler(event: Event) {
    listener((event as CustomEvent<ThemePreference>).detail)
  }
  window.addEventListener(CHANGE_EVENT, handler)
  return () => window.removeEventListener(CHANGE_EVENT, handler)
}
