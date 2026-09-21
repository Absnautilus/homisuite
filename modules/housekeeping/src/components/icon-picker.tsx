import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react'
import { createPortal } from 'react-dom'
import dynamicIconImports from 'lucide-react/dynamicIconImports'
import { CategoryIcon } from '@/components/category-icon'
import { Button } from '@/components/ui/button'
import { FieldError, Input } from '@/components/ui/field'
import { useLocale } from '@/lib/i18n/locale-context'
import { cn } from '@/lib/cn'

const ALL_ICON_NAMES = Object.keys(dynamicIconImports)
const DEFAULT_ICON_NAMES = ['bed-double', 'shower-head', 'sparkles', 'wrench', 'briefcase', 'ellipsis']
const MAX_RESULTS = 60
const SAVED_CLOSE_DELAY_MS = 900
const PICKER_WIDTH = 288
const PICKER_MAX_HEIGHT = 390
const PICKER_GAP = 6
const VIEWPORT_GUTTER = 8

type PickerPosition = { left: number; top: number | 'auto'; bottom: number | 'auto'; maxHeight: number }

function computePickerPosition(anchor: HTMLElement): PickerPosition {
  const rect = anchor.getBoundingClientRect()
  const spaceBelow = window.innerHeight - rect.bottom
  const spaceAbove = rect.top
  const openUpward = spaceBelow < PICKER_MAX_HEIGHT + PICKER_GAP && spaceAbove > spaceBelow
  const left = Math.min(
    Math.max(VIEWPORT_GUTTER, rect.left),
    Math.max(VIEWPORT_GUTTER, window.innerWidth - PICKER_WIDTH - VIEWPORT_GUTTER),
  )
  const available = Math.max(
    112,
    (openUpward ? spaceAbove : spaceBelow) - PICKER_GAP - VIEWPORT_GUTTER,
  )
  const maxHeight = Math.min(PICKER_MAX_HEIGHT, available)

  return openUpward
    ? { left, top: 'auto', bottom: window.innerHeight - rect.top + PICKER_GAP, maxHeight }
    : { left, top: rect.bottom + PICKER_GAP, bottom: 'auto', maxHeight }
}

export function IconPicker({
  anchorRef,
  value,
  onSave,
  onClose,
}: {
  anchorRef: RefObject<HTMLElement | null>
  value: string | null
  onSave: (icon: string) => Promise<void>
  onClose: () => void
}) {
  const { t } = useLocale()
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState(value)
  const [pending, setPending] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [position, setPosition] = useState<PickerPosition | null>(null)
  const rootRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (pending) return
    function onPointerDown(e: MouseEvent) {
      const target = e.target as Node
      if (rootRef.current?.contains(target) || anchorRef.current?.contains(target)) return
      onClose()
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
  }, [anchorRef, onClose, pending])

  useLayoutEffect(() => {
    if (!anchorRef.current) return
    const reposition = () => {
      if (anchorRef.current) setPosition(computePickerPosition(anchorRef.current))
    }
    reposition()
    window.addEventListener('scroll', reposition, true)
    window.addEventListener('resize', reposition)
    return () => {
      window.removeEventListener('scroll', reposition, true)
      window.removeEventListener('resize', reposition)
    }
  }, [anchorRef])

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

  if (!position) return null

  return createPortal(
    <div
      ref={rootRef}
      className="rounded-lg border border-line bg-surface p-3 shadow-lg"
      style={{
        position: 'fixed',
        left: position.left,
        width: PICKER_WIDTH,
        top: position.top,
        bottom: position.bottom,
        maxHeight: position.maxHeight,
        overflowY: 'auto',
        zIndex: 1000,
      }}
    >
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
    </div>,
    document.body,
  )
}
