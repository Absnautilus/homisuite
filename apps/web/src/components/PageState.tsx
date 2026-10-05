import { CircleAlert, Inbox, Lock, type LucideIcon } from 'lucide-react'
import { Button } from '@homisuite/ui'

export type PageStateKind = 'loading' | 'empty' | 'error' | 'unavailable'

const defaultIcon: Record<Exclude<PageStateKind, 'loading'>, LucideIcon> = {
  empty: Inbox,
  error: CircleAlert,
  unavailable: Lock,
}

const defaultRole: Partial<Record<PageStateKind, 'status' | 'alert'>> = {
  error: 'alert',
}

// The one shared shape for "this page/section has nothing else to show
// right now" -- loading, empty, error, or unavailable/access-restricted.
// Deliberately plain: a small icon tile, a title, an optional one-line
// description and an optional primary action. No illustrations, no emoji,
// no full-viewport empty states outside `variant="fullscreen"`, which is
// reserved for states that render before the Shell chrome itself exists
// (see ShellLayout's own loading/error).
export function PageState({
  kind,
  title,
  description,
  action,
  icon: Icon,
  variant = 'inline',
}: {
  kind: PageStateKind
  title: string
  description?: string
  action?: { label: string; onClick: () => void }
  icon?: LucideIcon
  variant?: 'inline' | 'fullscreen'
}) {
  if (kind === 'loading') {
    // Fullscreen renders before there is any page chrome to hint at (the
    // Shell itself hasn't mounted yet), so a content-shaped skeleton would
    // have nothing real to resemble -- it keeps the thin top-edge bar
    // instead. Inline loading replaces an already-known page shape, so it
    // gets a skeleton of that shape (a header banner + a few content rows)
    // instead of a generic spinner, which reads as "this is what's coming"
    // rather than just "something is happening".
    if (variant === 'fullscreen') {
      return (
        <div className="page-state loading fullscreen" role="status">
          <span className="page-state-bar-track" aria-hidden="true"><span className="page-state-bar" /></span>
          <p className="page-state-title">{title}</p>
        </div>
      )
    }
    return (
      <div className="page-state loading" role="status">
        <div className="page-state-skeleton" aria-hidden="true">
          <div className="pss-banner">
            <span className="pss-chip" />
            <span className="pss-pill" />
          </div>
          {[1, 2, 3].map((row) => (
            <div className="pss-card" key={row}>
              <span className="pss-avatar" />
              <span className="pss-lines">
                <span className="pss-row" style={{ width: '62%' }} />
                <span className="pss-row" style={{ width: '38%' }} />
              </span>
            </div>
          ))}
        </div>
        {/* The skeleton already communicates "loading" visually; the title
            stays for screen readers (role="status" announces it) without
            also printing as a redundant caption underneath the shapes. */}
        <p className="page-state-title sr-only">{title}</p>
      </div>
    )
  }
  const ResolvedIcon = Icon ?? defaultIcon[kind]
  return (
    <div className={`page-state ${kind}${variant === 'fullscreen' ? ' fullscreen' : ''}`} role={defaultRole[kind]}>
      <div className="page-state-icon">
        <ResolvedIcon size={19} aria-hidden="true" />
      </div>
      <p className="page-state-title">{title}</p>
      {description ? <p className="page-state-description">{description}</p> : null}
      {action ? (
        <Button variant="secondary" className="page-state-action" onClick={action.onClick}>
          {action.label}
        </Button>
      ) : null}
    </div>
  )
}
