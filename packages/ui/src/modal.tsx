import { useEffect, useId, useLayoutEffect, useRef, type PropsWithChildren, type ReactNode, type RefObject } from 'react'
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

  // The morph: grow the panel from the trigger's on-screen rect to its own
  // final rect via the Web Animations API, rather than a fixed fade/slide --
  // this is what makes the modal read as opening "from" the button someone
  // clicked instead of appearing out of nowhere.
  useLayoutEffect(() => {
    if (!open) return
    const panel = panelRef.current
    const origin = originRef?.current
    if (!panel || !origin) return
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
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
  return (
    <div className="ui-modal-backdrop" role="presentation" onMouseDown={(event) => { if (dismissible && event.target === event.currentTarget) onClose() }}>
      <section ref={panelRef} className="ui-modal-panel" role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1}>
        <header className="ui-modal-header">
          <div><h2 id={titleId}>{title}</h2>{description ? <p>{description}</p> : null}</div>
          <button ref={closeButtonRef} className="ui-modal-icon-button" type="button" onClick={onClose} aria-label="Chiudi"><X size={18} /></button>
        </header>
        <div className="ui-modal-body">{children}</div>
        {footer ? <footer className="ui-modal-footer">{footer}</footer> : null}
      </section>
    </div>
  )
}
