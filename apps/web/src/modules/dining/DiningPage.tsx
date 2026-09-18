import { useState } from 'react'
import { Tabs } from '@homisuite/ui'
import { CategoriesTab } from './CategoriesTab'
import { RestaurantsTab } from './RestaurantsTab'
import { ReservationsTab } from './ReservationsTab'

interface DiningPageProps {
  hotelId: string
  canManage: boolean
  staffProfileId: string | null
}

const TABS = [
  { value: 'prenotazioni', label: 'Prenotazioni' },
  { value: 'ristoranti', label: 'Ristoranti' },
  { value: 'categorie', label: 'Categorie' },
]

export function DiningPage({ hotelId, canManage, staffProfileId }: DiningPageProps) {
  const [tab, setTab] = useState('prenotazioni')

  return (
    <div className="page-stack shell-page dining-page">
      <header className="page-heading">
        <h1>Ristorazione</h1>
        <p>Elenco ristoranti convenzionati e dashboard prenotazioni.</p>
      </header>
      <Tabs items={TABS} value={tab} onValueChange={setTab} aria-label="Sezioni Ristorazione" />
      {tab === 'prenotazioni' && <ReservationsTab hotelId={hotelId} staffProfileId={staffProfileId} />}
      {tab === 'ristoranti' && <RestaurantsTab hotelId={hotelId} canManage={canManage} />}
      {tab === 'categorie' && <CategoriesTab hotelId={hotelId} canManage={canManage} />}
    </div>
  )
}
