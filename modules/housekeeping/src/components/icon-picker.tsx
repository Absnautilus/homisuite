import { useEffect, useRef, useState } from 'react'
import dynamicIconImports from 'lucide-react/dynamicIconImports'
import { CategoryIcon } from '@/components/category-icon'
import { Input } from '@/components/ui/field'
import { useLocale } from '@/lib/i18n/locale-context'
import { cn } from '@/lib/cn'

// The full Lucide set (1500+ names) -- searched by substring on its own
// kebab-case name (Lucide has no per-icon keywords/synonyms shipped), and
// capped per search so typing "a" doesn't render hundreds of lazy icons at
// once. A handful shown before any search covers the categories this app
// ships with today.
const ALL_ICON_NAMES = Object.keys(dynamicIconImports)
const DEFAULT_ICON_NAMES = ['bed-double', 'shower-head', 'sparkles', 'wrench', 'briefcase', 'ellipsis']
const MAX_RESULTS = 60

export function IconPicker({ value, onSelect, onClose }: { value: string | null; onSelect: (icon: string) => void; onClose: () => void }) {
  const { t } = useLocale()
  const [query, setQuery] = useState('')
  const rootRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function onPointerDown(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) onClose()
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('mousedown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('mousedown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [onClose])

  const trimmed = query.trim().toLowerCase()
  const names = (trimmed ? ALL_ICON_NAMES.filter((name) => name.includes(trimmed)) : DEFAULT_ICON_NAMES).slice(0, MAX_RESULTS)

  return (
    <div ref={rootRef} className="absolute z-20 mt-1.5 w-72 rounded-lg border border-line bg-surface p-3 shadow-lg">
      <Input
        autoFocus
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder={t('staff.items.iconSearchPlaceholder')}
        className="mb-2.5"
      />
      <div className="grid max-h-56 grid-cols-6 gap-1.5 overflow-y-auto">
        {names.map((name) => (
          <button
            key={name}
            type="button"
            title={name}
            onClick={() => onSelect(name)}
            className={cn(
              'flex aspect-square cursor-pointer items-center justify-center rounded-md border-[1.5px] border-line bg-surface-2 text-muted transition-colors hover:border-accent-soft-line hover:bg-accent-soft hover:text-accent',
              name === value && 'border-accent bg-accent-soft text-accent ring-3 ring-accent-soft',
            )}
          >
            <CategoryIcon icon={name} className="h-[18px] w-[18px]" />
          </button>
        ))}
        {names.length === 0 && <p className="col-span-6 py-3 text-center text-xs text-muted">—</p>}
      </div>
    </div>
  )
}
