import { LogOut } from 'lucide-react'
import { LanguageToggle } from '@/components/language-toggle'
import { TextSizeToggle } from '@/components/text-size-toggle'
import { useLocale } from '@/lib/i18n/locale-context'
import { cn } from '@/lib/cn'

export function PublicHeader({
  onLogout,
  hotelName,
  logoUrl,
  brandColor,
}: {
  onLogout?: () => void
  // All optional and all absent by default: the header renders generic
  // Homisuite branding until the guest's stay (and with it the hotel's own
  // name/logo/color) has loaded, rather than flashing a name and then a
  // logo in separately.
  hotelName?: string | null
  logoUrl?: string | null
  // Only when a hotel picked its own color does the pill switch to it --
  // an uploaded logo is far more likely to already read well against a
  // color the hotel itself chose than against Homisuite's own generic dark
  // pill, so no logo backing is needed here. Without a custom color the
  // pill stays dark and the white backing below covers that mismatch
  // instead.
  brandColor?: string | null
}) {
  const { t } = useLocale()
  const hasBrandColor = Boolean(brandColor)
  const hasCustomLogo = Boolean(logoUrl)
  return (
    <div className="mx-auto w-full max-w-xl px-4 pt-6">
      <div
        className={cn(
          'flex items-center gap-1 rounded-full py-1.5 pr-2 pl-3 shadow-md',
          hasBrandColor ? 'bg-accent text-accent-ink' : 'bg-navbar-bg text-navbar-text',
        )}
      >
        <span className="flex flex-1 items-center gap-2 overflow-hidden">
          <span
            className={cn(
              'flex h-7 w-7 shrink-0 items-center justify-center rounded-md',
              !hasBrandColor && hasCustomLogo && 'bg-white p-0.5',
            )}
          >
            <img src={logoUrl || '/icon-192.png'} alt="" className="h-full w-full rounded object-contain" />
          </span>
          <span className="truncate font-head text-sm font-extrabold">{hotelName || 'Homisuite'}</span>
        </span>
        <TextSizeToggle dark align="right" />
        <LanguageToggle dark align="right" />
        {onLogout && (
          <button
            type="button"
            onClick={onLogout}
            aria-label={t('nav.logout')}
            title={t('nav.logout')}
            className="flex h-8 w-8 cursor-pointer items-center justify-center rounded-full text-white/70 hover:bg-white/10 hover:text-white"
          >
            <LogOut size={16} />
          </button>
        )}
      </div>
    </div>
  )
}
