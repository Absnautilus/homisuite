import type { ReactNode } from 'react'
import './bottom-action-bar.css'

export interface BottomActionBarProps {
  children: ReactNode
  className?: string
}

/**
 * A mobile-only fixed bar pinned to the bottom of the screen (hidden above
 * 640px). Unlike the shell's own bottom nav, this is opt-in per page: a page
 * renders it only when it has something genuinely worth keeping within
 * thumb's reach while the rest of the screen scrolls (a persistent primary
 * action, a period switcher) -- there's no fixed schema for what goes inside.
 */
export function BottomActionBar({ children, className }: BottomActionBarProps) {
  return <div className={['ui-bottom-action-bar', className].filter(Boolean).join(' ')}>{children}</div>
}
