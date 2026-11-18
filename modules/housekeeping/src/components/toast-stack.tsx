import type { Toast } from '@/hooks/use-toasts'
import { createPortal } from 'react-dom'
import { AlertCircle, AlertTriangle, Bell, Check, X } from 'lucide-react'
import { IconButton } from '@/components/ui/icon-button'
import { useLocale } from '@/lib/i18n/locale-context'

export function ToastStack({ toasts, onDismiss }: { toasts: Toast[]; onDismiss: (id: string) => void }) {
  const { t } = useLocale()
  if (toasts.length === 0) return null
  // Portaled straight to <body>, not rendered in place: the shell's
  // .page-content wrapper animates opacity on mount (its fade-in), and any
  // animated/transformed ancestor creates its own CSS stacking context --
  // which traps this stack's z-50 inside it, below .help-fab's z-index:20
  // floating "?" (a sibling of .page-content, so outside that trap) even
  // though 50 > 20 on paper. Same fix HelpButton already uses for its
  // docked variant.
  return createPortal(
    <div className="fixed bottom-4 right-4 z-50 flex w-80 max-w-[calc(100vw-2rem)] flex-col gap-2">
      {toasts.map((toast) =>
        toast.card ? (
          <div key={toast.id} role="status" className="rounded-xl border border-line bg-surface p-3 text-sm text-foreground shadow-md">
            <div className="flex items-start justify-between gap-2">
              <p className="pr-1 font-semibold text-foreground">{toast.card.title}</p>
              {/* Closing this card neither claims nor rejects the request --
                  it just stops showing the notification here. Previously the
                  only two actions were Accetta/Rifiuta, both with a real
                  database effect, so there was no way to just dismiss it. */}
              <button
                type="button"
                aria-label={t('common.toast.dismiss')}
                onClick={() => onDismiss(toast.id)}
                className="flex h-6 w-6 shrink-0 cursor-pointer items-center justify-center rounded-lg border-0 bg-transparent text-muted transition-colors hover:text-accent"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
            <div className="mt-2 flex justify-end gap-2">
              {toast.card.onReject && (
                <IconButton
                  tone="hintCaution"
                  icon={X}
                  label={t('staff.row.reject')}
                  onClick={() => {
                    toast.card?.onReject?.()
                    onDismiss(toast.id)
                  }}
                />
              )}
              <IconButton
                tone="hintPositive"
                icon={Check}
                label={t('staff.row.claim')}
                onClick={() => {
                  toast.card?.onAccept()
                  onDismiss(toast.id)
                }}
              />
            </div>
          </div>
        ) : (
          <div
            key={toast.id}
            role="status"
            className="flex items-start gap-2.5 rounded-xl border border-line bg-surface py-2.5 pl-3.5 pr-2 text-sm text-foreground shadow-sm"
          >
            {toast.tone === 'warning' ? (
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-wait-ink" strokeWidth={2.1} />
            ) : toast.tone === 'success' ? (
              <Check className="mt-0.5 h-4 w-4 shrink-0 text-ok-ink" />
            ) : toast.tone === 'error' ? (
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-bad-ink" />
            ) : (
              <Bell className="mt-0.5 h-4 w-4 shrink-0 text-prog-ink" strokeWidth={2.1} />
            )}
            <span className="flex-1 py-0.5">{toast.message}</span>
            <button
              type="button"
              aria-label={t('common.toast.dismiss')}
              onClick={() => onDismiss(toast.id)}
              className="flex h-9 w-9 shrink-0 cursor-pointer items-center justify-center rounded-lg border-0 bg-transparent text-muted transition-colors hover:text-accent"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        ),
      )}
    </div>,
    document.body,
  )
}
