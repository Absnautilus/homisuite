import { useState } from 'react'
import { RefreshCw, X } from 'lucide-react'
import { useAppUpdate } from '../core/useAppUpdate'

// Mounted once, outside the route tree, so it shows up on every screen --
// login included -- rather than only inside the signed-in shell. Stays up
// until someone updates or dismisses it; a dismiss only skips *this*
// detected version; a later deploy shows the banner again.
export function UpdateBanner() {
  const { available, reload } = useAppUpdate()
  const [dismissed, setDismissed] = useState(false)

  if (!available || dismissed) return null

  return (
    <div className="update-banner" role="status">
      <span className="update-banner-text">
        <RefreshCw size={16} aria-hidden="true" />
        È disponibile una nuova versione di Homisuite.
      </span>
      <span className="update-banner-actions">
        <button type="button" className="update-banner-reload" onClick={reload}>
          Aggiorna ora
        </button>
        <button type="button" className="update-banner-dismiss" aria-label="Chiudi" onClick={() => setDismissed(true)}>
          <X size={16} />
        </button>
      </span>
    </div>
  )
}
