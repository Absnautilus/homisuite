import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'

type PushToastPayload = {
  title?: string
  body?: string
  data?: { requestId?: string; url?: string; type?: string }
  actions?: string[]
}

export function PushToast() {
  const navigate = useNavigate()
  const [payload, setPayload] = useState<PushToastPayload | null>(null)
  const timerRef = useRef<number | null>(null)

  useEffect(() => {
    if (!('serviceWorker' in navigator)) return

    const onMessage = (event: MessageEvent) => {
      const message = event.data as { type?: string; notification?: PushToastPayload } | undefined
      if (message?.type !== 'homisuite-push' || !message.notification) return
      if (timerRef.current !== null) window.clearTimeout(timerRef.current)
      setPayload(message.notification)
      timerRef.current = window.setTimeout(() => {
        setPayload(null)
        timerRef.current = null
      }, 3000)
    }

    navigator.serviceWorker.addEventListener('message', onMessage)
    return () => {
      navigator.serviceWorker.removeEventListener('message', onMessage)
      if (timerRef.current !== null) window.clearTimeout(timerRef.current)
    }
  }, [])

  if (!payload) return null

  const requestId = payload.data?.requestId
  const hasRequestActions = payload.actions?.includes('accept') && Boolean(requestId)

  return (
    <aside className="push-toast" role="status" aria-live="polite">
      <img src="/icon-192.png" alt="" width={34} height={34} />
      <div className="push-toast-copy">
        <strong>{payload.title ?? 'Homisuite'}</strong>
        {payload.body ? <span>{payload.body}</span> : null}
      </div>
      {hasRequestActions ? (
        <div className="push-toast-actions">
          <button type="button" onClick={() => setPayload(null)}>Ignora</button>
          <button
            type="button"
            className="is-primary"
            onClick={() => {
              setPayload(null)
              navigate(`/housekeeping?claim=${requestId}`)
            }}
          >
            Accetta
          </button>
        </div>
      ) : null}
    </aside>
  )
}
