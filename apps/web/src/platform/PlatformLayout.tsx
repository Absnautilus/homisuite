import { useEffect, useState } from 'react'
import { Link, NavLink, Outlet } from 'react-router-dom'
import { Boxes, History, LogOut, Moon, ScrollText, ShieldAlert, Sun } from 'lucide-react'
import { PageState } from '../components/PageState'
import { LoginScreen } from '../components/LoginScreen'
import { supabase } from '../core/client'
import { readStoredThemePreference, resolveTheme, setThemePreference, subscribeThemeChange } from '../lib/theme'
import { usePlatformContext } from './PlatformContext'
import { PlatformMfaGate } from './PlatformMfaGate'

// Independent of ShellLayout on purpose (see App.tsx's own routing comment):
// this never mounts ModuleRuntimeContext's gating logic, never shows the
// hotel shell's "Nessuna struttura accessibile" dead end, and a Platform
// Admin with zero memberships reaches exactly this chrome, nothing else.
export function PlatformLayout() {
  const runtime = usePlatformContext()
  // Platform Admin console is its own small chrome, deliberately independent
  // of ShellLayout/AccountMenu (see this file's own top comment) -- so it
  // never inherited the hotel shell's quick theme toggle, leaving an admin
  // stuck on whatever theme the browser's OS preference happened to resolve
  // to. Same resolved-theme-tracking pattern as AccountMenu's own toggle.
  const [resolvedTheme, setResolvedTheme] = useState(() => resolveTheme(readStoredThemePreference()))
  useEffect(() => subscribeThemeChange(() => setResolvedTheme(resolveTheme(readStoredThemePreference()))), [])
  function toggleTheme() {
    setThemePreference(resolvedTheme === 'dark' ? 'light' : 'dark')
  }

  if (runtime.status === 'loading') {
    return <PageState kind="loading" title="Caricamento console Platform Admin…" variant="fullscreen" />
  }
  if (runtime.status === 'signed-out') return <LoginScreen />
  if (runtime.status === 'not-admin') {
    return (
      <main className="platform-mfa-gate">
        <PageState
          kind="unavailable"
          title="Accesso non autorizzato."
          description="Il tuo account non è un'identità Platform Admin."
          variant="fullscreen"
        />
      </main>
    )
  }
  if (runtime.status === 'suspended') {
    return (
      <main className="platform-mfa-gate">
        <PageState
          kind="unavailable"
          icon={ShieldAlert}
          title="Accesso Platform Admin sospeso."
          description="Contatta un altro amministratore della piattaforma per riattivarlo."
          variant="fullscreen"
        />
      </main>
    )
  }
  if (runtime.status === 'mfa-required') return <PlatformMfaGate />
  if (runtime.status === 'error') {
    return (
      <main className="platform-mfa-gate">
        <PageState
          kind="error"
          title="Impossibile caricare la console."
          action={{ label: 'Riprova', onClick: () => void runtime.refresh() }}
          variant="fullscreen"
        />
      </main>
    )
  }

  return (
    <div className="platform-shell">
      <aside className="platform-sidebar">
        <Link className="platform-sidebar-brand" to="/admin" aria-label="Torna a Organizzazioni">
          <img className="platform-sidebar-mark" src="/icon-192.png" alt="" width={24} height={24} />
          <span>Homisuite<small>Platform Admin</small></span>
        </Link>
        <nav className="platform-sidebar-nav">
          <NavLink className={({ isActive }) => `platform-nav-item${isActive ? ' active' : ''}`} to="/admin" end>
            <Boxes size={17} /><span>Organizzazioni</span>
          </NavLink>
          {runtime.hasPlatformPermission('platform.audit.read') ? (
            <NavLink className={({ isActive }) => `platform-nav-item${isActive ? ' active' : ''}`} to="/admin/audit">
              <ScrollText size={17} /><span>Registro attività</span>
            </NavLink>
          ) : null}
          {runtime.hasPlatformPermission('platform.audit.read') ? (
            <NavLink className={({ isActive }) => `platform-nav-item${isActive ? ' active' : ''}`} to="/admin/sessions">
              <History size={17} /><span>Sessioni operative</span>
            </NavLink>
          ) : null}
        </nav>
        <button
          className="platform-sidebar-theme-toggle"
          type="button"
          aria-label={resolvedTheme === 'dark' ? 'Passa al tema chiaro' : 'Passa al tema scuro'}
          title={resolvedTheme === 'dark' ? 'Passa al tema chiaro' : 'Passa al tema scuro'}
          onClick={toggleTheme}
        >
          {resolvedTheme === 'dark' ? <Sun size={16} /> : <Moon size={16} />}
          <span>{resolvedTheme === 'dark' ? 'Tema chiaro' : 'Tema scuro'}</span>
        </button>
        <button className="platform-sidebar-logout" type="button" onClick={() => void supabase.auth.signOut()}>
          <LogOut size={16} /><span>Esci</span>
        </button>
      </aside>
      <div className="platform-content">
        <Outlet />
      </div>
    </div>
  )
}
