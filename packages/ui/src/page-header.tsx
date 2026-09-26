import type { ReactNode } from 'react'
import './page-header.css'

export interface PageHeaderProps {
  /** Structure/property name shown above the title, e.g. "Palazzo Veneziano". */
  eyebrow?: string
  title: string
  description?: string
  /** Right-aligned controls (a primary action button, a scenario switcher...). */
  actions?: ReactNode
  className?: string
}

/**
 * The one page-header grammar every module should build on: eyebrow, title,
 * description, with an optional right-aligned actions slot that stacks below
 * on narrow screens instead of squeezing onto one line. Reproduces Turni's
 * own header exactly, established as the suite-wide reference.
 */
export function PageHeader({ eyebrow, title, description, actions, className }: PageHeaderProps) {
  return (
    <header className={['ui-page-header', className].filter(Boolean).join(' ')}>
      <div>
        {eyebrow ? <p className="ui-page-header-eyebrow">{eyebrow}</p> : null}
        <h1>{title}</h1>
        {description ? <p className="ui-page-header-description">{description}</p> : null}
      </div>
      {actions ? <div className="ui-page-header-actions">{actions}</div> : null}
    </header>
  )
}
