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

  return (
    <div className="page-stack">
      <section className="page-heading">
        <p className="eyebrow">{runtime.property?.name}</p>
        <h1>Home</h1>
        <p className="page-subtitle">Accesso rapido ai moduli disponibili per questa struttura.</p>
      </section>
      <section className="module-grid">
        {/* The whole card is the link (not just "Apri"): a bigger, more
            forgiving touch target on a hotel front desk, and one clear
            affordance instead of a card that half-invites a click anywhere
            but only reacts to one small line of text. */}
        {modules.map((module) => (
          <Link className="module-card" to={module.path} key={module.title}>
            <div className="module-card-top">
              <div className="module-icon"><module.icon size={20} /></div>
            </div>
            <div><h2>{module.title}</h2><p>{module.description}</p></div>
            <span className="module-card-open" aria-hidden="true">Apri <ArrowRight size={16} /></span>
          </Link>
        ))}
      </section>
      <p className="attention-note"><CircleCheck size={16} aria-hidden="true" />Nessuna criticità urgente al momento.</p>
    </div>
  )
}
