import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { ShiftPlannerModule } from '../public/ShiftPlannerModule'
import '../shifts.css'
import './preview.css'

const root = document.getElementById('root')

if (!root) throw new Error('Missing preview root')

createRoot(root).render(
  <StrictMode>
    <main className="preview-shell">
      <ShiftPlannerModule preview />
    </main>
  </StrictMode>,
)
