import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react'
import { createPortal } from 'react-dom'
import { Button } from '@/components/ui/button'
import { FieldError } from '@/components/ui/field'
import { useLocale } from '@/lib/i18n/locale-context'
import { cn } from '@/lib/cn'
import { getHkPortalTarget } from '@/lib/portal-target'
import type { JobTitleOption } from '@/lib/admin-api'

const SAVED_CLOSE_DELAY_MS = 900
const PICKER_WIDTH = 288
const PICKER_MAX_HEIGHT = 320
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
    96,
    (openUpward ? spaceAbove : spaceBelow) - PICKER_GAP - VIEWPORT_GUTTER,
  )
  const maxHeight = Math.min(PICKER_MAX_HEIGHT, available)
  return openUpward
    ? { left, top: 'auto', bottom: window.innerHeight - rect.top + PICKER_GAP, maxHeight }
    : { left, top: rect.bottom + PICKER_GAP, bottom: 'auto', maxHeight }
}

export function MansioniPicker({
  anchorRef,
  jobTitles,
  value,
  onSave,
  onClose,
}: {
  anchorRef: RefObject<HTMLElement | null>
  jobTitles: JobTitleOption[]
  value: string[]
  onSave: (jobTitleIds: string[]) => Promise<void>
  onClose: () => void
}) {
  const { t } = useLocale()
  const [selected, setSelected] = useState<string[]>(value)
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
    const anchor = anchorRef.current
    if (!anchor) return
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

  function toggle(id: string) {
    setSelected((current) => (current.includes(id) ? current.filter((x) => x !== id) : [...current, id]))
    setSaved(false)
    setError(null)
  }

  const sameAsValue = selected.length === value.length && selected.every((id) => value.includes(id))

  async function onSubmit() {
    if (sameAsValue) return
    setPending(true)
    setError(null)
    try {
      await onSave(selected)
      setSaved(true)
      setTimeout(onClose, SAVED_CLOSE_DELAY_MS)
    } catch {
      setError(t('staff.items.mansioniSaveError'))
    } finally {
      setPending(false)
    }
  }

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
      {jobTitles.length === 0 ? (
        <p className="py-2 text-center text-xs text-muted">{t('staff.items.categoryJobTitlesEmpty')}</p>
      ) : (
        <div className="flex max-h-56 flex-wrap gap-1.5 overflow-y-auto">
          {jobTitles.map((jt) => (
            <label
              key={jt.id}
              className={cn(
                'flex cursor-pointer items-center gap-1.5 rounded-full border-[1.5px] px-3 py-1.5 text-xs font-semibold transition-colors',
                selected.includes(jt.id) ? 'border-accent bg-accent-soft text-accent' : 'border-line text-muted hover:border-accent-soft-line',
              )}
            >
              <input type="checkbox" className="sr-only" checked={selected.includes(jt.id)} disabled={pending} onChange={() => toggle(jt.id)} />
              {jt.name}
            </label>
          ))}
        </div>
      )}
      <div className="mt-2.5 flex items-center justify-end gap-2 border-t border-line pt-2.5">
        {saved && !pending && <span className="mr-auto text-xs font-semibold text-ok-ink">{t('staff.items.mansioniSaved')}</span>}
        <Button type="button" variant="secondary" size="sm" onClick={onClose} disabled={pending}>
          {t('staff.items.iconCancel')}
        </Button>
        <Button type="button" size="sm" onClick={onSubmit} disabled={sameAsValue || pending}>
          {pending ? t('staff.items.iconSaving') : t('staff.items.iconSave')}
        </Button>
      </div>
      <FieldError>{error ?? undefined}</FieldError>
    </div>,
    getHkPortalTarget(),
  )
}
