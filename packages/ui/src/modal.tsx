import { useEffect, useId, useLayoutEffect, useRef, type PropsWithChildren, type ReactNode, type RefObject } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'
import './modal.css'

export type ModalProps = PropsWithChildren<{
  open: boolean
  title: string
  description?: string
  footer?: ReactNode
  onClose: () => void
  /**
   * false disables the backdrop-click/Escape shortcuts, leaving only the
   * explicit close button and footer actions -- for a form where losing
   * whatever was typed to one stray click or key press is a real cost
   * (e.g. a multi-field create/edit form), not just a minor inconvenience.
   * Defaults to true (the original behaviour) so every existing caller is
   * unaffected.
   */
  dismissible?: boolean
  /**
   * The element the panel should visually grow out of on open (typically
   * the button that triggered it), read once when the panel mounts. Skipped
   * for viewers who prefer reduced motion, and simply ignored if the ref
   * isn't attached to anything -- so passing it is always safe.
   */
  originRef?: RefObject<HTMLElement | null>
}>

export function Modal({ open, title, description, footer, onClose, dismissible = true, originRef, children }: ModalProps) {
  const closeButtonRef = useRef<HTMLButtonElement>(null)
  const panelRef = useRef<HTMLElement>(null)
  const onCloseRef = useRef(onClose)
  const titleId = useId()

  useEffect(() => { onCloseRef.current = onClose }, [onClose])

  // Alt-tabbing back to this window, or clicking the browser window after
  // switching away from it, lands that refocusing click wherever the cursor
  // already is -- usually this backdrop, since it covers the whole viewport
  // outside the panel. Without this guard that stray click reads as "click
  // outside to dismiss" and closes the modal on nothing the person actually
  // meant to interact with. The window briefly after a refocus is the only
  // one this suppresses; a deliberate backdrop click a moment later still
  // closes normally.
  const justRefocusedRef = useRef(false)
  useEffect(() => {
    if (!open) return
    let timer: ReturnType<typeof setTimeout> | undefined
    function onWindowFocus() {
      justRefocusedRef.current = true
      clearTimeout(timer)
      timer = setTimeout(() => { justRefocusedRef.current = false }, 250)
    }
    window.addEventListener('focus', onWindowFocus)
    return () => {
      window.removeEventListener('focus', onWindowFocus)
      clearTimeout(timer)
    }
  }, [open])

  // The morph: grow the panel from the trigger's on-screen rect to its own
  // final rect via the Web Animations API, rather than a fixed fade/slide --
  // this is what makes the modal read as opening "from" the button someone
  // clicked instead of appearing out of nowhere. Skipped below the mobile
  // breakpoint, where the panel becomes a full-height edge drawer: scaling
  // up from a small trigger to a 100%-tall panel reads as broken rather than
  // a morph, so the CSS slide-in keyframe runs instead -- always contained
  // within the viewport by construction.
  useLayoutEffect(() => {
    if (!open) return
    const panel = panelRef.current
    const origin = originRef?.current
    if (!panel || !origin) return
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    if (window.matchMedia('(max-width: 760px)').matches) return
    const from = origin.getBoundingClientRect()
    const to = panel.getBoundingClientRect()
    if (to.width === 0 || to.height === 0 || from.width === 0 || from.height === 0) return
    const scaleX = from.width / to.width
    const scaleY = from.height / to.height
    const deltaX = from.left + from.width / 2 - (to.left + to.width / 2)
    const deltaY = from.top + from.height / 2 - (to.top + to.height / 2)
    // Suppress the CSS entrance keyframes (scale-fade / mobile drawer-slide)
    // so they don't fight this transform on the same element.
    panel.style.animation = 'none'
    const animation = panel.animate(
      [
        { transform: `translate(${deltaX}px, ${deltaY}px) scale(${scaleX}, ${scaleY})`, opacity: 0.4 },
        { transform: 'translate(0, 0) scale(1, 1)', opacity: 1 },
      ],
      { duration: 260, easing: 'cubic-bezier(.2, .8, .2, 1)' },
    )
    return () => animation.cancel()
  }, [open, originRef])

  useEffect(() => {
    if (!open) return
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null
    closeButtonRef.current?.focus()
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        event.preventDefault()
        if (dismissible) onCloseRef.current()
        return
      }
      if (event.key !== 'Tab' || !panelRef.current) return
      const focusable = Array.from(
        panelRef.current.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ),
      )
      if (focusable.length === 0) {
        event.preventDefault()
        panelRef.current.focus()
        return
      }
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
  }, [open, dismissible])

  if (!open) return null
  // Portaled to <body> -- rendered in place, this sat inside whatever
  // ancestor the caller happened to nest it under, and a CSS `animation`
  // on .page-content (the page-content-fade-in every routed page gets)
  // creates its own stacking context there: this backdrop's own z-index
  // then only ranks among *that* context's contents, not the whole page,
  // letting the shell's own floating "?" help button (a sibling of
  // .page-content, not a descendant) end up drawn on top of it regardless
  // of either one's z-index number.
  return createPortal(
    <div
      className="ui-modal-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (justRefocusedRef.current) {
          justRefocusedRef.current = false
          return
        }
        if (dismissible && event.target === event.currentTarget) onClose()
      }}
    >
      <section ref={panelRef} className="ui-modal-panel" role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1}>
        <header className="ui-modal-header">
          <div><h2 id={titleId}>{title}</h2>{description ? <p>{description}</p> : null}</div>
          <button ref={closeButtonRef} className="ui-modal-icon-button" type="button" onClick={onClose} aria-label="Chiudi"><X size={18} /></button>
        </header>
        <div className="ui-modal-body">{children}</div>
        {footer ? <footer className="ui-modal-footer">{footer}</footer> : null}
      </section>
    </div>,
    document.body,
  )
}
