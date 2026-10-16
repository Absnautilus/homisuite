import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { App } from './app/App'
import { ModuleRuntimeProvider } from './core/ModuleRuntimeContext'
import { initTheme } from './lib/theme'
import './styles.css'
import './shell-effects.css'
import './shell-completion.css'

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
      <ModuleRuntimeProvider>
        <App />
      </ModuleRuntimeProvider>
    </BrowserRouter>
  </StrictMode>,
)
