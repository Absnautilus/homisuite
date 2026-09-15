import { LogOut } from 'lucide-react'
import { LanguageToggle } from '@/components/language-toggle'
import { TextSizeToggle } from '@/components/text-size-toggle'
import { useLocale } from '@/lib/i18n/locale-context'

export function PublicHeader({ onLogout }: { onLogout?: () => void }) {
  const { t } = useLocale()
  return (
    <div className="mx-auto w-full max-w-xl px-4 pt-6">
      <div className="flex items-center gap-1 rounded-full bg-navbar-bg py-1.5 pr-2 pl-3 text-navbar-text shadow-md">
        <span className="flex flex-1 items-center gap-2">
          <img src="/icon-192.png" alt="" className="h-5 w-5 rounded" />
          <span className="font-head text-sm font-extrabold">Homisuite</span>
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
