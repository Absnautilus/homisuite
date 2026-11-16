import { useEffect, useMemo, useState } from 'react'
import { PageHeader } from '@homisuite/ui'
import { ArrowRight, CalendarDays, CarFront, CircleCheck, Clock3, Hotel, Mail, Palmtree, UtensilsCrossed } from 'lucide-react'
import { Link } from 'react-router-dom'
import { supabase } from '../core/client'
import { useModuleRuntime } from '../core/ModuleRuntimeContext'
import { useHousekeepingAccess } from '../modules/housekeeping/useHousekeepingAccess'
import { useDiningAccess } from '../modules/dining/useDiningAccess'
import { useIsMobile } from '../lib/useIsMobile'
import { loadHomeDashboard, type HomeDashboardData } from './homeDashboard'

const moduleCatalog = [
  { slug: 'guest_requests', title: 'Housekeeping', description: 'Richieste ospiti e operatività camere.', path: '/housekeeping', icon: Hotel },
  { slug: 'dining', title: 'Ristorazione', description: 'Ristoranti convenzionati e prenotazioni.', path: '/dining', icon: UtensilsCrossed },
  { slug: 'shifts', title: 'Turni', description: 'Pianificazione e copertura dei turni.', path: '/turni', icon: CalendarDays },
  { slug: 'transfers', title: 'Transfer', description: 'Gestione transfer e spostamenti ospiti.', path: '/transfer', icon: CarFront },
  { slug: 'smart_inbox', title: 'Smart Inbox', description: 'Email degli ospiti con bozze di risposta pronte.', path: '/smart-inbox', icon: Mail },
]

