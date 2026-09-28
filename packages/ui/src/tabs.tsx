import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import './tabs.css'

export interface TabItem {
  value: string
  label: ReactNode
  /** Optional leading icon. Module navigation should use this consistently. */
  icon?: ReactNode
  /** Optional attention marker for unseen/new content in this destination. */
  attention?: boolean
}

export interface TabsProps {
  items: TabItem[]
  value: string
  onValueChange: (value: string) => void
  className?: string
  /**
   * 'accent' (default) fills the active pill with the brand accent color --
   * for a page's own primary section switcher (e.g. Turni's Operativo/
   * Impostazioni). 'surface' fills it with the page background instead, a
   * quieter look for a switcher that sits above/alongside other primary
   * chrome (e.g. a module-wide nav bar).
   */
  variant?: 'accent' | 'surface'
  /**
   * When true, the active tab scrolls into view (centered) inside its
   * nearest scrollable ancestor whenever it changes -- for a switcher whose
   * own container can overflow (e.g. many section tabs on a narrow
   * viewport). The consumer owns the scrollable ancestor (typically via its
   * own `overflow-x: auto` on the element `className` targets).
   */
  scrollIntoView?: boolean
  'aria-label'?: string
}

// A segmented control with a sliding pill behind the active tab -- measured
// from the real button, not a fixed width, so labels of any length work.
// `ready` withholds the indicator until its first real measurement lands,
// so it never flashes at the wrong position/width on mount.
export function Tabs({ items, value, onValueChange, className, variant = 'accent', scrollIntoView = false, ...aria }: TabsProps) {
  const listRef = useRef<HTMLDivElement>(null)
  const buttonRefs = useRef(new Map<string, HTMLButtonElement>())
  const [rect, setRect] = useState<{ left: number; width: number } | null>(null)

  function measure() {
    const list = listRef.current
    const active = buttonRefs.current.get(value)
    if (!list || !active) return
    setRect({ left: active.offsetLeft, width: active.offsetWidth })
    if (scrollIntoView) active.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' })
  }

  useLayoutEffect(measure, [value, items, scrollIntoView])

  useEffect(() => {
    window.addEventListener('resize', measure)
    return () => window.removeEventListener('resize', measure)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div ref={listRef} role="tablist" className={['ui-tabs', variant === 'surface' && 'ui-tabs--surface', className].filter(Boolean).join(' ')} {...aria}>
      <span
        aria-hidden="true"
        className="ui-tabs-indicator"
        data-ready={rect ? 'true' : 'false'}
        style={rect ? { transform: `translateX(${rect.left}px)`, width: `${rect.width}px` } : undefined}
      />
      {items.map((item) => (
        <button
          key={item.value}
          ref={(el) => {
            if (el) buttonRefs.current.set(item.value, el)
            else buttonRefs.current.delete(item.value)
          }}
          type="button"
          role="tab"
          aria-selected={item.value === value}
          className="ui-tab"
          onClick={() => onValueChange(item.value)}
        >
          {item.icon ? <span className="ui-tab-icon" aria-hidden="true">{item.icon}</span> : null}
          <span className="ui-tab-label">{item.label}</span>
          {item.attention ? <span className="ui-tab-attention" aria-label="Nuovi elementi" /> : null}
        </button>
      ))}
    </div>
  )
}
