import { useMemo } from 'react'
import { ArrowRight, CalendarDays, CarFront, CircleCheck, Hotel, UtensilsCrossed } from 'lucide-react'
import { Link } from 'react-router-dom'
import { useModuleRuntime } from '../core/ModuleRuntimeContext'
import { useHousekeepingAccess } from '../modules/housekeeping/useHousekeepingAccess'
import { useDiningAccess } from '../modules/dining/useDiningAccess'

const moduleCatalog = [
  { slug: 'guest_requests', title: 'Housekeeping', description: 'Richieste ospiti e operatività camere.', path: '/housekeeping', icon: Hotel },
  { slug: 'dining', title: 'Ristorazione', description: 'Ristoranti convenzionati e prenotazioni.', path: '/dining', icon: UtensilsCrossed },
  { slug: 'shifts', title: 'Turni', description: 'Pianificazione e copertura dei turni.', path: '/turni', icon: CalendarDays },
  { slug: 'transfers', title: 'Transfer', description: 'Gestione transfer e spostamenti ospiti.', path: '/transfer', icon: CarFront },
]

// "Lunedì 22 settembre 2026" -- Intl gives it lowercase, capitalized to
// match how a date reads as a heading rather than mid-sentence.
function formatTodayItalian(date: Date): string {
  const formatted = new Intl.DateTimeFormat('it-IT', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(date)
  return formatted.charAt(0).toUpperCase() + formatted.slice(1)
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

  return (
    <div className="page-stack">
      <section className="page-heading split">
        <div>
          <p className="eyebrow">{runtime.property?.name}</p>
          <h1>Home</h1>
          <p className="page-subtitle">Accesso rapido ai moduli disponibili per questa struttura.</p>
        </div>
        <div className="home-today">
          <p className="home-today-date">{today}</p>
          <p className="home-today-greeting">Buon lavoro!</p>
        </div>
      </section>
      <section className="module-grid">
        {/* The whole card is the link (not just "Apri modulo"): a bigger,
            more forgiving touch target on a hotel front desk, and one clear
            affordance instead of a card that half-invites a click anywhere
            but only reacts to one small line of text. */}
        {modules.map((module) => (
          <Link className="module-card" to={module.path} key={module.title}>
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
