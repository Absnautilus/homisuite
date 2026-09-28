import type { ReactNode } from 'react'
import { Tabs, type TabItem } from './tabs'
import './module-nav.css'

export interface ModuleNavProps {
  propertyName: string
  moduleName: string
  items: TabItem[]
  value: string
  onValueChange: (value: string) => void
  ariaLabel: string
  actions?: ReactNode
  secondary?: {
    items: TabItem[]
    value: string
    onValueChange: (value: string) => void
    ariaLabel: string
    scrollIntoView?: boolean
  }
  className?: string
}

/**
 * Canonical navigation chrome inside a Homisuite module.
 * It deliberately does not own or style the Shell.
 *
 * Tier 1: module identity + icon-labelled primary navigation.
 * Tier 2: optional text-only sub-navigation immediately below.
 */
export function ModuleNav({ propertyName, moduleName, items, value, onValueChange, ariaLabel, actions, secondary, className }: ModuleNavProps) {
  return (
    <div className={['ui-module-nav', className].filter(Boolean).join(' ')}>
      <header className="ui-module-nav-card">
        <div className="ui-module-nav-topline">
          <div className="ui-module-nav-identity">
            <span>{propertyName}</span>
            <span className="ui-module-nav-sep">/</span>
            <h1>{moduleName}</h1>
          </div>
          {actions ? <div className="ui-module-nav-actions">{actions}</div> : null}
        </div>
        <Tabs items={items} value={value} onValueChange={onValueChange} variant="surface" className="ui-module-nav-primary" aria-label={ariaLabel} />
      </header>
      {secondary ? (
        <Tabs
          items={secondary.items}
          value={secondary.value}
          onValueChange={secondary.onValueChange}
          variant="surface"
          scrollIntoView={secondary.scrollIntoView}
          className="ui-module-nav-secondary"
          aria-label={secondary.ariaLabel}
        />
      ) : null}
    </div>
  )
}
