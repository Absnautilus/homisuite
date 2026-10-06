import { useState } from 'react'
import { ModuleNav } from '@homisuite/ui'
import { BookOpenText, CalendarDays, ListTree, Settings, UtensilsCrossed } from 'lucide-react'
import { CategoriesTab } from './CategoriesTab'
import { RestaurantsTab } from './RestaurantsTab'
import { ReservationsTab } from './ReservationsTab'
import { ChangeLogTab } from './ChangeLogTab'
import { SettingsTab } from './SettingsTab'

interface DiningPageProps {
  hotelId: string
  hotelName: string
  canManage: boolean
  staffProfileId: string | null
}

const TABS = [
  { value: 'prenotazioni', label: 'Prenotazioni', icon: <CalendarDays /> },
  { value: 'ristoranti', label: 'Ristoranti', icon: <UtensilsCrossed /> },
  { value: 'categorie', label: 'Categorie', icon: <ListTree /> },
  { value: 'registro', label: 'Registro modifiche', icon: <BookOpenText /> },
  { value: 'impostazioni', label: 'Impostazioni', icon: <Settings /> },
]

const RESERVATION_SUBTABS = [
  { value: 'oggi', label: 'Oggi' },
  { value: 'tutte', label: 'Tutte' },
]

export function DiningPage({ hotelId, hotelName, canManage, staffProfileId }: DiningPageProps) {
  const [tab, setTab] = useState('prenotazioni')
  const [reservationsView, setReservationsView] = useState<'oggi' | 'tutte'>('oggi')

  return (
    <div className="page-stack dining-page">
      <ModuleNav
        propertyName={hotelName}
        moduleName="Ristorazione"
        items={TABS}
        value={tab}
        onValueChange={setTab}
        ariaLabel="Sezioni Ristorazione"
        secondary={tab === 'prenotazioni' ? {
          items: RESERVATION_SUBTABS,
          value: reservationsView,
          onValueChange: (value) => setReservationsView(value as 'oggi' | 'tutte'),
          ariaLabel: 'Prenotazioni',
        } : undefined}
      />
      {/* All five panels stay mounted, switching only which is visible --
          unmounting/remounting a tab (the previous behaviour) discarded
          whatever the person had open or typed there, e.g. the "Aggiungi
          prenotazione" modal closing and losing its draft when they
          switched to another tab to check something. */}
      <div hidden={tab !== 'prenotazioni'}><ReservationsTab hotelId={hotelId} staffProfileId={staffProfileId} canManage={canManage} view={reservationsView} /></div>
      <div hidden={tab !== 'ristoranti'}><RestaurantsTab hotelId={hotelId} canManage={canManage} /></div>
      <div hidden={tab !== 'categorie'}><CategoriesTab hotelId={hotelId} canManage={canManage} /></div>
      <div hidden={tab !== 'registro'}><ChangeLogTab hotelId={hotelId} /></div>
      <div hidden={tab !== 'impostazioni'}><SettingsTab hotelId={hotelId} canManage={canManage} /></div>
    </div>
  )
}
