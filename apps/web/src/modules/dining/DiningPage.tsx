import { useState } from 'react'
import { PageHeader } from '@homisuite/ui'
import { CategoriesTab } from './CategoriesTab'
import { RestaurantsTab } from './RestaurantsTab'
import { ReservationsTab } from './ReservationsTab'
import { ChangeLogTab } from './ChangeLogTab'

interface DiningPageProps {
  hotelId: string
  hotelName: string
  canManage: boolean
  staffProfileId: string | null
}

const TABS = [
  { value: 'prenotazioni', label: 'Prenotazioni' },
  { value: 'ristoranti', label: 'Ristoranti' },
  { value: 'categorie', label: 'Categorie' },
  { value: 'registro', label: 'Registro modifiche' },
]

export function DiningPage({ hotelId, hotelName, canManage, staffProfileId }: DiningPageProps) {
  const [tab, setTab] = useState('prenotazioni')

  return (
    <div className="page-stack shell-page dining-page">
      <PageHeader eyebrow={hotelName} title="Ristorazione" description="Elenco ristoranti convenzionati e dashboard prenotazioni." />
      <nav className="dining-tab-nav" aria-label="Sezioni Ristorazione">
        {TABS.map((item) => (
          <button
            key={item.value}
            type="button"
            className={`dining-tab${tab === item.value ? ' active' : ''}`}
            aria-current={tab === item.value ? 'page' : undefined}
            onClick={() => setTab(item.value)}
          >
            {item.label}
          </button>
        ))}
      </nav>
      {/* All four panels stay mounted, switching only which is visible --
          unmounting/remounting a tab (the previous behaviour) discarded
          whatever the person had open or typed there, e.g. the "Aggiungi
          prenotazione" modal closing and losing its draft when they
          switched to another tab to check something. */}
      <div hidden={tab !== 'prenotazioni'}><ReservationsTab hotelId={hotelId} staffProfileId={staffProfileId} /></div>
      <div hidden={tab !== 'ristoranti'}><RestaurantsTab hotelId={hotelId} canManage={canManage} /></div>
      <div hidden={tab !== 'categorie'}><CategoriesTab hotelId={hotelId} canManage={canManage} /></div>
      <div hidden={tab !== 'registro'}><ChangeLogTab hotelId={hotelId} /></div>
    </div>
  )
}
