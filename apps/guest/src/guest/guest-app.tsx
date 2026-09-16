import { useEffect, useState } from 'react'
import { Boxes, Sparkles, type LucideIcon } from 'lucide-react'
import { PublicHeader } from '@/components/public-header'
import { SectionCard } from '@/components/section-card'
import { cn } from '@/lib/cn'
import { clearGuestToken, getGuestToken, setGuestToken } from '@/lib/guest-token'
import {
  fetchAvailableModules,
  getStayInfo,
  isInvalidSessionError,
  listMyRequests,
  resolveHotelFromSlug,
  type AvailableModule,
  type StayInfo,
} from '@/lib/guest-api'
import { useLocale } from '@/lib/i18n/locale-context'
import type { TranslationKey } from '@/lib/i18n/dictionaries'
import { LoginScreen } from '@/guest/login-screen'
import { RequestFlow } from '@/guest/request-flow'
import { StatusList } from '@/guest/status-list'
import { BrandedInfoBand, ContactsCard } from '@/guest/greeting'

type Tab = 'new' | 'status'

// Every guest-facing module needs a directory label/icon here --
// 'guest_requests' (Housekeeping) is the only one that exists today.
// modules.display_name is a Core-level, English, admin-facing label (e.g.
// "Guest Requests"), not meant for the guest UI, hence this lookup instead
// of using it directly.
const MODULE_LABELS: Partial<Record<string, TranslationKey>> = {
  guest_requests: 'directory.housekeeping',
}
const MODULE_DESCRIPTIONS: Partial<Record<string, TranslationKey>> = {
  guest_requests: 'directory.housekeepingDescription',
}
const MODULE_ICONS: Partial<Record<string, LucideIcon>> = {
  guest_requests: Sparkles,
}

export function GuestApp() {
  const { t } = useLocale()
  const [token, setToken] = useState<string | null>(() => getGuestToken())
  // a token surviving in localStorage doesn't mean the stay is still valid
  // (checked out, cancelled, expired) — confirm before showing anything,
  // rather than waiting for the first write to fail
  const [checked, setChecked] = useState(false)
  const [stay, setStay] = useState<StayInfo | null>(null)
  const [tab, setTab] = useState<Tab>('new')
  const [refreshKey, setRefreshKey] = useState(0)
  // Runs once per page load regardless of an existing token: the hotel id
  // resolved from the URL slug is cached in memory only (lib/env.ts), which
  // a fresh load always starts empty, even for a returning guest whose
  // token/hotel id both already live in localStorage.
  const [hotelResolved, setHotelResolved] = useState<boolean | null>(null)
  // First step toward guest.homisuite.com being a real per-hotel directory
  // of services instead of a single hardcoded Housekeeping flow (see
  // guest_available_modules). null = still loading; [] = the hotel has no
  // guest-facing module enabled at all. Exactly one entry auto-selects
  // itself below, so today's guests never see a one-tile directory screen.
  const [availableModules, setAvailableModules] = useState<AvailableModule[] | null>(null)
  const [selectedModuleSlug, setSelectedModuleSlug] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    resolveHotelFromSlug().then((ok) => {
      if (!cancelled) setHotelResolved(ok)
    })
    return () => {
      cancelled = true
    }
  }, [])

  function onSessionExpired() {
    clearGuestToken()
    setToken(null)
    setStay(null)
    setChecked(true)
  }

  function onLogout() {
    clearGuestToken()
    setToken(null)
    setStay(null)
    setTab('new')
    setAvailableModules(null)
    setSelectedModuleSlug(null)
  }

  useEffect(() => {
    if (!token) {
      setChecked(true)
      return
    }
    let cancelled = false
    listMyRequests(token)
      .then(() => {
        if (cancelled) return
        setChecked(true)
        getStayInfo(token).then((info) => {
          if (!cancelled) setStay(info)
        })
      })
      .catch((err) => {
        if (cancelled) return
        if (isInvalidSessionError(err)) {
          onSessionExpired()
        } else {
          // a transient/network error shouldn't log the guest out — let them in,
          // individual actions will surface their own errors if it's really down
          setChecked(true)
        }
      })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token])

  // Hotel-scoped, not stay-scoped -- fetched as soon as there's a session,
  // independently of the stay info request above.
  useEffect(() => {
    if (!token) return
    let cancelled = false
    fetchAvailableModules()
      .then((modules) => {
        if (cancelled) return
        setAvailableModules(modules)
        if (modules.length === 1 && modules[0]) setSelectedModuleSlug(modules[0].slug)
      })
      .catch(() => {
        // A transient failure here shouldn't strand the guest on a
        // spinner forever -- fall back to Housekeeping, the one module
        // that has always existed, same as before this mechanism did.
        if (!cancelled) {
          setAvailableModules([])
          setSelectedModuleSlug('guest_requests')
        }
      })
    return () => {
      cancelled = true
    }
  }, [token])

  if (!checked || hotelResolved === null) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="h-7 w-7 animate-spin rounded-full border-3 border-line-strong border-t-accent" />
      </div>
    )
  }

  if (!hotelResolved) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background px-4">
        <p className="max-w-sm text-center text-sm text-muted">{t('login.invalidLink')}</p>
      </div>
    )
  }

  if (!token) {
    return (
      <LoginScreen
        onSuccess={(newToken) => {
          setGuestToken(newToken)
          setToken(newToken)
          setChecked(true)
        }}
      />
    )
  }

  return (
    <div className="min-h-screen bg-surface-2 pb-10">
      <PublicHeader onLogout={onLogout} />
      <div className="mx-auto max-w-xl space-y-3 px-4 pt-4">
        {stay && <BrandedInfoBand stay={stay} />}

        <SectionCard title={t('directory.title')}>
          {selectedModuleSlug === 'guest_requests' ? (
            <>
              <ModuleHeading slug="guest_requests" />
              <div className="mb-5 flex gap-1 rounded-md bg-surface-2 p-1">
                <TabButton active={tab === 'new'} onClick={() => setTab('new')}>
                  {t('tabs.new')}
                </TabButton>
                <TabButton active={tab === 'status'} onClick={() => setTab('status')}>
                  {t('tabs.status')}
                </TabButton>
              </div>

              {tab === 'new' ? (
                <RequestFlow
                  token={token}
                  onSessionExpired={onSessionExpired}
                  onCreated={() => {
                    setRefreshKey((k) => k + 1)
                    setTab('status')
                  }}
                />
              ) : (
                <StatusList token={token} refreshKey={refreshKey} onSessionExpired={onSessionExpired} />
              )}
            </>
          ) : availableModules === null ? (
            <div className="flex justify-center py-4">
              <div className="h-6 w-6 animate-spin rounded-full border-3 border-line-strong border-t-accent" />
            </div>
          ) : availableModules.length === 0 ? (
            <p className="py-2 text-center text-sm text-muted">{t('directory.empty')}</p>
          ) : selectedModuleSlug === null ? (
            <ModuleDirectory modules={availableModules} onSelect={setSelectedModuleSlug} />
          ) : null}
        </SectionCard>

        {stay && <ContactsCard stay={stay} />}
      </div>
    </div>
  )
}

