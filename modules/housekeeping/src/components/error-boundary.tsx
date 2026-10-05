import { Component, type ReactNode } from 'react'
import { AlertTriangle } from 'lucide-react'
import { Button } from '@/components/ui/button'

export class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  override state: { error: Error | null } = { error: null }

  static getDerivedStateFromError(error: Error) {
    return { error }
  }

  override componentDidCatch(error: Error, info: { componentStack: string }) {
    console.error('Unhandled error in the tree:', error, info.componentStack)
  }

  override render() {
    if (!this.state.error) return this.props.children
    return (
      <div className="flex min-h-screen items-center justify-center bg-background px-4">
        <div className="w-full max-w-sm rounded-lg border border-line bg-surface p-8 text-center shadow-md">
          <div className="mx-auto mb-4 flex h-13 w-13 items-center justify-center rounded-full bg-bad-bg text-bad-ink">
            <AlertTriangle width={22} height={22} strokeWidth={1.8} />
          </div>
          <p className="font-head text-[0.96875rem] font-extrabold text-foreground">Qualcosa non ha funzionato</p>
          <p className="mt-2 text-xs leading-relaxed text-muted">
            {this.state.error.message || 'Errore imprevisto.'} Ricarica la pagina; se continua, segnalalo così com'è.
          </p>
          <Button variant="primary" className="mt-5 w-full" onClick={() => window.location.reload()}>
            Ricarica
          </Button>
        </div>
      </div>
    )
  }
}
