import type { ReactNode } from 'react'
import { useDropdownTransition } from './dropdown-transition'
import './toast.css'

export interface ToastProps {
  open: boolean
  children: ReactNode
  closeDurationMs?: number
  className?: string
}

// A brief, self-contained confirmation -- no provider, no queue. The
// consumer owns its own `open` boolean (typically flipped back after a
// timeout) and this just handles the enter/exit animation, same lifecycle
// as useDropdownTransition's other consumers.
export function Toast({ open, children, closeDurationMs = 200, className }: ToastProps) {
  const { state, mounted } = useDropdownTransition(open, closeDurationMs)
  if (!mounted) return null
  return (
    <div className={['ui-toast', state === 'open' && 'is-open', className].filter(Boolean).join(' ')} role="status" aria-live="polite">
      {children}
    </div>
  )
}
