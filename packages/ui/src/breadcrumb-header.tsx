import type { ReactNode } from 'react'
import { Tabs, type TabItem } from './tabs'
import './breadcrumb-header.css'

export interface BreadcrumbHeaderProps {
  /** e.g. ["Palazzo Veneziano", "Turni"], rendered as "Palazzo Veneziano / Turni". */
  breadcrumb: string[]
  /** The page's own primary section switcher, shown inline with the breadcrumb. */
  switcher?: {
    items: TabItem[]
    value: string
    onValueChange: (value: string) => void
    'aria-label': string
  }
  /** Right-aligned controls that sit next to the breadcrumb (a scenario switcher, a view toggle...). */
  actions?: ReactNode
  className?: string
}

/**
 * The compact "Variazione D" module header: a breadcrumb trail and the page's
 * own primary switcher share one lavender banner row, instead of a full-size
 * PageHeader title. A page's secondary sections (if any) render as their own
 * bar right below this, using the same shared Tabs component.
 */
export function BreadcrumbHeader({ breadcrumb, switcher, actions, className }: BreadcrumbHeaderProps) {
  return (
    <header className={['ui-breadcrumb-header', className].filter(Boolean).join(' ')}>
      <div className="ui-breadcrumb-header-row">
        <nav className="ui-breadcrumb-header-trail" aria-label="Posizione">
          {breadcrumb.map((part, index) => {
            const isCurrent = index === breadcrumb.length - 1
            return (
              <span key={index}>
                {index > 0 ? <span className="ui-breadcrumb-header-sep">/</span> : null}
                {isCurrent ? <h1 className="ui-breadcrumb-header-current">{part}</h1> : part}
              </span>
            )
          })}
        </nav>
        {actions ? <div className="ui-breadcrumb-header-actions">{actions}</div> : null}
      </div>
      {switcher ? (
        <Tabs
          items={switcher.items}
          value={switcher.value}
          onValueChange={switcher.onValueChange}
          variant="surface"
          className="ui-breadcrumb-header-switcher"
          aria-label={switcher['aria-label']}
        />
      ) : null}
    </header>
  )
}