// "Lunedì 22 settembre 2026" -- Intl gives it lowercase, capitalized to
// match how a date reads as a heading rather than mid-sentence.
function formatTodayItalian(date: Date): string {
  const formatted = new Intl.DateTimeFormat('it-IT', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(date)
  return formatted.charAt(0).toUpperCase() + formatted.slice(1)
}

function formatShortItalian(iso: string): string {
  const [, m, d] = iso.split('-')
  const months = ['gen', 'feb', 'mar', 'apr', 'mag', 'giu', 'lug', 'ago', 'set', 'ott', 'nov', 'dic']
  return `${Number(d)} ${months[Number(m) - 1]}`
}

function weekdayShortItalian(iso: string): string {
  return new Intl.DateTimeFormat('it-IT', { weekday: 'short', timeZone: 'UTC' }).format(new Date(`${iso}T00:00:00Z`)).replace('.', '')
}

export function HomePage() {
  const runtime = useModuleRuntime()
  // Same compatibility check as the nav (see ShellLayout/useHousekeepingAccess):
  // an entitled-but-unusable Housekeeping tile is a dead end, not a shortcut.
  const housekeepingAccess = useHousekeepingAccess()
  const diningAccess = useDiningAccess()
  const enabled = new Set(runtime.entitlements.filter((item) => item.enabled).map((item) => item.slug))
  const modules = moduleCatalog.filter((module) => {
    if (!enabled.has(module.slug)) return false
    if (module.slug === 'guest_requests') return housekeepingAccess.status === 'compatible'
    if (module.slug === 'dining') return diningAccess.status === 'compatible'
    return true
  })
  const today = useMemo(() => formatTodayItalian(new Date()), [])
  const isMobile = useIsMobile()
  // moduleCatalog's paths are absolute ('/housekeeping', ...), correct for
  // this page's real, root-mounted usage. Mounted under Admin Master's
  // operational view instead (App.tsx renders this same HomePage at
  // .../view, via ShellLayout's own index route), an absolute `to` would
  // navigate clear out of that nested route tree -- into the real top-level
  // /housekeeping, under the real ModuleRuntimeProvider's own (unrelated)
  // identity, losing the operational/impersonation context entirely. This
  // was the actual cause of "Visualizza come X lands me back on my own
  // ordinary account": the admin selects someone, correctly lands on this
  // page inside the operational view, then clicks a module card here and is
  // bounced straight out of it. ShellLayout's own nav links already guard
  // against exactly this (see its navPath/hidePlatformNav), this page's
  // never did. runtime.isPlatformOperationalView is the same signal
  // PlatformOperationalRuntimeProvider sets for exactly this purpose.
  const navPath = (path: string) => (runtime.isPlatformOperationalView ? path.slice(1) : path)

  // Personalized "today" row -- only when Turni is enabled and this signed-in
  // account is actually staffed in it (an owner/admin-only login isn't, and
  // simply sees no row, not an empty one). Never blocks the rest of the
  // page: a failure here just leaves `dashboard` null.
  const [dashboard, setDashboard] = useState<HomeDashboardData | null>(null)
  useEffect(() => {
    if (!runtime.property?.id || !enabled.has('shifts')) { setDashboard(null); return }
    let cancelled = false
    loadHomeDashboard(supabase, runtime.property.id)
      .then((result) => { if (!cancelled) setDashboard(result) })
      .catch(() => { if (!cancelled) setDashboard(null) })
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runtime.property?.id])

  return (
    <div className="page-stack">
      <PageHeader
        eyebrow={runtime.property?.name}
        title="Home"
        description={isMobile ? undefined : 'Accesso rapido ai moduli disponibili per questa struttura.'}
        actions={
          <div className="home-today">
            <p className="home-today-date">{today}</p>
            <p className="home-today-greeting">Buon lavoro!</p>
          </div>
        }
      />

      {dashboard?.todayShift || dashboard?.nextVacation ? (
        <section className="home-stats">
          {dashboard.todayShift ? (
            <div className="home-stat-tile">
              <div className="home-stat-label"><Clock3 size={14} /> Turno di oggi</div>
              <div className="home-stat-value">
                {dashboard.todayShift.startsAt && dashboard.todayShift.endsAt
                  ? `${dashboard.todayShift.startsAt.slice(0, 5)} – ${dashboard.todayShift.endsAt.slice(0, 5)}`
                  : dashboard.todayShift.code}
              </div>
              {dashboard.todayShift.label ? <p className="home-stat-sub">{dashboard.todayShift.label}</p> : null}
            </div>
          ) : null}
          {dashboard.nextVacation ? (
            <div className="home-stat-tile">
              <div className="home-stat-label"><Palmtree size={14} /> Prossime ferie</div>
              <div className="home-stat-value">{formatShortItalian(dashboard.nextVacation.start)} – {formatShortItalian(dashboard.nextVacation.end)}</div>
              <p className={`home-stat-sub${dashboard.nextVacation.status === 'confirmed' ? ' is-accent' : ''}`}>
                {dashboard.nextVacation.status === 'confirmed' ? 'Confermate' : 'In attesa di approvazione'}
              </p>
            </div>
          ) : null}
        </section>
      ) : null}

      {dashboard?.upcomingShifts.some((day) => day.code) ? (
        <section className="home-shift-strip-card">
          <h2>I tuoi prossimi turni</h2>
          <div className="home-shift-strip">
            {dashboard.upcomingShifts.map((day, index) => (
              <div className={`home-shift-day${index === 0 ? ' is-today' : ''}`} key={day.date}>
                <p className="home-shift-day-label">{weekdayShortItalian(day.date)}</p>
                <div className={`home-shift-day-chip${index === 0 ? ' is-today' : ''}`}>{day.code ?? '–'}</div>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      <section className="module-grid" data-tour="module-grid">
        {/* The whole card is the link (not just "Apri modulo"): a bigger,
            more forgiving touch target on a hotel front desk, and one clear
            affordance instead of a card that half-invites a click anywhere
            but only reacts to one small line of text. */}
        {modules.map((module) => (
          <Link className="module-card" to={navPath(module.path)} key={module.title}>
            <module.icon className="module-card-decor" aria-hidden="true" />
            <div className="module-card-top">
              <div className="module-icon"><module.icon size={22} /></div>
            </div>
            <div className="module-card-body">
              <h2>{module.title}</h2>
              <p>{module.description}</p>
            </div>
            <div className="module-card-footer">
              <span className="module-card-open">Apri modulo</span>
              <span className="module-card-arrow" aria-hidden="true"><ArrowRight size={16} /></span>
            </div>
          </Link>
        ))}
      </section>
      <p className="attention-note">
        <span className="attention-note-icon" aria-hidden="true"><CircleCheck size={13} /></span>
        Nessuna criticità urgente al momento.
      </p>
    </div>
  )
}
