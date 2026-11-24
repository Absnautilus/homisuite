import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { UndoProvider } from '@homisuite/ui'
import './index.css'
import { App } from './App'
import { ErrorBoundary } from '@/components/error-boundary'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <div className="hk-root hk-root--standalone">
      <ErrorBoundary>
        <UndoProvider>
          <App />
        </UndoProvider>
      </ErrorBoundary>
    </div>
  </StrictMode>,
)
