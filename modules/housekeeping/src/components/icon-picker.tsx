import { useEffect, useRef, useState } from 'react'
import dynamicIconImports from 'lucide-react/dynamicIconImports'
import { CategoryIcon } from '@/components/category-icon'
import { Button } from '@/components/ui/button'
import { FieldError, Input } from '@/components/ui/field'
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
// How long the "Salvato" confirmation stays up before the picker closes
// itself -- long enough to register as feedback, short enough that closing
// doesn't feel like a second step the staff member has to trigger.
const SAVED_CLOSE_DELAY_MS = 900

export function IconPicker({
  value,
  onSave,
  onClose,
}: {
  value: string | null
  // Only called once the staff member clicks Salva, not on every click in
  // the grid -- picking an icon used to save (and close the popover)
  // immediately, which made it too easy to change a category's icon by
  // accident with no way to tell it had already happened.
  onSave: (icon: string) => Promise<void>
  onClose: () => void
}) {
  const { t } = useLocale()
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState(value)
  const [pending, setPending] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const rootRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (pending) return
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
  }, [onClose, pending])

  function onPick(name: string) {
    setSelected(name)
    setSaved(false)
    setError(null)
  }

  async function onSubmit() {
    if (!selected || selected === value) return
    setPending(true)
    setError(null)
    try {
      await onSave(selected)
      setSaved(true)
      setTimeout(onClose, SAVED_CLOSE_DELAY_MS)
    } catch {
      setError(t('staff.items.iconSaveError'))
    } finally {
      setPending(false)
    }
  }

  const trimmed = query.trim().toLowerCase()
  const names = (trimmed ? ALL_ICON_NAMES.filter((name) => name.includes(trimmed)) : DEFAULT_ICON_NAMES).slice(0, MAX_RESULTS)
  const canSave = selected !== null && selected !== value && !pending

  return (
    <div ref={rootRef} className="absolute z-20 mt-1.5 w-72 rounded-lg border border-line bg-surface p-3 shadow-lg">
      <Input
        autoFocus
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder={t('staff.items.iconSearchPlaceholder')}
        disabled={pending}
        className="mb-2.5"
      />
      <div className="grid max-h-56 grid-cols-6 gap-1.5 overflow-y-auto">
        {names.map((name) => (
          <button
            key={name}
            type="button"
            title={name}
            disabled={pending}
            onClick={() => onPick(name)}
            className={cn(
              'flex aspect-square cursor-pointer items-center justify-center rounded-md border-[1.5px] border-line bg-surface-2 text-muted transition-colors hover:border-accent-soft-line hover:bg-accent-soft hover:text-accent disabled:cursor-not-allowed',
              name === selected && 'border-accent bg-accent-soft text-accent ring-3 ring-accent-soft',
            )}
          >
            <CategoryIcon icon={name} className="h-[18px] w-[18px]" />
          </button>
        ))}
        {names.length === 0 && <p className="col-span-6 py-3 text-center text-xs text-muted">—</p>}
      </div>
      <div className="mt-2.5 flex items-center justify-end gap-2 border-t border-line pt-2.5">
        {saved && !pending && <span className="mr-auto text-xs font-semibold text-ok-ink">{t('staff.items.iconSaved')}</span>}
        <Button type="button" variant="secondary" size="sm" onClick={onClose} disabled={pending}>
          {t('staff.items.iconCancel')}
        </Button>
        <Button type="button" size="sm" onClick={onSubmit} disabled={!canSave}>
          {pending ? t('staff.items.iconSaving') : t('staff.items.iconSave')}
        </Button>
      </div>
      <FieldError>{error ?? undefined}</FieldError>
    </div>
  )
}
