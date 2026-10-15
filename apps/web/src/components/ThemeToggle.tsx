import { useEffect, useState } from 'react'
import { Moon, Monitor, Sun } from 'lucide-react'
import {
  readStoredThemePreference,
  setThemePreference,
  subscribeThemeChange,
  type ThemePreference,
} from '../lib/theme'

const LABELS: Record<ThemePreference, string> = { light: 'Chiaro', dark: 'Scuro', system: 'Sistema' }
const OPTIONS: { value: ThemePreference; Icon: typeof Sun }[] = [
  { value: 'light', Icon: Sun },
  { value: 'dark', Icon: Moon },
  { value: 'system', Icon: Monitor },
]

// Same inline segmented-control idiom as LanguageToggle -- a radiogroup of
// icon buttons in .lang-toggle, not a popover -- so it sits in Settings'
// Account section the same way Lingua/Notifiche do.
export function ThemeToggle() {
  const [theme, setThemeState] = useState<ThemePreference>(readStoredThemePreference)

  useEffect(() => subscribeThemeChange(setThemeState), [])

  return (
    <div className="lang-toggle" role="radiogroup" aria-label="Tema">
      {OPTIONS.map(({ value, Icon }) => (
        <button
          key={value}
          type="button"
          role="radio"
          aria-checked={value === theme}
          aria-label={LABELS[value]}
          title={LABELS[value]}
          className={`lang-toggle-option${value === theme ? ' current' : ''}`}
          onClick={() => setThemePreference(value)}
        >
          <Icon size={16} />
        </button>
      ))}
    </div>
  )
}
