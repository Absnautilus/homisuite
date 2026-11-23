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
          // Mobile only (same breakpoint as the shell's own sidebar <->
          // mobile-header switch, apps/web's styles.css): on a desktop-sized
          // screen reception is already looking at the live queue list, so
          // a floating card on top of it is a reminder nobody asked for --
          // the queue list (and the sound) are enough there. On a phone the
          // list usually isn't on screen, so the card is the only heads-up.
          <div key={toast.id} role="status" className="hidden max-[920px]:block rounded-xl border border-line bg-surface p-3 text-sm text-foreground shadow-md">
            <p className="pr-1 font-semibold text-foreground">{toast.card.title}</p>
            {/* Unlike request-row.tsx's own muted-until-hover icons, both
                actions here get a visible-at-rest treatment (filled/active):
                a floating card has no row content to anchor it and no
                reliable hover (most of this app's use is touch), so a
                muted-grey icon on a plain white card reads as blank. */}
            <div className="mt-2 flex justify-end gap-2">
              {toast.card.onReject && (
                <IconButton
                  tone="hintCaution"
                  active
                  icon={X}
                  label={t('staff.row.reject')}
                  onClick={async () => {
                    // onReject confirms first and reports whether it actually
                    // went through -- a cancelled confirm leaves the card
                    // open rather than silently disappearing as if handled.
                    const rejected = await toast.card?.onReject?.()
                    if (rejected) onDismiss(toast.id)
                  }}
                />
              )}
              <IconButton
                tone="hintPositive"
                filled
                icon={Check}
                label={t('staff.row.claim')}
                onClick={async () => {
                  // Dismisses either way -- a lost race or a real failure
                  // both mean there's nothing left to act on from this
                  // toast; onAccept is responsible for its own message.
                  await toast.card?.onAccept()
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
