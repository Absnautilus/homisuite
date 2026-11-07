import { useEffect, useLayoutEffect, useState, type CSSProperties } from 'react'
import { X } from 'lucide-react'
import { Button } from '@homisuite/ui'

export interface TourStep {
  // A CSS selector for a real element already on the page (via a
  // data-tour attribute added at the source, not a guessed class name) --
  // never a synthetic mock-up of the UI. Steps whose target isn't present
  // right now (a different page, hidden by a responsive breakpoint, an
  // element a permission gate didn't render) are skipped rather than
  // spotlighting nothing, so the same step list stays safe to run from
  // wherever it's launched.
  target: string
  title: string
  body: string
}

const CARD_WIDTH = 320
const SPOTLIGHT_PAD = 8

export function TourOverlay({ steps, onFinish }: { steps: TourStep[]; onFinish: () => void }) {
  const [index, setIndex] = useState(0)
  const [rect, setRect] = useState<DOMRect | null>(null)
  const [placeAbove, setPlaceAbove] = useState(false)

  const step = steps[index]
  const isLast = index >= steps.length - 1

  function next() {
    if (isLast) onFinish()
    else setIndex((value) => value + 1)
  }
  function back() {
    setIndex((value) => Math.max(0, value - 1))
  }

  // A step's target can be absent for reasons that are all legitimate (a
  // different page than where the tour started, a sidebar hidden under the
  // mobile breakpoint, an element a permission gate didn't render) -- in
  // every case the right move is to move straight past it, not stall or
  // spotlight an empty corner of the screen.
  useEffect(() => {
    if (!step) {
      onFinish()
      return
    }
    const element = document.querySelector(step.target)
    const visible = element && element.getBoundingClientRect().width > 0
    if (!visible) {
      if (index < steps.length - 1) setIndex((value) => value + 1)
      else onFinish()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index, step])

  useLayoutEffect(() => {
    if (!step) return
    const element = document.querySelector(step.target)
    if (!element) return
    element.scrollIntoView({ block: 'center', behavior: 'smooth' })

    function update() {
      const nextRect = element!.getBoundingClientRect()
      setRect(nextRect)
      setPlaceAbove(window.innerHeight - nextRect.bottom < 200 && nextRect.top > 200)
    }
    update()
    // Scrolling into view is smooth (animated), so the first measurement is
    // taken mid-scroll -- one re-measure once it's had time to settle.
    const settleTimer = window.setTimeout(update, 340)
    window.addEventListener('resize', update)
    window.addEventListener('scroll', update, true)
    return () => {
      window.clearTimeout(settleTimer)
      window.removeEventListener('resize', update)
      window.removeEventListener('scroll', update, true)
    }
  }, [index, step])

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') onFinish()
      else if (event.key === 'ArrowRight') next()
      else if (event.key === 'ArrowLeft') back()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index])

  useEffect(() => {
    document.body.classList.add('ui-modal-open')
    return () => document.body.classList.remove('ui-modal-open')
  }, [])

  if (!step || !rect) return null

  const spotlightStyle: CSSProperties = {
    top: rect.top - SPOTLIGHT_PAD,
    left: rect.left - SPOTLIGHT_PAD,
    width: rect.width + SPOTLIGHT_PAD * 2,
    height: rect.height + SPOTLIGHT_PAD * 2,
  }
  const cardLeft = Math.min(Math.max(rect.left, 16), window.innerWidth - CARD_WIDTH - 16)
  const cardStyle: CSSProperties = placeAbove
    ? { left: cardLeft, bottom: window.innerHeight - rect.top + SPOTLIGHT_PAD + 12 }
    : { left: cardLeft, top: rect.bottom + SPOTLIGHT_PAD + 12 }

  return (
    <div className="tour-root">
      <div className="tour-dim" onClick={next} aria-hidden="true" />
      <div className="tour-spotlight" style={spotlightStyle} aria-hidden="true" />
      <div className="tour-card" style={cardStyle} role="dialog" aria-modal="true" aria-label={step.title}>
        <button type="button" className="tour-close" aria-label="Salta il tour" onClick={onFinish}><X size={15} /></button>
        <span className="tour-step-count">Passo {index + 1} di {steps.length}</span>
        <h3>{step.title}</h3>
        <p>{step.body}</p>
        <div className="tour-actions">
          <div className="help-dots">
            {steps.map((item, itemIndex) => (
              <button
                key={item.target}
                type="button"
                aria-label={`Vai al passo ${itemIndex + 1}`}
                className={`help-dot${itemIndex === index ? ' is-active' : ''}`}
                onClick={() => setIndex(itemIndex)}
              />
            ))}
          </div>
          <div className="tour-nav-buttons">
            {index > 0 ? <Button variant="secondary" onClick={back}>Indietro</Button> : null}
            <Button variant="primary" onClick={next}>{isLast ? 'Fine' : 'Avanti'}</Button>
          </div>
        </div>
      </div>
    </div>
  )
}
