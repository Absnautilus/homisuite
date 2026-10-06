import { useEffect, useId, useRef, type PropsWithChildren, type ReactNode } from 'react'
import { X } from 'lucide-react'

// A right-anchored panel for content that's read alongside the list behind
// it (a booking's full detail, a restaurant's management tabs) rather than
// a focused yes/no decision -- Modal's centered, backdrop-blocking dialog is
// right for the latter (every other dining form already uses it) but wrong
// for "glance at this while the queue is still visible", which is what the
// approved prototype's detail/management panels are for. Mirrors Modal's
// own focus-trap/Escape/scroll-lock behavior so the two don't feel like
// different components to a keyboard or screen-reader user.
export interface SlideOverProps extends PropsWithChildren {
  open: boolean
  title: string
  description?: string
  onClose: () => void
  footer?: ReactNode
  wide?: boolean
}

export function SlideOver({ open, title, description, onClose, footer, wide, children }: SlideOverProps) {
  const closeButtonRef = useRef<HTMLButtonElement>(null)
  const panelRef = useRef<HTMLElement>(null)
  const onCloseRef = useRef(onClose)
  const titleId = useId()

  useEffect(() => { onCloseRef.current = onClose }, [onClose])

  useEffect(() => {
    if (!open) return
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null
    closeButtonRef.current?.focus()
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        event.preventDefault()
        onCloseRef.current()
        return
      }
      if (event.key !== 'Tab' || !panelRef.current) return
      const focusable = Array.from(
        panelRef.current.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ),
      )
      if (focusable.length === 0) return
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      if (!first || !last) return
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }
    document.body.classList.add('ui-modal-open')
    window.addEventListener('keydown', onKeyDown)
    return () => {
      document.body.classList.remove('ui-modal-open')
      window.removeEventListener('keydown', onKeyDown)
      previousFocus?.focus()
    }
  }, [open])

  if (!open) return null
  return (
    <div className="dining-slideover-scrim" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
      <section
        ref={panelRef}
        className={`dining-slideover-panel${wide ? ' is-wide' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
      >
        <header className="dining-slideover-head">
          <div><h2 id={titleId}>{title}</h2>{description ? <p>{description}</p> : null}</div>
          <button ref={closeButtonRef} className="dining-slideover-close" type="button" onClick={onClose} aria-label="Chiudi"><X size={18} /></button>
        </header>
        <div className="dining-slideover-body">{children}</div>
        {footer ? <footer className="dining-slideover-foot">{footer}</footer> : null}
      </section>
    </div>
  )
}
