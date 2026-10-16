import { useEffect, useState } from 'react'
import { Moon, Sun } from 'lucide-react'
import {
  readStoredThemePreference,
  resolveTheme,
  setThemePreference,
  subscribeThemeChange,
  type ResolvedTheme,
} from '../lib/theme'

const LABELS: Record<ResolvedTheme, string> = { light: 'Chiaro', dark: 'Scuro' }
const OPTIONS: { value: ResolvedTheme; Icon: typeof Sun }[] = [
  { value: 'light', Icon: Sun },
  { value: 'dark', Icon: Moon },
]

// Two options, not three: a third "Sistema" button read as one too many
// alongside the account menu's own quick toggle (AccountMenu.tsx), which is
// already a plain light/dark switch. "System" stays how the theme starts
// before any explicit choice is made (see theme.ts/index.html's inline
// script) -- it just isn't a separately selectable option here anymore.
// Tracks the *resolved* theme rather than the raw preference, same reason
// as AccountMenu's toggle: with only two buttons there's no third state to
// represent 'system' as its own selection, so picking either button is
// read the same way clicking the account-menu icon already is -- an
// explicit choice, highlighted by whichever one matches what's on screen
// right now.
//
// Same inline segmented-control idiom as LanguageToggle -- a radiogroup of
// icon buttons in .lang-toggle, not a popover -- so it sits in Settings'
// Account section the same way Lingua/Notifiche do.
export function ThemeToggle() {
  const [resolved, setResolved] = useState<ResolvedTheme>(() => resolveTheme(readStoredThemePreference()))

  useEffect(() => subscribeThemeChange(() => setResolved(resolveTheme(readStoredThemePreference()))), [])

  return (
    <div className="lang-toggle" role="radiogroup" aria-label="Tema">
      {OPTIONS.map(({ value, Icon }) => (
        <button
          key={value}
          type="button"
          role="radio"
          aria-checked={value === resolved}
          aria-label={LABELS[value]}
          title={LABELS[value]}
          className={`lang-toggle-option${value === resolved ? ' current' : ''}`}
          onClick={() => setThemePreference(value)}
        >
          <Icon size={16} />
        </button>
      ))}
    </div>
  )
}
