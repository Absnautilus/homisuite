import { useEffect, useRef, useState } from 'react'
import { dropdownTransitionClassName, useDropdownTransition } from '@homisuite/ui'
import { ChevronDown, LayoutDashboard, Languages, LogOut, Moon, Sun, UserRound } from 'lucide-react'
import { Link } from 'react-router-dom'
import { supabase } from '../core/client'
import { readStoredThemePreference, resolveTheme, setThemePreference, subscribeThemeChange } from '../lib/theme'
import { usePlatformAdminSelf } from '../platform/usePlatformAdminSelf'
import { LanguageToggle } from './LanguageToggle'

// The resting row shows "Matteo V." rather than the full name -- initial
// of the word right after the first name (not necessarily the last word:
// a compound surname like "Visonà dalla Costa" would otherwise shorten to
// "Costa"'s initial, losing the part that actually identifies the person
// day to day). The full name still shows in the popover head below.
function shortName(fullName: string): string {
  const parts = fullName.trim().split(/\s+/).filter(Boolean)
  if (parts.length <= 1) return parts[0] ?? ''
  const initial = parts[1]!
  return `${parts[0]} ${initial[0]!.toUpperCase()}.`
}

export function AccountMenu({ name }: { name: string }) {
  const [open, setOpen] = useState(false)
  const { state, mounted } = useDropdownTransition(open)
  const rootRef = useRef<HTMLDivElement>(null)
  const initials = name.trim().split(/\s+/).map((part) => part[0]).slice(0, 2).join('').toUpperCase() || 'HF'
  // Only ever true for an account that also holds a Platform Admin identity
  // (e.g. this same account also has an ordinary membership at a demo
  // property) -- gives them a way back to /admin from inside the regular
  // shell, which otherwise has no link to it anywhere (by design: the two
  // are deliberately separate surfaces -- see PlatformContext.tsx). Without
  // this, leaving "Visualizza come"/closing an operational session and
  // landing back in an ordinary membership's own shell was a dead end.
  const { isAdmin } = usePlatformAdminSelf()
  // Tracks the *resolved* light/dark theme, not the raw preference (which
  // can be 'system') -- this is a binary quick-toggle, not the 3-way
  // Light/Dark/System radiogroup that lives in Settings (ThemeToggle).
  const [resolvedTheme, setResolvedTheme] = useState(() => resolveTheme(readStoredThemePreference()))

  useEffect(() => subscribeThemeChange(() => setResolvedTheme(resolveTheme(readStoredThemePreference()))), [])

  function toggleTheme() {
    setThemePreference(resolvedTheme === 'dark' ? 'light' : 'dark')
  }

  useEffect(() => {
    function onPointerDown(event: MouseEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false)
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('mousedown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [])

  return (
    <div className="account-menu" ref={rootRef}>
      <div className="account-row">
        <button
          className="account-trigger"
          type="button"
          aria-label={`Menu account di ${name}`}
          aria-haspopup="menu"
          aria-expanded={open}
          onClick={() => setOpen((value) => !value)}
        >
          <span className="account-avatar">{initials}</span>
          <span className="account-name">{shortName(name)}</span>
          <ChevronDown size={15} />
        </button>
        {/* A separate button, deliberately outside account-trigger -- the
            popover opens only from the name/avatar/chevron side of the row;
            this one always just flips light/dark immediately, in place,
            the same single click either way. The icon shown is the
            *destination* theme, not the current one (Moon while light is
            active means "switch to dark"), matching common dark-mode
            toggle conventions. Full Light/Dark/System control stays in
            Settings' ThemeToggle for anyone who wants that level of
            control. */}
        <button
          className="account-theme-icon"
          type="button"
          aria-label={resolvedTheme === 'dark' ? 'Passa al tema chiaro' : 'Passa al tema scuro'}
          title={resolvedTheme === 'dark' ? 'Passa al tema chiaro' : 'Passa al tema scuro'}
          onClick={toggleTheme}
        >
          {resolvedTheme === 'dark' ? <Sun size={15} /> : <Moon size={15} />}
        </button>
      </div>
      {mounted && (
        <div className={dropdownTransitionClassName(state, 'account-popover')} data-origin="bottom-right" role="menu">
          <div className="account-popover-head">
            <span className="account-avatar large">{initials}</span>
            <div><strong>{name}</strong><small>Account Homisuite</small></div>
          </div>
          <Link className="account-menu-row" to="/settings#account" onClick={() => setOpen(false)}><UserRound size={16} /><span>Profilo</span></Link>
          {isAdmin && (
            <Link className="account-menu-row" to="/admin" onClick={() => setOpen(false)}><LayoutDashboard size={16} /><span>Console Admin Master</span></Link>
          )}
          <div className="account-language-row">
            <span><Languages size={16} /> Lingua</span>
            <LanguageToggle />
          </div>
          <button className="account-menu-row account-menu-row-logout" type="button" onClick={() => void supabase.auth.signOut()}>
            <LogOut size={16} /><span>Esci</span>
          </button>
        </div>
      )}
    </div>
  )
}
