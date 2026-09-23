import { useEffect, useRef, useState } from 'react'
import { dropdownTransitionClassName, useDropdownTransition } from '@homisuite/ui'
import { ChevronDown, Languages, LogOut, UserRound } from 'lucide-react'
import { Link } from 'react-router-dom'
import { supabase } from '../core/client'
import { LanguageToggle } from './LanguageToggle'
import { releaseCurrentPushSubscription } from '../core/pushLifecycle'

export function AccountMenu({ name }: { name: string }) {
  const [open, setOpen] = useState(false)
  const { state, mounted } = useDropdownTransition(open)
  const rootRef = useRef<HTMLDivElement>(null)
  const initials = name.trim().split(/\s+/).map((part) => part[0]).slice(0, 2).join('').toUpperCase() || 'HF'

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
      <button
        className="account-trigger"
        type="button"
        aria-label={`Menu account di ${name}`}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <span className="account-avatar">{initials}</span>
        <span className="account-name">{name}</span>
        <ChevronDown size={15} />
      </button>
      {mounted && (
        <div className={dropdownTransitionClassName(state, 'account-popover')} data-origin="bottom-right" role="menu">
          <div className="account-popover-head">
            <span className="account-avatar large">{initials}</span>
            <div><strong>{name}</strong><small>Account Homisuite</small></div>
          </div>
          <Link className="account-menu-row" to="/settings#account" onClick={() => setOpen(false)}><UserRound size={16} /><span>Profilo</span></Link>
          <div className="account-language-row">
            <span><Languages size={16} /> Lingua</span>
            <LanguageToggle />
          </div>
        </div>
      )}
      {/* Always visible, not tucked inside the popover above: signing out is
          common enough on a shared front-desk device to deserve its own
          permanent affordance, not a click to reveal it first. */}
      <button className="account-logout" type="button" onClick={() => void (async () => { await releaseCurrentPushSubscription(); await supabase.auth.signOut() })()}>
        <LogOut size={16} /><span>Esci</span>
      </button>
    </div>
  )
}
