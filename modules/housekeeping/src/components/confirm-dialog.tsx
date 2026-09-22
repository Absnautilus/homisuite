import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { useLocale } from '@/lib/i18n/locale-context'
import { getHkPortalTarget } from '@/lib/portal-target'

export interface ConfirmOptions {
  title: string
  description: string
  confirmLabel?: string
  tone?: 'danger' | 'neutral'
}

interface PendingConfirm extends ConfirmOptions {
  resolve: (value: boolean) => void
}

// Renders nothing until something calls the `confirm` function it returns —
// that function resolves to true/false once the person picks a button,
// so a destructive action can just `if (!(await confirm({...}))) return`.
export function useConfirm(): [ReactNode, (options: ConfirmOptions) => Promise<boolean>] {
  const { t } = useLocale()
  const [pending, setPending] = useState<PendingConfirm | null>(null)
  const titleId = useId()
  const descriptionId = useId()
  const cancelButtonRef = useRef<HTMLButtonElement>(null)

  function confirm(options: ConfirmOptions) {
    return new Promise<boolean>((resolve) => {
      setPending({ ...options, resolve })
    })
  }

  function settle(value: boolean) {
    pending?.resolve(value)
    setPending(null)
  }

  // Same baseline as the Shell's own Modal: focus moves into the dialog on
  // open and back to whatever triggered it on close, and Escape dismisses
  // like the backdrop click already does. Two buttons don't need a full
  // Tab-cycle trap the way a form-filled modal does.
  useEffect(() => {
    if (!pending) return
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null
    // Cancel gets initial focus, not Confirm: this dialog is most often
    // guarding a destructive action, so an accidental Enter keypress must
    // never land on it by default.
    cancelButtonRef.current?.focus()
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        event.preventDefault()
        settle(false)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      previousFocus?.focus()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pending])

  const dialog = pending && typeof document !== 'undefined'
    ? createPortal((
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-foreground/40 px-4" onClick={() => settle(false)}>
      <div
        className="w-full max-w-[340px] rounded-lg border border-line bg-surface p-7 text-center shadow-lg"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        onClick={(e) => e.stopPropagation()}
      >
        <div
          className={
            'mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full ' +
            (pending.tone === 'neutral' ? 'bg-accent-soft text-accent' : 'bg-bad-bg text-bad-ink')
          }
        >
          {pending.tone === 'neutral' ? (
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="9" />
              <path d="M12 16v-5M12 8h.01" />
            </svg>
          ) : (
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d="M4 7h16" />
              <path d="M6 7l1 13a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-13" />
              <path d="M9 7V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v3" />
            </svg>
          )}
        </div>
        <p id={titleId} className="font-head text-[0.9375rem] font-extrabold text-foreground">{pending.title}</p>
        <p id={descriptionId} className="mt-2 text-xs leading-relaxed text-muted">{pending.description}</p>
        <div className="mt-5 flex gap-2">
          <button
            ref={cancelButtonRef}
            type="button"
            onClick={() => settle(false)}
            className="h-8 flex-1 cursor-pointer rounded-sm border border-line-strong bg-surface px-3 text-xs font-bold text-foreground/70 hover:bg-surface-2"
          >
            {t('staff.confirm.cancel')}
          </button>
          <button
            type="button"
            onClick={() => settle(true)}
            className={
              'h-8 flex-1 cursor-pointer rounded-sm px-3 text-xs font-bold ' +
              (pending.tone === 'neutral' ? 'bg-accent text-accent-ink hover:brightness-[1.06]' : 'border border-bad-ink/25 bg-bad-bg text-bad-ink hover:bg-bad-ink/15')
            }
          >
            {pending.confirmLabel ?? t('staff.confirm.confirm')}
          </button>
        </div>
      </div>
    </div>
  ), getHkPortalTarget())
    : null

  return [dialog, confirm]
}
