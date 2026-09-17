import { useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { FieldError } from '@/components/ui/field'
import { useLocale } from '@/lib/i18n/locale-context'
import { cn } from '@/lib/cn'
import type { JobTitleOption } from '@/lib/admin-api'

// How long the "Salvato" confirmation stays up before the picker closes
// itself -- matches icon-picker.tsx's own delay.
const SAVED_CLOSE_DELAY_MS = 900

export function MansioniPicker({
  jobTitles,
  value,
  onSave,
  onClose,
}: {
  jobTitles: JobTitleOption[]
  value: string[]
  // Only called once the staff member clicks Salva, not on every checkbox
  // click -- same "commit, don't apply live" rule icon-picker.tsx follows.
  onSave: (jobTitleIds: string[]) => Promise<void>
  onClose: () => void
}) {
  const { t } = useLocale()
  const [selected, setSelected] = useState<string[]>(value)
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

  return (
    <div ref={rootRef} className="absolute z-20 mt-1.5 w-72 rounded-lg border border-line bg-surface p-3 shadow-lg">
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
    </div>
  )
}
