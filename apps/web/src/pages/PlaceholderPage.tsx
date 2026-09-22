import { PageState } from '../components/PageState'

type PlaceholderPageProps = { title: string }

export function PlaceholderPage({ title }: PlaceholderPageProps) {
  return (
    <div className="page-stack">
      <section className="page-heading">
        <p className="eyebrow">Homisuite</p>
        <h1>{title}</h1>
        <p className="page-subtitle">Questo spazio accoglierà le funzioni del modulo quando saranno disponibili per la struttura.</p>
      </section>
      <PageState kind="unavailable" title="Non ancora disponibile" description={`${title} non è ancora integrato in Homisuite per questa struttura.`} />
    </div>
  )
}
