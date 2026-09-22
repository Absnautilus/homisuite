import { CircleAlert, Inbox, Loader2, Lock, type LucideIcon } from 'lucide-react'

export type PageStateKind = 'loading' | 'empty' | 'error' | 'unavailable'

const defaultIcon: Record<PageStateKind, LucideIcon> = {
  loading: Loader2,
  empty: Inbox,
  error: CircleAlert,
  unavailable: Lock,
}

const defaultRole: Partial<Record<PageStateKind, 'status' | 'alert'>> = {
  loading: 'status',
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
  const ResolvedIcon = Icon ?? defaultIcon[kind]
  return (
    <div className={`page-state ${kind}${variant === 'fullscreen' ? ' fullscreen' : ''}`} role={defaultRole[kind]}>
      <div className="page-state-icon">
        <ResolvedIcon size={19} aria-hidden="true" />
      </div>
      <p className="page-state-title">{title}</p>
      {description ? <p className="page-state-description">{description}</p> : null}
      {action ? (
        <button type="button" className="btn btn-secondary page-state-action" onClick={action.onClick}>
          {action.label}
        </button>
      ) : null}
    </div>
  )
}
