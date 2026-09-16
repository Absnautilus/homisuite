import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import './tabs.css'

export interface TabItem {
  value: string
  label: ReactNode
}

export interface TabsProps {
  items: TabItem[]
  value: string
  onValueChange: (value: string) => void
  className?: string
  'aria-label'?: string
}

// A segmented control with a sliding pill behind the active tab -- measured
// from the real button, not a fixed width, so labels of any length work.
// `ready` withholds the indicator until its first real measurement lands,
// so it never flashes at the wrong position/width on mount.
export function Tabs({ items, value, onValueChange, className, ...aria }: TabsProps) {
  const listRef = useRef<HTMLDivElement>(null)
  const buttonRefs = useRef(new Map<string, HTMLButtonElement>())
  const [rect, setRect] = useState<{ left: number; width: number } | null>(null)

  function measure() {
    const list = listRef.current
    const active = buttonRefs.current.get(value)
    if (!list || !active) return
    setRect({ left: active.offsetLeft, width: active.offsetWidth })
  }

  useLayoutEffect(measure, [value, items])

  useEffect(() => {
    window.addEventListener('resize', measure)
    return () => window.removeEventListener('resize', measure)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div ref={listRef} role="tablist" className={['ui-tabs', className].filter(Boolean).join(' ')} {...aria}>
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
          {item.label}
        </button>
      ))}
    </div>
  )
}