// Shown above a module's own content -- with one guest-facing module this
// is the only place its name/description appear at all (the directory grid
// below is skipped entirely), so it can't be folded into ModuleDirectory.
function ModuleHeading({ slug }: { slug: string }) {
  const { t } = useLocale()
  const Icon = MODULE_ICONS[slug] ?? Boxes
  const label = MODULE_LABELS[slug]
  const description = MODULE_DESCRIPTIONS[slug]
  return (
    <div className="mb-4 flex items-start gap-3">
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-accent-soft text-accent">
        <Icon size={20} />
      </span>
      <div>
        <p className="text-base font-semibold text-foreground">{label ? t(label) : slug}</p>
        {description && <p className="text-sm text-muted">{t(description)}</p>}
      </div>
    </div>
  )
}

// Rendered only once a hotel has more than one guest-facing module enabled
// -- today that never happens (see MODULE_LABELS/MODULE_ICONS above), but
// the moment a second one does, this is what picks between them instead
// of new plumbing.
function ModuleDirectory({ modules, onSelect }: { modules: AvailableModule[]; onSelect: (slug: string) => void }) {
  const { t } = useLocale()
  return (
    <div className="grid grid-cols-2 gap-3">
      {modules.map((module) => {
        const Icon = MODULE_ICONS[module.slug] ?? Boxes
        const label = MODULE_LABELS[module.slug]
        return (
          <button
            key={module.slug}
            type="button"
            onClick={() => onSelect(module.slug)}
            className="flex cursor-pointer flex-col items-center gap-2 rounded-lg border border-line bg-white p-5 text-center shadow-sm transition-colors hover:border-accent-soft-line hover:bg-accent-soft"
          >
            <Icon className="h-7 w-7 text-accent" />
            <span className="text-base font-medium text-foreground">{label ? t(label) : module.display_name}</span>
          </button>
        )
      })}
    </div>
  )
}

function TabButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex-1 cursor-pointer rounded px-3 py-2 text-base font-medium transition-colors',
        active ? 'bg-white text-foreground shadow-sm' : 'text-muted hover:text-foreground',
      )}
    >
      {children}
    </button>
  )
}
