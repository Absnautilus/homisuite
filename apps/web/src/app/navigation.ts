import { Boxes, CalendarDays, Home, Hotel, Mail, Settings, Users, UtensilsCrossed, Wrench } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'

export type ShellNavItem = {
  label: string
  path: string
  icon: LucideIcon
  kind: 'platform' | 'module'
}

export const shellNavigation: ShellNavItem[] = [
  { label: 'Home', path: '/', icon: Home, kind: 'platform' },
  { label: 'Housekeeping', path: '/housekeeping', icon: Hotel, kind: 'module' },
  { label: 'Ristorazione', path: '/dining', icon: UtensilsCrossed, kind: 'module' },
  { label: 'Turni', path: '/turni', icon: CalendarDays, kind: 'module' },
  { label: 'Transfer', path: '/transfer', icon: Wrench, kind: 'module' },
  { label: 'Smart Inbox', path: '/smart-inbox', icon: Mail, kind: 'module' },
  { label: 'Moduli', path: '/modules', icon: Boxes, kind: 'platform' },
  // Team/Camere/Soggiorni are reached through this one sidebar entry and
  // its own tab bar (see HotelCorePages' useStructureNav) -- not three
  // separate sidebar entries.
  { label: 'Struttura e Team', path: '/team', icon: Users, kind: 'platform' },
  { label: 'Impostazioni', path: '/settings', icon: Settings, kind: 'platform' },
]
