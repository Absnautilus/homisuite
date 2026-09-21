import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react'
import { createPortal } from 'react-dom'
import { ChevronLeft, ChevronRight, Grid3X3 } from 'lucide-react'
import dynamicIconImports from 'lucide-react/dynamicIconImports'
import { CategoryIcon } from '@/components/category-icon'
import { Button } from '@/components/ui/button'
import { FieldError, Input } from '@/components/ui/field'
import { useLocale } from '@/lib/i18n/locale-context'
import { cn } from '@/lib/cn'

const ALL_ICON_NAMES = Object.keys(dynamicIconImports).sort()
const DEFAULT_ICON_NAMES = ['bed-double', 'shower-head', 'sparkles', 'wrench', 'briefcase', 'ellipsis']
const MAX_RESULTS = 60
const ICON_PAGE_SIZE = 96
const SAVED_CLOSE_DELAY_MS = 900
const PICKER_WIDTH = 288
const PICKER_MAX_HEIGHT = 390
const PICKER_GAP = 6
const VIEWPORT_GUTTER = 8

const ICON_LIBRARY_LABELS = {
  it: { all: 'Tutte le icone', page: 'Pagina', prev: 'Pagina precedente', next: 'Pagina successiva' },
  en: { all: 'All icons', page: 'Page', prev: 'Previous page', next: 'Next page' },
  fr: { all: 'Toutes les icônes', page: 'Page', prev: 'Page précédente', next: 'Page suivante' },
  de: { all: 'Alle Symbole', page: 'Seite', prev: 'Vorherige Seite', next: 'Nächste Seite' },
  es: { all: 'Todos los iconos', page: 'Página', prev: 'Página anterior', next: 'Página siguiente' },
  pt: { all: 'Todos os ícones', page: 'Página', prev: 'Página anterior', next: 'Próxima página' },
  ja: { all: 'すべてのアイコン', page: 'ページ', prev: '前のページ', next: '次のページ' },
  bn: { all: 'সব আইকন', page: 'পৃষ্ঠা', prev: 'আগের পৃষ্ঠা', next: 'পরের পৃষ্ঠা' },
  hi: { all: 'सभी आइकन', page: 'पृष्ठ', prev: 'पिछला पृष्ठ', next: 'अगला पृष्ठ' },
  ar: { all: 'كل الأيقونات', page: 'صفحة', prev: 'الصفحة السابقة', next: 'الصفحة التالية' },
  zh: { all: '所有图标', page: '页', prev: '上一页', next: '下一页' },
  ru: { all: 'Все значки', page: 'Страница', prev: 'Предыдущая страница', next: 'Следующая страница' },
} as const

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
  const { locale, t } = useLocale()
  const labels = ICON_LIBRARY_LABELS[locale]
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState(value)
  const [pending, setPending] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [position, setPosition] = useState<PickerPosition | null>(null)
  const [browseAll, setBrowseAll] = useState(false)
  const [page, setPage] = useState(0)
  const rootRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (pending) return
    function onPointerDown(e: MouseEvent) {
      const target = e.target as Node
      if (rootRef.current?.contains(target) || anchorRef.current?.contains(target)) return
      onClose()
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key !== 'Escape') return
      if (browseAll) {
        setBrowseAll(false)
        setPage(0)
      } else {
        onClose()
      }
    }
    document.addEventListener('mousedown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('mousedown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [anchorRef, browseAll, onClose, pending])

  useLayoutEffect(() => {
    if (!anchorRef.current || browseAll) return
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
  }, [anchorRef, browseAll])

  useEffect(() => {
    setPage(0)
  }, [query, browseAll])

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
  const matchingNames = trimmed ? ALL_ICON_NAMES.filter((name) => name.includes(trimmed)) : ALL_ICON_NAMES
  const pageCount = Math.max(1, Math.ceil(matchingNames.length / ICON_PAGE_SIZE))
  const currentPage = Math.min(page, pageCount - 1)
  const names = browseAll
    ? matchingNames.slice(currentPage * ICON_PAGE_SIZE, currentPage * ICON_PAGE_SIZE + ICON_PAGE_SIZE)
    : (trimmed ? matchingNames : DEFAULT_ICON_NAMES).slice(0, MAX_RESULTS)
  const canSave = selected !== null && selected !== value && !pending

  if (!browseAll && !position) return null

  const panelStyle = browseAll
    ? {
        position: 'fixed' as const,
        left: '50%',
        top: '50%',
        width: 'min(720px, calc(100vw - 24px))',
        maxHeight: 'min(720px, calc(100vh - 24px))',
        transform: 'translate(-50%, -50%)',
        zIndex: 1000,
      }
    : {
        position: 'fixed' as const,
        left: position?.left,
        width: PICKER_WIDTH,
        top: position?.top,
        bottom: position?.bottom,
        maxHeight: position?.maxHeight,
        overflowY: 'auto' as const,
        zIndex: 1000,
      }

  return createPortal(
    <>
      {browseAll && <div className="fixed inset-0 z-[999] bg-foreground/20" aria-hidden="true" />}
      <div
        ref={rootRef}
        className={cn(
          'rounded-lg border border-line bg-surface p-3 shadow-lg',
          browseAll && 'flex flex-col overflow-hidden',
        )}
        style={panelStyle}
      >
        {browseAll && (
          <div className="mb-3 flex items-center justify-between gap-3">
            <div>
              <p className="text-sm font-bold text-foreground">{labels.all}</p>
              <p className="text-xs text-muted">{ALL_ICON_NAMES.length}</p>
            </div>
            <Button type="button" variant="secondary" size="sm" onClick={() => setBrowseAll(false)} disabled={pending}>
              {t('staff.items.iconCancel')}
            </Button>
          </div>
        )}

        <Input
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t('staff.items.iconSearchPlaceholder')}
          disabled={pending}
          className="mb-2.5"
        />

        <div
          className={cn(
            'grid gap-1.5 overflow-y-auto',
            browseAll ? 'min-h-0 flex-1 grid-cols-6 sm:grid-cols-8 md:grid-cols-10' : 'max-h-56 grid-cols-6',
          )}
        >
          {names.map((name) => (
            <button
              key={name}
              type="button"
              title={name}
              disabled={pending}
              onClick={() => onPick(name)}
              className={cn(
                'flex aspect-square min-h-10 cursor-pointer items-center justify-center rounded-md border-[1.5px] border-line bg-surface-2 text-muted transition-colors hover:border-accent-soft-line hover:bg-accent-soft hover:text-accent disabled:cursor-not-allowed',
                name === selected && 'border-accent bg-accent-soft text-accent ring-3 ring-accent-soft',
              )}
            >
              <CategoryIcon icon={name} className="h-[18px] w-[18px]" />
            </button>
          ))}
          {names.length === 0 && <p className="col-span-full py-6 text-center text-xs text-muted">—</p>}
        </div>

        {!browseAll && (
          <button
            type="button"
            onClick={() => setBrowseAll(true)}
            disabled={pending}
            className="mt-2 flex w-full cursor-pointer items-center justify-center gap-2 rounded-md border border-line bg-surface-2 px-3 py-2 text-xs font-semibold text-muted transition-colors hover:border-accent-soft-line hover:bg-accent-soft hover:text-accent disabled:cursor-not-allowed"
          >
            <Grid3X3 className="h-4 w-4" />
            {labels.all}
          </button>
        )}

        {browseAll && (
          <div className="mt-3 flex items-center justify-between gap-3 border-t border-line pt-3">
            <div className="flex items-center gap-2">
              <button
                type="button"
                aria-label={labels.prev}
                disabled={currentPage === 0}
                onClick={() => setPage((p) => Math.max(0, p - 1))}
                className="flex h-8 w-8 cursor-pointer items-center justify-center rounded-sm border border-line bg-surface disabled:cursor-not-allowed disabled:opacity-35"
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
              <span className="min-w-24 text-center text-xs text-muted">
                {labels.page} {currentPage + 1} / {pageCount}
              </span>
              <button
                type="button"
                aria-label={labels.next}
                disabled={currentPage >= pageCount - 1}
                onClick={() => setPage((p) => Math.min(pageCount - 1, p + 1))}
                className="flex h-8 w-8 cursor-pointer items-center justify-center rounded-sm border border-line bg-surface disabled:cursor-not-allowed disabled:opacity-35"
              >
                <ChevronRight className="h-4 w-4" />
              </button>
            </div>
            <div className="flex items-center gap-2">
              {saved && !pending && <span className="text-xs font-semibold text-ok-ink">{t('staff.items.iconSaved')}</span>}
              <Button type="button" size="sm" onClick={onSubmit} disabled={!canSave}>
                {pending ? t('staff.items.iconSaving') : t('staff.items.iconSave')}
              </Button>
            </div>
          </div>
        )}

        {!browseAll && (
          <div className="mt-2.5 flex items-center justify-end gap-2 border-t border-line pt-2.5">
            {saved && !pending && <span className="mr-auto text-xs font-semibold text-ok-ink">{t('staff.items.iconSaved')}</span>}
            <Button type="button" variant="secondary" size="sm" onClick={onClose} disabled={pending}>
              {t('staff.items.iconCancel')}
            </Button>
            <Button type="button" size="sm" onClick={onSubmit} disabled={!canSave}>
              {pending ? t('staff.items.iconSaving') : t('staff.items.iconSave')}
            </Button>
          </div>
        )}

        <FieldError>{error ?? undefined}</FieldError>
      </div>
    </>,
    document.body,
  )
}
