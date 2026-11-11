import { LayoutGrid } from 'lucide-react'
import { useSimpleMode } from '@/lib/simple-mode-context'
import { useLocale } from '@/lib/i18n/locale-context'
import { cn } from '@/lib/cn'

// A straight on/off, not a popover like NotificationSettingsToggle/
// TextSizeToggle -- there is nothing to pick, only a state to flip.
export function SimpleModeToggle({ dark = false }: { dark?: boolean } = {}) {
  const { t } = useLocale()
  const { enabled, setEnabled } = useSimpleMode()

  return (
    <button
      type="button"
      onClick={() => setEnabled(!enabled)}
      aria-label={t('simpleMode.label')}
      title={t('simpleMode.label')}
      aria-pressed={enabled}
      className={cn(
        'flex h-11 w-11 cursor-pointer items-center justify-center rounded-full transition-colors',
        enabled
          ? 'bg-accent text-white'
          : dark
            ? 'hover:bg-white/10'
            : 'border border-line shadow-sm hover:border-accent-soft-line',
      )}
    >
      <LayoutGrid className="h-4.5 w-4.5" />
    </button>
  )
}
