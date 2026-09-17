import { useEffect, useRef, useState, type ReactNode } from 'react'
import './slide-panel.css'

const EXIT_DURATION_MS = 320

interface Pane {
  key: string
  node: ReactNode
}

export interface SlidePanelProps {
  /** Identifies which pane is showing -- e.g. the active tab/route's own key. */
  activeKey: string
  /**
   * Left-to-right order of every key this panel can show. Comparing
   * activeKey's position in this list against the previous key's position
   * is what decides which way the pane slides -- moving to a later key
   * slides forward (new content in from the right), an earlier key slides
   * backward (in from the left), same as paging forward/back through a
   * peer set of screens rather than a generic cross-fade.
   */
  order: string[]
  children: ReactNode
  className?: string
}

// Lateral, no-fade transition for swapping one tab/route's content for
// another: the outgoing and incoming panes slide in unison, in the same
// direction and on the same timing, like two frames of a filmstrip rather
// than independently-fading layers -- the same "peer screens, paged
// forward/back" motion a swipeable stack would use, so the same
// activeKey/order model can grow a real drag gesture later without
// changing this component's contract.
export function SlidePanel({ activeKey, order, children, className }: SlidePanelProps) {
  const [current, setCurrent] = useState<Pane>({ key: activeKey, node: children })
  const [outgoing, setOutgoing] = useState<Pane | null>(null)
  const [direction, setDirection] = useState<1 | -1>(1)
  const indexRef = useRef(order.indexOf(activeKey))

  useEffect(() => {
    if (activeKey === current.key) return
    const nextIndex = order.indexOf(activeKey)
    setDirection(nextIndex >= indexRef.current ? 1 : -1)
    indexRef.current = nextIndex
    setOutgoing(current)
    setCurrent({ key: activeKey, node: children })
    const id = window.setTimeout(() => setOutgoing(null), EXIT_DURATION_MS)
    return () => window.clearTimeout(id)
    // Only the key transition itself should trigger a slide; a content
    // update for the *same* key (e.g. the active page re-rendering with
    // fresh data) must not restart the animation.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeKey])

  // Keep the visible pane's content current even between transitions.
  useEffect(() => {
    if (activeKey === current.key) setCurrent((pane) => (pane.node === children ? pane : { ...pane, node: children }))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [children])

  return (
    <div className={['ui-slide-viewport', className].filter(Boolean).join(' ')}>
      {outgoing && (
        <div key={outgoing.key} className="ui-slide-pane ui-slide-pane-exit" data-direction={direction}>
          {outgoing.node}
        </div>
      )}
      <div key={current.key} className="ui-slide-pane ui-slide-pane-enter" data-direction={direction}>
        {current.node}
      </div>
    </div>
  )
}
