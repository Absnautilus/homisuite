import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { initTheme, UndoProvider } from '@homisuite/ui'
import { App } from './App'
import './styles.css'

// The *initial* data-theme attribute is already set synchronously by the
// inline script in index.html (before this module, or any CSS/paint, even
// runs) to avoid a flash of the wrong theme. initTheme() only wires the
// live system-preference listener for an already-open tab.
initTheme()

const root = document.getElementById('root')
if (!root) throw new Error('Root element not found')

createRoot(root).render(
  <StrictMode>
    <BrowserRouter>
      <UndoProvider>
        <App />
      </UndoProvider>
    </BrowserRouter>
  </StrictMode>,
)
