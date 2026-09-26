import { PageHeader } from '@homisuite/ui'
import { PageState } from '../components/PageState'

type PlaceholderPageProps = { title: string }

export function PlaceholderPage({ title }: PlaceholderPageProps) {
  return (
    <div className="page-stack">
      <PageHeader eyebrow="Homisuite" title={title} description="Questo spazio accoglierà le funzioni del modulo quando saranno disponibili per la struttura." />
      <PageState kind="unavailable" title="Non ancora disponibile" description={`${title} non è ancora integrato in Homisuite per questa struttura.`} />
    </div>
  )
}
