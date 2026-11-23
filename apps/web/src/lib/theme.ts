// Moved to @homisuite/ui so apps/partner (and any future app) can reuse the
// exact same read/resolve/set logic instead of re-implementing it -- this
// file stays only as a stable import path for apps/web's own existing
// importers (SettingsPage, AccountMenu, PlatformLayout, ThemeToggle, main.tsx).
export { readStoredThemePreference, resolveTheme, setThemePreference, initTheme, subscribeThemeChange } from '@homisuite/ui'
export type { ThemePreference, ResolvedTheme } from '@homisuite/ui'
